# Expect Less Output: User Guide

This guide is for you, the owner. Every step is meant to be followed exactly, one at a time.

Phase note: YouTube (Phase 2), Facebook Pages and Instagram (Phase 3) are real now. TikTok is still a "dry run". A dry run waits a few seconds and says it worked, and never contacts the platform. Their real connections come in later phases.

---

## 1. Start the app in dev mode (for testing and changes)

1. Open the **Terminal** app on your Mac.
2. Paste this line and press Return:

   ```
   cd ~/Projects/expect-less-output
   ```

3. The first time only, paste this and press Return. It downloads what the app needs and takes a few minutes:

   ```
   npm install
   ```

4. Paste this and press Return:

   ```
   npm run dev
   ```

5. The app window opens. A small machine icon appears in the menu bar at the top of the screen.
6. To stop it, click the menu bar icon and choose **Quit**. Or press Control and C in the Terminal.

## 2. Build the real app

1. In Terminal, paste:

   ```
   cd ~/Projects/expect-less-output
   ```

2. Paste:

   ```
   npm run dist
   ```

3. Wait. It takes a few minutes. When it ends, the app is in the `release` folder inside the project, in a folder named `mac-arm64`, and a `.dmg` installer is next to it.

## 3. Install it into Applications

1. In Finder, open `Projects`, then `expect-less-output`, then `release`.
2. Double click the file that ends in `.dmg`.
3. A window opens. Drag **Expect Less Output** onto the **Applications** folder shown in that window.
4. Close the window. Eject the disk image from the Finder sidebar.

## 4. Open an unsigned app the first time

The app is not signed with an Apple developer account, so macOS blocks a normal double click the first time.

1. Open **Applications** in Finder.
2. **Right click** (or hold Control and click) **Expect Less Output**.
3. Choose **Open**.
4. A warning appears. Click **Open** again.
5. From now on a normal double click works.

If macOS still refuses: open **System Settings**, then **Privacy and Security**, scroll down, and click **Open Anyway** next to Expect Less Output.

## 5. Test a dry run post

1. Click **New Post** in the left list.
2. Drag a vertical video (MP4 or MOV) onto the box, or click **Choose a video**.
3. Pick the brand. The title and caption fill in for you.
4. Leave all four platforms ticked. They say "dry run".
5. Under **When**, pick a time. For a quick test choose **Pick a different time...** and set it 3 minutes from now.
6. Click **Fine.**
7. A message says **Task adequate.** The post shows on the **Calendar**.
8. Wait until the time. The post turns to **posted**. Open **Queue** to see each platform marked as done.
9. Open the Media Root folder (Settings, then **Open**). The video moved from the brand's `Queue` folder to `Posted`, then the month.

### Test a failure

1. Open **Settings**. Under **Testing tools**, set **Force a failure on** to a platform, for example Instagram.
2. Tick **Short retry waits** so you do not wait half an hour.
3. Schedule a post for 1 minute from now.
4. Watch **Activity Log**. It tries 4 times in total (the first try and 3 retries), then shows **Could not post. Probably for the best.** with the real reason and a **Retry** button.
5. Set **Force a failure on** back to **No platform** and untick the short waits when you are done.

## 6. Everyday use

- **Schedule many videos at once:** click **Bulk Upload**, pick the brand, choose the videos, click **Assign slots**, fix anything in the table, then click **Fine.**
- **Move a post:** on the **Calendar**, drag it to another day. Confirm the question.
- **Edit a post:** click it on the Calendar or in the Queue.
- **Brand times:** open **Brands**. Each brand has weekday and weekend posting times in Eastern time.
- **Pause everything:** click the menu bar icon and choose **Pause scheduler**.

## 7. Good to know

- Closing the window does not stop posting. The app keeps running in the menu bar. Use **Quit** in the menu bar menu to really stop it.
- The Mac must be awake and on for posts to go out. While a post is due within 30 minutes, the app keeps the Mac from sleeping.
- If the Mac was asleep when a post was due, the app posts it on wake if it is less than 2 hours late (change this in Settings). Otherwise it holds the post as **missed** and tells you.
- Your data lives in `~/Library/Application Support/Expect Less Output`. Videos live in the Media Root folder (default `~/Movies/Expect Less Output`). Nothing is sent anywhere.
- Video files are copied into the app's Queue folder when you save a post. Your original file is never touched.

---

## 8. YouTube: connect a channel (Phase 2)

Do SETUP_A_GOOGLE_YOUTUBE.md steps 1 to 5 first. You need a Client ID and a Client Secret.

Keep the downloaded Google keys file outside the project folder (for example in `Documents`, in a folder named `ELO Keys`). Never share it.

### Save the Google credentials (once)

1. Open the app and click **Connections**.
2. In the **Google / YouTube credentials** box, paste the **Client ID** and the **Client Secret**. You can copy them from the downloaded JSON file (open it with TextEdit).
3. Click **Save**. They are stored encrypted. From now on the app only shows the last 4 characters.

### Connect each brand's channel

1. On **Connections**, find the brand's card. Click **Connect YouTube**.
2. Your browser opens. Pick that brand's Google account.
3. If you see "Google hasn't verified this app", click **Advanced**, then **Go to Expect Less Output (unsafe)**. This is expected for your own private app.
4. If Google asks which channel to use, pick the brand's channel. Tick every permission box. Click **Continue**.
5. The browser page says **Connected. You can close this tab and return to Expect Less Output.** Close the tab.
6. Back in the app, the card shows the channel name and a green **connected** label. If the account has several channels, the app asks you to pick one.
7. Repeat for the next brand.

To change channels, click **Reconnect**. To remove it, click **Disconnect**.

### Choose a mode

Each connected channel has a **Mode** box on its card.

- **Manual assist** (the starting mode). At the scheduled time the app shows a notification, copies the title and description, and opens YouTube Studio. You upload the video yourself. Then open the post (Calendar or Queue) and click **Mark as posted**. You can paste the video link if you want.
- **Test private**. The app really uploads, but the video stays **private**. Use it for testing only.
- **Auto**. The app uploads early (3 hours before, set in Settings) and YouTube publishes at the exact time. **Switch to Auto only after Google approves your audit (SETUP_A step 9).** Until then Google locks every upload to private.

### Test a private upload

1. On **Connections**, set the brand's mode to **Test private**.
2. Click **New Post**. Pick a short vertical video and that brand. Keep only **YouTube** ticked. Tick the **AI** box for YouTube if you want to test it.
3. Under **When**, choose **Pick a different time...** and set it 5 minutes from now.
4. Click **Fine.**
5. Wait. The app checks every 30 seconds, so allow a minute past the time. Open the post to see the upload progress.
6. Open **YouTube Studio** (studio.youtube.com) as that brand's account, then **Content**. The video is there as **Private**. Open it and check **Altered content** says Yes if you ticked the AI box.
7. **Delete the test video:** in YouTube Studio click the three dots next to it, then **Delete forever**. Confirm.
8. Back in the app, set the mode to **Manual assist** again.

### If something goes wrong

- **needs sign in** on a card: Google stopped accepting the saved login. Click **Reconnect** on that brand's card.
- **Google has not approved your app yet**: the video was locked to private. Use **Manual assist** until the audit is approved.
- **Daily limit**: the Connections screen shows how much of today's YouTube limit is used. It resets at midnight Pacific. You get a warning at 80 percent.
- You cannot move a post after the app has handed it to YouTube (Auto mode, inside the handoff window). Cancel the post, delete the scheduled video in YouTube Studio, then schedule it again.

---

## 9. Facebook Pages and Instagram: connect Meta (Phase 3)

Do SETUP_B_META_FACEBOOK_INSTAGRAM.md steps 1 to 6 first. You need an App ID and an App Secret. In step 4 the redirect address must be exactly `http://localhost:53682/meta/callback`.

Keep the keys in your `ELO Keys` folder, outside the project. Never share them.

### Save the Meta credentials (once)

1. Open the app and click **Connections**.
2. In the **Meta (Facebook Pages and Instagram)** box, paste the **App ID** and the **App Secret**.
3. Click **Save**. They are stored encrypted. From now on only the last 4 characters show.

### Connect Meta (one login for every brand)

1. Click **Connect Meta**.
2. Your browser opens a Facebook login. Sign in with the Facebook account that manages the Pages.
3. Meta asks which Pages and Instagram accounts to allow. Choose **all** brand Pages and **all** brand Instagram accounts. Click **Continue** or **Save** on every screen. Leave every permission switched on.
4. The browser page says **Connected. You can close this tab and return to Expect Less Output.** Close the tab.
5. If the app says **Port 53682 is busy**, quit any other copy of Expect Less Output and try again.

### Match each brand to its Page and Instagram

1. Under **Match brands to Pages** every brand has a row. The app pre-picks the Page and Instagram with the most similar name.
2. Fix any wrong choice with the two boxes. "None (dry run)" means that platform stays a dry run for that brand.
3. Click **Save** on each row. The brand's card above then shows the real Page and Instagram names with a green **connected** label.

### Keep the login fresh

- Meta logins last about 60 days. The Connections screen shows the date and the days left.
- 7 days before it runs out you get a notification, a banner in the left list, and a warning on the Connections screen.
- To renew, click **Reconnect Meta**, approve everything again, and your matches stay.
- **needs sign in** on a card means Meta stopped accepting the login. Click **Reconnect Meta**.
- A new brand? Create its Page and Instagram, link them together, click **Reconnect Meta**, tick the new ones, then match them.

### Post a test Reel to Facebook and Instagram

1. Click **New Post**. Pick a short vertical MP4 or MOV (Facebook needs 3 to 90 seconds). If it is longer the app tells you and will not schedule it.
2. Pick the brand. Tick **Facebook** and **Instagram**. They show a **live** label.
3. Optional: type a number in **Instagram cover frame** to pick the cover picture (1500 means 1.5 seconds in).
4. Under **When**, choose **Pick a different time...** and set it 30 minutes from now.
5. Click **Fine.**
6. What happens:
   - **Facebook:** about 3 hours before the time (the setting on the Settings screen) the app uploads the Reel and tells Facebook to publish it at the exact time. Posts with less than 15 minutes to go are published at their time instead. Open **Meta Business Suite**, then **Content**, then **Scheduled** to see it waiting.
   - **Instagram:** at the scheduled time the app uploads, waits for Instagram to process it (up to 15 minutes, checked every 30 seconds), then publishes.
7. When done the post shows **posted** and the Reel link is saved on the post.
8. If you ticked the **AI** box: Instagram gets the real AI label. Facebook has no way to do this from outside, so the post shows a yellow **Add AI label in app** note with a link. Open the post in the Facebook app, add the label, then click **Done**.
9. **Delete the test:**
   - Facebook: open the Reel from the link, click the three dots, then **Move to trash**. Or in Meta Business Suite open **Content**, find it, and delete it.
   - Instagram: open the Reel in the Instagram app, tap the three dots, then **Delete**.

### Limits to know

- Facebook allows 30 API Reels per Page per 24 hours. Instagram allows 100 API posts per account per 24 hours. The app stops with a clear message at the limit.
- A post Facebook is already holding (handed off early) cannot be moved in the app. Cancel it, delete the scheduled Reel in Meta Business Suite, then schedule it again.
- Instagram captions: up to 2200 characters and 30 hashtags.
