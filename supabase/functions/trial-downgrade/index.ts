import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// Trial Downgrade Cron
// Runs daily — downgrades expired trial users to free tier.
// Schedule in Supabase Dashboard: 0 0 * * * (midnight UTC daily)
// ---------------------------------------------------------------------------

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

serve(async (_req) => {
  try {
    // Find all users with active trials that started more than 14 days ago
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 14)

    const { data: expiredTrials, error: queryErr } = await supabaseAdmin
      .from('user_profile')
      .select('user_id, trial_start_date, stripe_customer_id, stripe_subscription_id')
      .eq('trial_status', 'active')
      .lt('trial_start_date', cutoff.toISOString())

    if (queryErr) {
      console.error('Error querying expired trials:', queryErr.message)
      return new Response(JSON.stringify({ error: queryErr.message }), { status: 500 })
    }

    if (!expiredTrials || expiredTrials.length === 0) {
      console.log('No expired trials found')
      return new Response(JSON.stringify({ processed: 0 }), { status: 200 })
    }

    console.log(`Found ${expiredTrials.length} expired trial(s)`)

    let downgraded = 0
    let converted = 0

    for (const user of expiredTrials) {
      // Check if user has an active Stripe subscription
      let hasActiveSubscription = false

      if (user.stripe_subscription_id) {
        try {
          const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY')
          if (STRIPE_SECRET) {
            const res = await fetch(
              `https://api.stripe.com/v1/subscriptions/${user.stripe_subscription_id}`,
              {
                headers: { 'Authorization': `Bearer ${STRIPE_SECRET}` },
              }
            )
            if (res.ok) {
              const sub = await res.json()
              hasActiveSubscription = sub.status === 'active' || sub.status === 'trialing'
            }
          }
        } catch (err) {
          console.error(`Error checking Stripe for ${user.user_id}:`, (err as Error).message)
        }
      }

      // Also check if they were already upgraded to 'paid' by webhook
      // (e.g., Apple IAP receipt validation set subscription_tier = 'paid')
      const { data: currentProfile } = await supabaseAdmin
        .from('user_profile')
        .select('subscription_tier')
        .eq('user_id', user.user_id)
        .single()

      if (hasActiveSubscription || currentProfile?.subscription_tier === 'paid') {
        // User converted — mark trial as converted
        await supabaseAdmin
          .from('user_profile')
          .update({
            trial_status: 'converted',
            subscription_tier: 'paid',
          })
          .eq('user_id', user.user_id)
        console.log(`✅ User ${user.user_id} converted (active subscription)`)
        converted++
      } else {
        // No subscription — downgrade to free
        await supabaseAdmin
          .from('user_profile')
          .update({
            trial_status: 'expired',
            subscription_tier: 'free',
          })
          .eq('user_id', user.user_id)

        // Also downgrade family members
        const { data: members } = await supabaseAdmin
          .from('user_profile')
          .select('user_id')
          .eq('invited_by', user.user_id)

        if (members?.length) {
          for (const m of members) {
            await supabaseAdmin
              .from('user_profile')
              .update({
                trial_status: 'expired',
                subscription_tier: 'free',
              })
              .eq('user_id', m.user_id)
          }
          console.log(`⬇️ Downgraded ${members.length} family member(s)`)
        }

        console.log(`⬇️ User ${user.user_id} trial expired → free`)
        downgraded++
      }
    }

    const result = { processed: expiredTrials.length, downgraded, converted }
    console.log('Trial downgrade complete:', result)
    return new Response(JSON.stringify(result), { status: 200 })
  } catch (error) {
    console.error('Trial downgrade error:', (error as Error).message)
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 })
  }
})
