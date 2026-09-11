// Setup and troubleshooting answers, in one place.
//
// Shown in the Help Center (SupportPage) and exported to Maggie's knowledge
// base (scripts/faq-to-markdown.mjs writes the section that gets pasted into
// maggie-knowledge-base.md and the maggie_prompts row). Edit here, then run
// the script, so the app and the assistant never disagree.
//
// Voice: plain, short, kitchen-table. No jargon, no em dashes.

export const SETUP_FAQ = [
  {
    title: 'Setting up for someone you look after',
    audience: 'adult child',
    items: [
      {
        q: 'How do I set Hammock365 up for my mom or dad?',
        a: 'On your own phone, tap "Get Started" and create your account with your name, mobile number, email, and a password. Next, type the first name of the person you look after, their mobile number, and the time they should check in by. Then tap "Text them the link." That is it on your side. The app shows "Waiting for [name] to join" until they open the link.',
      },
      {
        q: 'I am not with my parent right now. Can I still set it up?',
        a: 'Yes. That is how it is meant to work. You set up from wherever you are, and the link goes to their phone by text. They open it when they get a minute, choose an email and password, and their button appears. You never need to be in the same room.',
      },
      {
        q: 'What does my parent see when they open the link?',
        a: 'A screen that says "Hi [their name]. [Your name] set up Hammock365 so you can let them know you are okay each morning with one tap." They type an email and a password, tap Continue, and land on their big "I\'m Okay Today" button. No questions, no settings.',
      },
      {
        q: 'Does my parent have to install an app?',
        a: 'No. The link works in the phone\'s web browser. If they want an icon on their home screen, the app can be installed from the App Store or Google Play, or they can add the web page to the home screen. Signing in with the same email and password works in all of them.',
      },
      {
        q: 'My parent does not have an email address.',
        a: 'Any email they can get into works, and it is only used to sign in and to reset a forgotten password. If they truly have none, you can create a free Gmail address for them, or sign them in with Google or Apple on their phone. Another option: open their link on their phone while you are together and set it up with them.',
      },
      {
        q: 'I am holding my parent\'s phone right now. What do I do?',
        a: 'During setup, tap "I\'m holding their phone right now" on the invite screen. It signs you out of that phone and opens their setup. Later, sign in on your own phone with your email to see their check-ins. If you already finished setup, open the Family page, tap "Copy the link," and open it in the browser on their phone.',
      },
      {
        q: 'How do I add my brother, sister, or a caregiver?',
        a: 'Tap the family icon at the top of your home screen. Type their mobile number and tap Send, and they get a text with a link. You can also share the link or the 6-character family code any way you like. On the paid plan everyone who joins gets the texts and can send a nudge; the free plan covers one family contact.',
      },
      {
        q: 'Where do I find the family code?',
        a: 'On the Family page, under "Invite family members." It is 6 letters and numbers. A family member enters it on the sign-up screen under "Have an invite code?"',
      },
      {
        q: 'How do I change the check-in time, or my parent\'s name or number?',
        a: 'Settings, from the gear icon at the top of your home screen. The "Person you look after" section holds their name and mobile number. The "Check-in reminder" section holds the time. Changes take effect right away.',
      },
      {
        q: 'How do I know it worked?',
        a: 'Your home screen changes from "Waiting for [name] to join" to their name and check-in status. The first time they tap their button the screen shows "[name] is okay, checked in at [time]." On the paid plan you also get a text for each check-in.',
      },
    ],
  },
  {
    title: 'When something is not working',
    audience: 'adult child',
    items: [
      {
        q: 'My parent never got the invite text.',
        a: 'First check the number in Settings under "Person you look after." Then tap "Text [name] the link again" on your home screen. If it still does not arrive, tap "Copy the link" and send it from your own phone, or read them the family code over the phone. Some carriers hold texts that contain links for a few minutes. If nothing shows up after a day, we send it again automatically and let you know.',
      },
      {
        q: 'The link says it is no longer valid.',
        a: 'Usually the link was typed by hand with a wrong character, or the person already joined. Send the link again from your home screen. If they already have an account, they should sign in instead of signing up.',
      },
      {
        q: 'My parent forgot their password.',
        a: 'On the sign-in screen, tap "Forgot password?" and a reset link goes to their email. If you set up their email, you can do this for them. Passwords are never shown to us, so we cannot look one up.',
      },
      {
        q: 'My parent tapped the button but I did not get a text.',
        a: 'Check three things. Your mobile number is in Settings and correct. The text for each check-in is a paid-plan feature (the free plan texts one contact only when a check-in is missed or I Need Help is pressed). And you have not replied STOP to a Hammock365 text, which turns texts off; reply START to turn them back on. The check-in still shows in the app either way.',
      },
      {
        q: 'I got a "hasn\'t checked in" alert but they are fine.',
        a: 'The alert goes out once, at the check-in time you chose, if the button has not been tapped that day. They can still tap it late and you will get the check-in text. If mornings are hard, move the check-in time later in Settings.',
      },
      {
        q: 'My parent tapped it twice, or tapped it by mistake.',
        a: 'Nothing bad happens. The button only counts once a day and turns green after the first tap. Extra taps do nothing.',
      },
      {
        q: 'Can I look after two people?',
        a: 'Right now one family has one person who checks in. For a second parent, create a second account with a different email and set them up the same way.',
      },
      {
        q: 'The app is not loading or looks stuck.',
        a: 'Close it fully and open it again, and make sure the phone has a signal or Wi-Fi. If it still hangs, sign out from Settings and sign back in. If that fails, text Ryan at (336) 553-8933 with what you see on the screen.',
      },
    ],
  },
  {
    title: 'For the person who checks in',
    audience: 'senior',
    items: [
      {
        q: 'What am I supposed to do each day?',
        a: 'Open Hammock365 and tap the big blue button that says "I\'m Okay Today." Once a day is all it takes. It turns green and says "You\'re checked in." Your family sees it right away, and on the paid plan they get a text too.',
      },
      {
        q: 'Do I have to keep the app open?',
        a: 'No. Tap the button, then close it or put the phone down. Nothing runs in the background.',
      },
      {
        q: 'I forgot to tap it this morning.',
        a: 'Tap it as soon as you remember. Your family may have gotten a note that you had not checked in yet, and your tap sends them the good news. Nobody is in trouble.',
      },
      {
        q: 'What is the red "I Need Help" button?',
        a: 'It sends an urgent text asking your family to check on you right away: one family contact on the free plan, everyone on the paid plan. It asks "Are you sure?" first, so a bump does not send it. It is not 911. If it is an emergency, call 911.',
      },
      {
        q: 'I cannot find the app on my phone.',
        a: 'Open the text message your family sent and tap the link again. If you want an icon on your home screen, ask your family to help you add it, or install Hammock365 from the App Store or Google Play and sign in with the same email and password.',
      },
      {
        q: 'The writing is too small.',
        a: 'If you use the Hammock365 app from the App Store or Google Play, make the text bigger in your phone\'s Settings under Display or Accessibility, and the app follows it. If you open Hammock365 in Safari or Chrome, use the browser\'s own text size button (the aA at the top of the screen in Safari). Your family can help with this over the phone.',
      },
      {
        q: 'It is asking me to sign in and I do not remember how.',
        a: 'Use the email and password you chose when you first opened the link. If you do not remember the password, tap "Forgot password?" and follow the email. Your family can help with this.',
      },
      {
        q: 'Who sees that I checked in?',
        a: 'Only the family members who joined your family in Hammock365. Nobody else.',
      },
      {
        q: 'Can I add a note, like "going to the store"?',
        a: 'Yes. After you tap "I\'m Okay Today," a box appears where you can type a short note. On the paid plan it shows up in the family messages. If you do not want to, just skip it.',
      },
      {
        q: 'What is "Ask a question"?',
        a: 'A helper for everyday things: a recipe, the weather, help writing a card, how to do something on your phone. It is not a doctor or a lawyer. For anything medical, legal, or about money, ask your family or a professional.',
      },
    ],
  },
  {
    title: 'Your plan and billing',
    audience: 'adult child',
    items: [
      {
        q: 'Is Hammock365 free?',
        a: 'Yes. The free plan is free forever, no card: the daily check-in button, a text to one family contact when the check-in is missed or I Need Help is pressed, a push nudge, the check-in history, the emergency card, medication reminders on the senior\'s screen, the senior\'s invite by text or link, siblings and caregivers joining by code to see the same board, and 10 messages with Maggie.',
      },
      {
        q: 'What does the paid plan add, and what does it cost?',
        a: '$14.99 a month. Texts to everyone in the family (the daily check-in, a missed check-in, I Need Help), a notification to the family when a dose is not marked taken within an hour, the document vault, family chat with photos and the note on each check-in, appointments, and Maggie every day. Paid features show a lock in the app; tap one to see the price.',
      },
      {
        q: 'Is there a trial?',
        a: 'On the website, tapping a locked feature offers seven free days with a card, once per family, then $14.99 a month unless you cancel first. In the iPhone and Android apps the App Store and Google Play run their own free trial on the same subscription. Nothing is charged during the free days, and we remind you before the first charge.',
      },
      {
        q: 'How do I cancel?',
        a: 'On the web, open Settings, scroll to Subscription, and tap Cancel Subscription. You keep everything until the end of the period you already paid for, and nothing is charged after that. On an iPhone, cancel in Settings > your name > Subscriptions. On Android, cancel in the Play Store under Subscriptions. Cancelling puts the family back on the free plan; the check-in and the one-contact text keep working.',
      },
      {
        q: 'What happens if a payment fails?',
        a: 'We retry the card for about a week and text you once before anything turns off. If it never goes through, the family goes back to the free plan. Nothing is deleted.',
      },
      {
        q: 'Does the person I look after pay anything? Do my siblings?',
        a: 'No. One plan covers the whole family, and only the person who set up the family has a card on file. On the free plan, one family contact is included; siblings and caregivers join on the paid plan.',
      },
      {
        q: 'I signed up on the website but use the iPhone app. Where is my subscription?',
        a: 'Wherever you started it. A plan started on the website is managed in Settings on the website; a plan started in the iPhone or Android app is managed through the App Store or Google Play. The app works the same either way, and it will tell you which one you have if you try to subscribe twice.',
      },
    ],
  },
]
