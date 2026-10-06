# Setup C: TikTok for Developers

Time needed: about 30 minutes, then waiting days for TikTok's review. Cost: free.
You will end up with a **Client Key** and a **Client Secret** to paste into Expect Less Output.

TikTok changes these screens often. If a screen does not match, screenshot it and ask Claude "where do I click?"

## Before you start

You need these four web pages live on your website first. SETUP_D creates them:
- App info page, for example `https://expectlessmedia.com/output/`
- Privacy policy, for example `https://expectlessmedia.com/privacy/`
- Terms of service, for example `https://expectlessmedia.com/terms/`
- Login return page, for example `https://expectlessmedia.com/oauth/tiktok/`

You also need:
- The app icon: `brand/elo_icon_1024_dark.png` (already square, 1024 by 1024).
- Your Cloudflare login (to prove you own the website).

## Two kinds of approval

1. **App review.** This makes your app usable. With it, Expect Less Output can send videos to each brand's TikTok drafts (inbox). You tap Post in the TikTok app. This is Expect Less Output's "Drafts" mode.
2. **Direct Post audit.** This is a second, stricter review that lets Expect Less Output post publicly on its own. Until it passes, anything Expect Less Output posts directly comes out Private. Apply for it after Drafts mode is working.

## Step 1: Create a developer account

1. Go to https://developers.tiktok.com
2. Click **Log in**. Log in with a TikTok account you will keep (your main brand account or a personal one). This account owns the developer app. It does not have to be every brand.
3. Follow the prompts to finish registering as a developer. If it asks individual or organization, pick **Organization** if you can enter your LLC details, otherwise **Individual**.

## Step 2: Create the app

1. Click your profile picture (top right), then **Manage apps**, then **Connect an app** (or **Create app**).
2. Fill in:
   - **App name:** `Expect Less Output`
   - **App icon:** upload `elo_icon_1024_dark.png` from the `brand` folder.
   - **Category:** pick the closest match to content creation or productivity.
   - **Description:** "Expect Less Output is a private desktop app the owner uses to schedule and publish short videos to TikTok accounts he owns."
   - **Terms of Service URL:** your terms page.
   - **Privacy Policy URL:** your privacy page.
   - **Platforms:** check **Web** (and **Desktop** if offered). For Website URL use your app info page.
3. Click **Save**.

## Step 3: Prove you own the website (URL properties)

1. In the app settings, find **URL properties** (or "Verify domains"). Click **Verify**.
2. Choose **Domain**, type `expectlessmedia.com`, and click **Verify**.
3. TikTok shows a **TXT record**, a long piece of text starting with something like `tiktok-developers-site-verification=`. Click **Copy**.
4. In a new tab go to https://dash.cloudflare.com and log in.
5. Click your domain **expectlessmedia.com**, then **DNS** in the left menu, then **Records**.
6. Click **Add record**.
   - Type: **TXT**
   - Name: `@`
   - Content: paste the text from TikTok.
   - Click **Save**.
7. Go back to TikTok and click **Verify**. If it fails, wait 10 minutes and try again.

## Step 4: Add Login Kit

1. In the app, click **Add products**. Add **Login Kit**.
2. In Login Kit settings, under **Redirect URI**, add:
   ```
   https://expectlessmedia.com/oauth/tiktok/
   ```
   It must exactly match the page from SETUP_D, including the slash at the end.
3. Click **Save**.

## Step 5: Add Content Posting API

1. Click **Add products** and add **Content Posting API**.
2. Turn on **Upload** (send to drafts).
3. If you see a **Direct Post** toggle, turn it ON too. This only prepares the app; real public posting still needs the audit.
4. Click **Save**.

## Step 6: Pick the scopes (permissions)

In the **Scopes** section, make sure these are added:
- `user.info.basic`
- `video.upload`
- `video.publish`

## Step 7: Copy your keys

1. On the app page, find **Client key** and **Client secret** (click the eye icon or **Show**).
2. Save both in your "ELO Keys" note. Do not share them or paste them into any chat.

## Step 8: Test in Sandbox (optional, while you wait)

1. If you see a **Sandbox** option, click it and create a sandbox.
2. Under **Target users**, add the TikTok accounts for your brands (you log in to each one to accept).
3. Paste the sandbox Client Key and Secret into Expect Less Output and test connecting. If Sandbox does not allow uploading, skip ahead and submit for review.

## Step 9: Submit the app for review

1. You need a short screen recording of Expect Less Output. After Phase 4 is built, open Expect Less Output's TikTok **Demo mode** and press Command + Shift + 5 to record your screen. Show: connecting a TikTok account, writing a post, choosing privacy, accepting the consent line, and sending it.
   - If you must submit before Phase 4 is done, ask Claude Code for a simple click-through mockup to record.
2. Click **Submit for review**.
3. Explanation box (edit as needed): "Expect Less Output is a private, single-user desktop app. The owner uses it to schedule videos for TikTok accounts he owns. It uses Login Kit to connect his accounts, video.upload to send videos to his drafts, and video.publish to post with the privacy and interaction settings he chooses on each post. No other users' data is accessed."
4. Upload the recording and submit.
5. Watch your email. If TikTok asks for changes, paste their message into Claude Code and ask it to fix the app.

## Step 10: Apply for the Direct Post audit (after Drafts mode works)

1. In the developer portal, find the **Content Posting API audit** application (on the Content Posting API product page or in TikTok's docs under "audit").
2. Use the same explanation and a new screen recording of Expect Less Output's full TikTok posting screen.
3. When TikTok approves, switch each TikTok account's mode in Expect Less Output from **Drafts** to **Direct post**.

## Step 11: Connect each brand (after Phase 4 is built)

1. In Expect Less Output go to **Connections**, then **TikTok**, paste the Client Key and Secret, and click **Save**.
2. Go to **Brands**, pick a brand, and click **Connect TikTok**.
3. In the browser, log in to THAT brand's TikTok account. If you are logged in as a different account, log out of tiktok.com first.
4. Click **Authorize**. The website page sends you back to Expect Less Output. If it does not, copy the code shown on the page, click **Paste code** in Expect Less Output, and paste it.
5. Repeat for each brand.
