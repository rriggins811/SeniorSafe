import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno"

// ---------------------------------------------------------------------------
// Stripe webhook handler
// Listens for checkout completion, subscription updates, and cancellations.
// Updates user_profile.subscription_tier accordingly.
// ---------------------------------------------------------------------------

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

// Service-role client — bypasses RLS so we can update any user's profile
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ---------------------------------------------------------------------------
// Helper: update a user's tier + Stripe IDs
// ---------------------------------------------------------------------------
async function updateUserTier(
  userId: string,
  tier: 'free' | 'paid',
  stripeCustomerId?: string,
  stripeSubscriptionId?: string,
) {
  const update: Record<string, unknown> = { subscription_tier: tier }
  if (stripeCustomerId) update.stripe_customer_id = stripeCustomerId
  if (stripeSubscriptionId) update.stripe_subscription_id = stripeSubscriptionId

  const { error } = await supabaseAdmin
    .from('user_profile')
    .update(update)
    .eq('user_id', userId)

  if (error) {
    console.error(`Failed to update user ${userId} to ${tier}:`, error.message)
  } else {
    console.log(`✅ User ${userId} → subscription_tier = '${tier}'`)
  }
  return error
}

// ---------------------------------------------------------------------------
// Helper: look up Supabase user_id from a Stripe customer ID
// (for events that don't carry client_reference_id)
// ---------------------------------------------------------------------------
async function getUserIdByStripeCustomer(customerId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('user_profile')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .single()

  if (error || !data) {
    console.error('Could not find user for Stripe customer', customerId, error?.message)
    return null
  }
  return data.user_id
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // ---- Verify Stripe signature ----
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    console.error('Missing stripe-signature header')
    return new Response('Missing signature', { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  console.log(`📨 Stripe event: ${event.type} (${event.id})`)

  // ---- Handle events ----
  switch (event.type) {

    // ========================================
    // CHECKOUT COMPLETED — user just paid
    // ========================================
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session

      // client_reference_id = Supabase user_id (set in create-checkout)
      const userId = session.client_reference_id
      const customerId = session.customer as string
      const subscriptionId = session.subscription as string

      if (!userId) {
        console.error('checkout.session.completed missing client_reference_id')
        break
      }

      await updateUserTier(userId, 'paid', customerId, subscriptionId)

      // Also update any family members (invited_by this admin) to 'paid'
      const { data: members } = await supabaseAdmin
        .from('user_profile')
        .select('user_id')
        .eq('invited_by', userId)

      if (members?.length) {
        for (const m of members) {
          await updateUserTier(m.user_id, 'paid')
        }
        console.log(`✅ Updated ${members.length} family member(s) to paid`)
      }

      break
    }

    // ========================================
    // SUBSCRIPTION UPDATED — plan change, renewal, payment method change
    // ========================================
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string
      const status = subscription.status

      const userId = await getUserIdByStripeCustomer(customerId)
      if (!userId) break

      // Active or trialing = paid; anything else = free
      if (status === 'active' || status === 'trialing') {
        await updateUserTier(userId, 'paid', customerId, subscription.id)
      } else if (status === 'past_due' || status === 'unpaid') {
        // Give a grace period — don't downgrade immediately on past_due
        // Stripe will retry payment. Only downgrade on explicit cancel/expire.
        console.log(`⚠️ Subscription ${subscription.id} is ${status} — keeping paid for now`)
      } else {
        // canceled, incomplete_expired, etc.
        await updateUserTier(userId, 'free', customerId, subscription.id)

        // Downgrade family members too
        const { data: members } = await supabaseAdmin
          .from('user_profile')
          .select('user_id')
          .eq('invited_by', userId)

        if (members?.length) {
          for (const m of members) {
            await updateUserTier(m.user_id, 'free')
          }
          console.log(`⬇️ Downgraded ${members.length} family member(s) to free`)
        }
      }

      break
    }

    // ========================================
    // SUBSCRIPTION DELETED — cancelled and period ended
    // ========================================
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string

      const userId = await getUserIdByStripeCustomer(customerId)
      if (!userId) break

      await updateUserTier(userId, 'free', customerId, subscription.id)

      // Downgrade family members too
      const { data: members } = await supabaseAdmin
        .from('user_profile')
        .select('user_id')
        .eq('invited_by', userId)

      if (members?.length) {
        for (const m of members) {
          await updateUserTier(m.user_id, 'free')
        }
        console.log(`⬇️ Downgraded ${members.length} family member(s) to free`)
      }

      break
    }

    // ========================================
    // INVOICE PAYMENT FAILED — payment retry failed
    // ========================================
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string

      // Only downgrade if this is a subscription invoice and final attempt
      if (invoice.billing_reason === 'subscription_cycle' || invoice.billing_reason === 'subscription_update') {
        // Check attempt count — Stripe retries up to 4 times by default
        // We'll log but not downgrade; subscription.updated/deleted handles the final state
        console.log(`⚠️ Payment failed for customer ${customerId} — Stripe will retry. Attempt: ${invoice.attempt_count}`)
      }

      break
    }

    default:
      console.log(`Unhandled event type: ${event.type}`)
  }

  // Always return 200 so Stripe doesn't retry
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
