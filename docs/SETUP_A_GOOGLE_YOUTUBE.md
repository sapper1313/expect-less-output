# Setup A: Google Cloud for YouTube

Time needed: about 20 minutes. Cost: free.
You will end up with a **Client ID** and a **Client Secret** to paste into Expect Less Output.

Google renames buttons sometimes. If a screen looks different, screenshot it and ask Claude "where do I click?"

## Before you start

- Decide which Google account will OWN the developer project. Use one account you will keep forever (for example an Expect Less Media Google account). This account does NOT need to own any of the YouTube channels.
- Each brand's YouTube channel will be connected later by signing in with that brand's own Google account. That is normal.
- Use Chrome or Safari on your MacBook.

## Step 1: Open Google Cloud

1. Go to https://console.cloud.google.com
2. Sign in with the OWNER Google account.
3. If you see a Terms of Service box, pick your country (United States), check the box to agree, and click **Agree and continue**.

## Step 2: Create a project

1. At the very top of the page, to the right of the "Google Cloud" logo, click the **project picker** (it may say "Select a project").
2. In the window that opens, click **New Project** (top right of that window).
3. Project name: `Expect Less Output`
4. Leave Organization and Location as they are.
5. Click **Create**.
6. Wait about 30 seconds. Click the project picker again and click **Expect Less Output** so it is selected. The top bar must say Expect Less Output from now on.

## Step 3: Turn on the YouTube API

1. Click the **menu icon** (three lines, top left).
2. Go to **APIs & Services**, then **Library**.
3. In the search box type `YouTube Data API v3` and press Return.
4. Click **YouTube Data API v3**.
5. Click the blue **Enable** button. Wait until the page changes.

## Step 4: Set up the sign-in screen (OAuth consent)

1. Click the **menu icon**, go to **APIs & Services**, then **OAuth consent screen**. (On newer screens this opens "Google Auth Platform".)
2. Click **Get started**.
3. **App information:**
   - App name: `Expect Less Output`
   - User support email: pick your owner email from the dropdown.
   - If it asks for an app logo, you can skip it. (Uploading a logo can trigger a Google review, so leave it blank.)
   - Click **Next**.
4. **Audience:** choose **External**. Click **Next**.
5. **Contact information:** type your email. Click **Next**.
6. **Finish:** check the box agreeing to the Google API Services User Data Policy. Click **Continue**, then **Create**.
7. In the left menu click **Data Access** (or "Scopes").
   - Click **Add or remove scopes**.
   - In the filter box type `youtube`.
   - Check these three:
     - `.../auth/youtube.upload`
     - `.../auth/youtube`
     - `.../auth/youtube.readonly`
   - Click **Update** at the bottom, then **Save**.
8. In the left menu click **Audience**.
   - Under "Publishing status" click **Publish app**, then **Confirm**.
   - It should now say **In production**.
   - Why this matters: if you leave it in "Testing," your YouTube connections stop working every 7 days.
   - Ignore any message about verification. You do not need Google verification for personal use.

## Step 5: Create the Client ID and Client Secret

1. In the left menu click **Clients** (older screens: **APIs & Services**, then **Credentials**, then **Create credentials**, then **OAuth client ID**).
2. Click **Create client**.
3. Application type: **Desktop app**.
4. Name: `Expect Less Output Mac`
5. Click **Create**.
6. A box shows your **Client ID** and **Client Secret**. Click **Download JSON** and save the file somewhere safe (for example a folder named "ELO Keys" in Documents).
7. Do not email, text, or share these. Do not paste them into any chat. You will paste them only into Expect Less Output's Settings screen.

## Step 6: Paste into Expect Less Output (after Phase 2 is built)

1. Open Expect Less Output, go to **Connections**, then **Google / YouTube**.
2. Open the JSON file you downloaded with TextEdit (right-click the file, Open With, TextEdit).
3. Copy the value after `"client_id":` (without quotes) into **Client ID**.
4. Copy the value after `"client_secret":` (without quotes) into **Client Secret**.
5. Click **Save**.

## Step 7: Connect each brand's YouTube channel

Do this once per brand.

1. In Expect Less Output, go to **Brands**, pick a brand, click **Connect YouTube**.
2. Your browser opens. Choose that brand's Google account (click "Use another account" if needed).
3. You will see "Google hasn't verified this app." This is expected because it is your own private app. Click **Advanced**, then **Go to Expect Less Output (unsafe)**.
4. If Google asks you to pick a channel, pick that brand's channel.
5. Check every permission box and click **Continue**.
6. When the page says "Connected," close the tab and go back to Expect Less Output.
7. Repeat for the next brand.

## Step 8: Test (uploads stay private for now)

1. In Expect Less Output set that YouTube account's mode to **Test private**.
2. Schedule a short test video 5 minutes out.
3. Check YouTube Studio. You should see it uploaded as Private.
4. Delete the test video in YouTube Studio.
5. Switch the mode back to **Manual assist** until Step 9 is approved.

## Step 9: Ask Google to approve public uploads (the audit)

Until this is approved, any video uploaded through your app is locked as Private. Use "Manual assist" mode in the meantime.

1. Search Google for: `YouTube API Services Audit and Quota Extension Form` and open the form on support.google.com.
2. Sign in with the OWNER Google account.
3. Fill it in. Suggested answers (edit to match your situation):
   - **Organization:** Expect Less Media (or your LLC name).
   - **Website:** https://expectlessmedia.com (the Expect Less Output info page from SETUP_D).
   - **Google Cloud project number:** in Google Cloud, click the project picker; the number is next to Expect Less Output. Or open the menu, go to **IAM & Admin**, then **Settings**.
   - **How does your app use the YouTube API?** "Expect Less Output is a private desktop app used only by me to upload and schedule Shorts to YouTube channels that I own. It uploads videos with titles, descriptions, tags, made-for-kids and altered or synthetic content settings, and scheduled publish times. It does not access any other users' data."
   - **Number of users:** 1.
   - **Quota needed:** the default is enough; say the default.
   - If asked for screenshots or a screen recording, record Expect Less Output connecting a channel and scheduling a post (Command + Shift + 5 on the Mac records the screen).
4. Submit. Approval can take days to weeks. Watch the owner email for questions from Google and answer them quickly.
5. When approved, switch each YouTube account's mode in Expect Less Output to **Auto**.
