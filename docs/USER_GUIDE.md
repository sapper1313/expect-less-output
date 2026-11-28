# Expect Less Output: User Guide

This guide is for you, the owner. Every step is meant to be followed exactly, one at a time.

**Where everything is (version 0.20.0).** The whole app except the left menu uses one glass look, and you pick its colors in **Settings, App, Color theme** (Midnight, Ocean, Aurora, Sunset, Graphite or Daylight). The left menu is one list, in this order: Search, **Home**, **Manual Schedule**, **Inbox**, **Queue**, **Analytics**, **Setup Channels**, **Settings**, **Financial**, **AI Settings**, **AI Studio**, and **About** (with the Activity Log at the bottom of About).

- **Home**: every number in one place. The top strip shows Being written, Ready for video, Video in progress, Open slots, Scheduled, Posted this week and Needs a look. Click a tile to jump to where you fix it. Below it are the last 7 days, the best videos, a card for each channel, and the week map.
- **Manual Schedule**: New Post and Bulk Upload. A post goes to the next open slot for its channel. Tick **Pick my own date and time** to choose your own. ELO warns if it breaks a rule, and you can still go ahead.
- **Inbox**: the videos waiting for you, plus a **Comments** tab where you can read comments (read only for now).
- **Queue** and **Analytics**: the same as before.
- **Setup Channels**: pick a channel on the left, or add a new one. Tabs: **Channel Setup** (name, color, pause, archive, pipeline rules, the **Posting schedule**: times for each platform, weekdays and weekends, for Shorts and Long form), **Connections** (every login in one place: Facebook, YouTube, Instagram, TikTok, Bluesky, and the platform keys at the bottom), **Other settings by channel**, and **Website**.
- **Settings**: only things that are the same for every channel. One long page with a list at the top to jump to a part.
- **Financial**: spend caps, generate settings and the spend table.
- **AI Settings**: AI models, local AI, the Agent API, the AI keys and **Upload-Post** (the paid service that posts to TikTok). To set it up: paste the API key, press Test, type each channel's profile name exactly as it is on Upload-Post, tick the platforms you logged in there, and press Save on that channel. TikTok ticked means ELO posts to TikTok through Upload-Post. TikTok not ticked means TikTok drafts like before.
- **AI Studio**: the studio's Overview, Research, Bible, Library, Flagged, Publishing and Director's Log.

Older sections below use the old names. Translate them like this: **Schedule** is now **Manual Schedule**. **Channels** is now **Setup Channels**. **Calendar**, **Upcoming**, **Dashboard**, **TikTok demo** and **Testing tools** are gone (Home replaces Dashboard and Calendar). **Studio** is now **AI Studio**. Studio keys are in **AI Settings**. Anything about the Studio tab in Settings is now in **AI Settings**, **Financial** or **Settings**. Times are chosen with hour, minute and AM or PM drop-downs, not typed.

Phase note: Stats (Phase 7) are covered in section 17. YouTube (Phase 2), Facebook Pages and Instagram (Phase 3) are real now. TikTok (Phase 4) is real now too. A dry run waits a few seconds and says it worked, and never contacts the platform. Their real connections come in later phases.

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

1. Click **Schedule** in the left list (tab **One video**).
2. Drag a vertical video (MP4 or MOV) onto the box, or click **Choose a video**.
3. Pick the brand. The title and caption fill in for you.
4. Leave all four platforms ticked. They say "dry run".
5. Under **When**, pick a time. For a quick test choose **Pick a different time...** and set it 3 minutes from now.
6. Click **Save**
7. A message says **Task adequate.** The post shows on the **Calendar**.
8. Wait until the time. The post turns to **posted**. Open **Queue** to see each platform marked as done.
9. Open the Media Root folder (Settings, then **Open**). The video moved from the brand's `Queue` folder to `Posted`, then the month.

### Test a failure

The Testing tools were removed from the app in 0.18.0 because they were not used. Failed posts still show a plain reason and a **Try the upload again** or **Retry** button in the Queue.

## 6. Everyday use

- **Schedule many videos at once:** click **Schedule**, then the tab **Many videos**, pick the brand, choose the videos, click **Assign slots**, fix anything in the table, then click **Save**
- **Move a post:** on the **Calendar**, drag it to another day. Confirm the question.
- **Edit a post:** click it on the Calendar or in the Queue.
- **Brand times:** open **Brands**. Each brand has weekday and weekend posting times in Eastern time.
- **Pause everything:** click the menu bar icon and choose **Pause scheduler**.

## 7. Good to know

- Closing the window does not stop posting. The app keeps running in the menu bar. Pressing Command+Q does the same thing: it only hides the window. Use **Quit** in the menu bar icon's menu to really stop it. Shutting down or restarting the Mac still works normally.
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
2. Click **Schedule**. Pick a short vertical video and that brand. Keep only **YouTube** ticked. Tick the **AI** box for YouTube if you want to test it.
3. Under **When**, choose **Pick a different time...** and set it 5 minutes from now.
4. Click **Save**
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

1. Click **Schedule**. Pick a short vertical MP4 or MOV (Facebook needs 3 to 90 seconds). If it is longer the app tells you and will not schedule it.
2. Pick the brand. Tick **Facebook** and **Instagram**. They show a **live** label.
3. Optional: type a number in **Instagram cover frame** to pick the cover picture (1500 means 1.5 seconds in).
4. Under **When**, choose **Pick a different time...** and set it 30 minutes from now.
5. Click **Save**
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

---

## 10. TikTok (Phase 4)

Do SETUP_C_TIKTOK.md steps 1 to 7 first. You need a Client Key and a Client Secret. The website pages from SETUP_D must be live, especially `https://expectlessmedia.com/oauth/tiktok/`.

Your TikTok app starts in **Sandbox**. That is fine for Drafts mode. Direct post stays locked until TikTok approves the audit.

### Save the TikTok credentials (once)

1. Open the app and click **Connections**.
2. In the **TikTok credentials** box, paste the **Client Key** and the **Client Secret**.
3. Leave **Redirect URI** as it is: `https://expectlessmedia.com/oauth/tiktok/`. It must match the Login Kit Redirect URI in the TikTok developer portal exactly, including the slash at the end.
4. Leave **Also ask for video.publish** switched off for now.
5. Click **Save**. They are stored encrypted. Only the last 4 characters show afterward.

### Connect each brand's TikTok account

1. On **Connections**, find the brand's card, then the **TikTok** box. Click **Connect TikTok**.
2. Your browser opens TikTok. **Log in to THAT brand's TikTok account.** If you are logged in as a different account, log out of tiktok.com first.
3. Click **Authorize**.
4. The website page sends you back to the app. If your Mac asks "Open Expect Less Output?", click **Open**. The box then shows a green **connected** label.
5. If the app does not come back (this always happens when you start the app with `npm run dev`):
   - On the website page, click **Copy** next to the code.
   - In the app, paste it into the **Paste code** box (it appears while the app is waiting) and click **Use this code**.
6. Repeat for each brand. The first mode is **Drafts**.

### Send a test draft and finish it in the TikTok app

1. Click **Schedule**. Pick a short vertical video and the brand. Keep only **TikTok** ticked.
2. Under **TikTok** you will see "Post to TikTok as" and the account name. In Drafts mode TikTok asks for privacy and settings later, in its own app.
3. Under **When**, choose **Pick a different time...** and set it 5 minutes from now.
4. Click **Save**
5. At the time, the app uploads the video. You get a notification: **TikTok draft ready for (brand). Open TikTok, tap the inbox notification, add the AI label if needed, and post.**
6. On your phone, open TikTok and tap the **Inbox** notification. Choose the privacy and settings. Add the AI label if the video is AI-made. Tap **Post**. Or delete the draft if it is only a test.
7. Back in the app, open the post (Calendar or Queue) and click **Mark as posted**. You can paste the video link if you want.

### How to record the demo video for TikTok's review

TikTok wants a screen recording of the whole flow. The demo screen never posts anything.

1. Press **Command + Shift + 5** and choose **Record Entire Screen** or **Record Selected Portion**. Click **Record**.
2. In the app press **Command + Shift + D** to open the **TikTok demo** screen.
3. Walk through the four steps with **Next**. Say or show each thing:
   - **1 Connect:** the connected account name. (If you want the real login on camera, first open **Connections**, click **Disconnect**, then **Connect TikTok**, then come back with Command + Shift + D.)
   - **2 Write the post:** type a title and caption.
   - **3 Choose settings:** pick who can view (nothing is chosen for you), the Comment, Duet and Stitch boxes, the commercial content switch with **Your brand** and **Branded content**, and tick the consent line.
   - **4 Review and send:** click **Save** and show the message.
4. Stop recording (the stop button in the menu bar). Upload that file when you submit the app for review (SETUP_C step 9) or the audit (step 10).

### Switch to Direct post after TikTok approves the audit

Only do this after TikTok has approved the Direct Post audit.

1. On **Connections**, in the **TikTok credentials** box click **Replace**, tick **Also ask for video.publish**, and click **Save**.
2. On each brand's card, click **Reconnect** and approve the new permission.
3. Change **Mode** to **Direct post**. The app asks "Has TikTok approved your Direct Post audit?" Click **Yes, it is approved**.
4. From now on, **Schedule** shows the full TikTok screen. You must choose each time:
   - **Who can view this video.** Nothing is pre-selected. The choices come from TikTok for that account.
   - **Comment, Duet, Stitch.** All start unticked. Some may be greyed out because they are off in the TikTok app.
   - **Disclose commercial content** (off by default). Branded content cannot be private.
   - The consent line (Music Usage Confirmation, and the Branded Content Policy when branded content is on).
5. **Save** stays grey until all of it is valid. Bulk Upload has one TikTok box that applies to every row.
6. Until the audit is approved, TikTok only lets the app post privately.

### Limits and problems

- TikTok allows about 15 posts a day per account. When it says the account is full, the app waits an hour and tries again (up to 24 times) and sends one alert.
- **needs sign in** on a card: TikTok stopped accepting the saved login (they last up to a year). Click **Reconnect**.
- TikTok brand defaults do not exist on purpose: TikTok's rules say you must choose privacy and interaction settings on every post.

---

## 11. Alerts (Phase 5)

The app tells you when something goes wrong, and only then (a success is just a quiet "Task adequate."). You are told when:

- a post fails for good, after its retries;
- a post is missed because the Mac was asleep;
- a login needs renewing (YouTube, Meta or TikTok);
- the Meta login is about to run out (7 days before);
- a daily limit is hit (TikTok);
- the Media Root folder goes missing (for example an unplugged drive).

Every alert shows on screen and as a macOS notification at once. You can also get it by iMessage and email.

### Set up iMessage alerts

1. Open **Settings** and find **Alerts (failures only)**.
2. Check that **iMessage** is ticked and the phone number is right. It starts as `+18046340444`. Use the form `+1` and the ten digits.
3. Click **Send test alert**.
4. The first time, macOS asks: "Expect Less Output wants to control Messages." Click **OK**.
5. If you missed that question or clicked Don't Allow:
   1. Open **System Settings**.
   2. Click **Privacy and Security**, then **Automation**.
   3. Find **Expect Less Output** and switch on **Messages**.
   4. Come back and click **Send test alert** again.
6. Messages must be signed in with your Apple ID on this Mac. Open Messages, choose Settings, then iMessage, and sign in if it is not.
7. Your phone should show a text starting "Expect Less Output test alert". If it does, you are done.

### Set up email alerts (optional)

1. Open your Google Account, then **Security**.
2. **2-Step Verification** must be on. Turn it on first if it is not.
3. Search for **App passwords** and open it.
4. Name it **Expect Less Output** and click **Create**.
5. Copy the 16 characters Google shows.
6. In the app, under **Email**, tick it, type your Gmail address in **From** and where to send in **To**, paste the 16 characters into **Gmail app password**, and click **Save**.
7. Click **Send test email**. It says if Gmail refused and why.

### Quiet hours

Tick **Quiet hours** and pick a start and end (Eastern time). During quiet hours iMessage and email wait, and you get one summary when quiet hours end. The notification on this Mac still shows.

### Many alerts at once

If more than 3 alerts happen within 5 minutes, the first 3 are sent right away and the rest are sent together as one message when the 5 minutes are up.

### What an alert looks like

> The post failed. Instagram, Trash Panda, "Fridge Math", Tue Jun 2, 5:00 PM ET. Reason: token expired. Open Expect Less Output to retry.

Open the app, find the post (Calendar or Queue) and click **Retry**.

## 12. Everyday extras (Phase 5)

- **Keyboard shortcuts:** Command+N new post, Shift+Command+N bulk upload, Command+1 calendar, Command+2 queue.
- **Duplicate a post** (to post it again): open the post and click **Duplicate**. You get a new draft with its own copy of the video.
- **Search the Queue:** type in the search box at the top of the Queue. It looks at the title, caption and file name.
- **See what each platform will get:** open a post. The box "What each platform will get" shows the final text, with the template and hashtags already applied.
- **Pause one brand:** open **Channels**, tab **Channel setup**, pick the brand, tick **Pause this brand**. This is the only place to pause a brand. It stops posting and the Studio's writing and production for that brand. Untick it to resume. A post less than your grace time late (Settings) goes out; older ones are held as missed and you are alerted.
- **Pause everything:** the pause button at the bottom of the left menu, or **Pause everything** in the menu bar icon. It pauses the Studio and the posting scheduler together.
- **Health panel:** on **Connections**, the **Health** box lists every connected account, its status, mode, last check and when its login runs out.
- **Stuck posts:** when the app starts or the Mac wakes, anything stuck uploading for over 30 minutes goes back in the queue, and anything still being processed gets checked right away.

## 13. Move to a new Mac (backup and restore)

A backup holds your brands, slots, posts, settings and thumbnails. It does **not** hold your videos, and it does **not** hold any logins or keys.

### On the old Mac

1. Open **Settings**, find **Backup and restore**, and click **Export backup**. Save the zip somewhere you can reach (for example Documents).
2. Copy your Media Root folder to the new Mac. It is `Movies/Expect Less Output` unless you changed it in Settings. Use AirDrop or an external drive.
3. Copy the backup zip to the new Mac too.
4. Keep your key notes (the "ELO Keys" folder): you will paste them again.

### On the new Mac

1. Build or copy the app and install it (section 3 and 4 of this guide). Open it.
2. Open **Settings**, then **Backup and restore**, and click **Restore from backup**. Pick the zip.
3. The app shows what is in it and which accounts you must reconnect. Click **Choose** and pick the Media Root folder you copied.
4. Click **Restore and restart**, then confirm. The app restarts.
5. A banner lists the accounts to reconnect. Open **Connections**.
6. Paste the credentials again (they are never in a backup): Google Client ID and Secret, Meta App ID and Secret, TikTok Client Key and Secret, and the Gmail app password if you use email.
7. Connect every account again (YouTube, Meta, TikTok), then check the **Health** box.
8. Open **Settings**, click **Send test alert**, and allow the Automation question for Messages.
9. Scheduled posts come back as they were. Anything that was due while the Mac was off follows your "missed post" setting.

The old data is never deleted: before a restore the app saves a copy of what was there in the `safety-backups` folder inside its data folder.

---

## 14. Agents: the local API and the Inbox folder (Phase 6)

This lets a program, or an AI assistant such as Claude, create and manage posts on this Mac with the same rules you follow on screen.

**Important:** scheduled posts only go out while Expect Less Output is running. Closing the window is fine (it keeps running in the menu bar). Quitting the app, or a Mac that is asleep or off, means nothing posts. The API and the Inbox folder only work while the app is running too.

### What agents can and cannot do

- They can: read brands and slots, find the next open slots, create posts, list and read posts, change posts, cancel posts, retry failed posts, read the calendar, read the activity log, and read health.
- They can also read Studio spend and the flagged tasks. With **Agents may change Studio settings** turned on (see below) they can change Studio spend caps, add or remove Bible skills, retry a flagged task, rebuild an episode, and pause or resume a brand.
- They can never: connect or disconnect an account, read or change a password, key or token, delete a file or a post, or change your other settings. There is simply no way to ask for those.
- The video is always COPIED into the brand's Queue folder. The original is never moved or deleted.

### Turn it on

1. Open **Settings** and find **Agents (local API and MCP)**.
2. Tick **Turn on the local API**. It says "Running on http://127.0.0.1:47821". It only listens on this Mac. To use another port, change **Port**.
3. Click **Make a token**. The token is shown **once**. Click **Copy** and keep it somewhere safe (not in a chat). Click **I copied it**.
4. If you lose it, click **Make a new token**. The old one stops working at once.

Every request must send the token: `Authorization: Bearer <token>`. A request without it, or from a web page, is refused.

### Drafts only (the safe default)

**Agents may create drafts only** is ticked by default. While it is on:

- An agent can create **drafts** (even with a proposed time) and edit drafts.
- If an agent asks for `status: "scheduled"` or `next_slot: true`, it gets a clear **403 drafts_only** error. Nothing is created and nothing is quietly turned into a draft.
- Agents cannot edit a post that is already scheduled.
- You review the drafts in the **Queue** and schedule them yourself with **Save**

Untick it only when you trust the agent. Then agents can schedule, and a mistake by an agent can post something for real.

### Try it from Terminal

```
curl -H "Authorization: Bearer PASTE_TOKEN" http://127.0.0.1:47821/v1/brands
```

The full description of every endpoint is in `docs/openapi.json`. It is generated from the same rules the app uses (run `npm run openapi` after changes).

### The Inbox folder

Drop a video into a brand's Inbox folder and a post is made.

1. Open **Brands**, pick the brand, tick **Watch this brand's Inbox folder**.
2. The folder is `Media Root / Brand name / Inbox` (for example `~/Movies/Expect Less Output/Trash Panda/Inbox`).
3. Drop in `fridge.mp4`. With **no** sidecar, after about 10 seconds a **draft** appears using the brand's defaults.
4. To control the post, drop a file with the same name and `.json` next to the video (`fridge.json`). Example:

```
{
  "title": "Fridge Math",
  "caption": "Do the math #trashpanda",
  "platforms": ["instagram", "tiktok"],
  "caption_overrides": { "instagram": "A different caption for Instagram" },
  "ai_flags": { "instagram": false, "tiktok": true },
  "status": "draft"
}
```

To schedule from a sidecar (only works when **Agents may create drafts only** is unticked) add `"status": "scheduled"` and either `"next_slot": true` or `"scheduled_at": "2026-06-02T17:00:00-04:00"`. Times must include the zone. Every field is optional. `brand_id` and `file_path` are not needed (the folder decides), and a wrong `brand_id` is refused.

To have every video in a brand's Inbox go live without opening a .json file, open **Brands**, pick the brand, and tick **Schedule Inbox videos automatically (next open slot)**. It only works when **Agents may create drafts only** is unticked in Settings, and it is off by default. Videos then go straight to the brand's next open slot with the brand's defaults, with no review. A .json file that says `"status": "draft"` still makes a draft. The brand needs posting slots set up.

To have the app fetch the video for you, drop only the `.json` file (for example `fridge.json`) with a web address in it: `"video_url": "https://example.com/fridge.mp4"`. The app downloads it, checks that it is a complete MP4 or MOV, saves it as `fridge.mp4`, and then treats it like a video you dropped in, with the same title, caption, platforms and time fields. If the download fails, the .json goes to `Inbox/Rejected` with a `.error.txt` that says why. If a video named `fridge.mp4` is already in the Inbox, that video is used and the address is ignored.

What happens next:

- The video and the sidecar are **moved** into the brand's Queue folder. Nothing is deleted.
- A file that cannot be accepted (a broken sidecar, a request to schedule while drafts-only is on, a wrong brand) is moved to `Inbox/Rejected` with a `.error.txt` that says why, and you get one alert. Nothing is quietly changed.
- The app waits until a file stops growing, so a big video that is still copying is safe.

## 15. Connect Claude with MCP (Phase 6)

MCP lets Claude use the app directly. The tools are `list_brands`, `get_next_open_slots`, `create_post`, `list_posts`, `get_post`, `update_post`, `cancel_post`, `retry_post`, `get_health`, `get_post_stats`, `get_brand_stats`, `list_episodes` and `get_episode`, plus the Studio tools in section 18. The post tools follow the drafts-only rule.

You need: the local API turned on, a token, and the MCP file. In **Settings**, **Agents**, the **Connect Claude (MCP)** box shows the exact file path and the exact text to paste for your Mac, with Copy buttons.

The MCP file is built by `npm run build:mcp` (also done by `npm run dist`). It is at `~/Projects/expect-less-output/mcp/dist/elo-mcp.mjs`, and a copy is inside the installed app at `Expect Less Output.app/Contents/Resources/mcp/elo-mcp.mjs`. Use whichever path Settings shows.

### Claude Code

1. In Settings, **Agents**, click **Copy** under "Claude Code".
2. Open Terminal and paste it. Before you press Return, replace `PASTE_YOUR_TOKEN_HERE` with your token.
3. Press Return. Check it with `claude mcp list`. It should show `expect-less-output`.
4. Start `claude` and ask: "List my Expect Less Output brands." Then: "Create a draft for Trash Panda from /Users/me/Movies/clip.mp4."

### Claude Desktop

1. In Settings, **Agents**, click **Copy** under "Claude Desktop".
2. Open the file `~/Library/Application Support/Claude/claude_desktop_config.json` (in Finder choose Go, Go to Folder, and paste the folder path). Open it with TextEdit.
3. If the file already has `"mcpServers": { ... }`, add the `"expect-less-output": { ... }` part inside it, separated by a comma. If not, paste the whole text. Be careful to keep the file valid JSON.
4. Replace `PASTE_YOUR_TOKEN_HERE` with your token (keep the quote marks).
5. Quit Claude Desktop completely (Command+Q) and open it again. The tools appear under the tools (plug) icon.

The token only lives in that config file or command. Anyone who can read it can use the API, but only on this Mac.

## 16. Text assist with a local AI (Phase 6)

Adds **Suggest titles**, **Suggest captions** and **Suggest hashtags** buttons to Schedule and the post editor. They stay hidden until you turn this on. Only the brand name, title and caption are sent, never your videos or keys, and only to a model on this Mac.

1. Install and start a local model server:
   - **Ollama:** install it from ollama.com, then in Terminal run `ollama pull llama3.1` (or any model), and keep Ollama running.
   - **LM Studio:** install it, download a model, and start its local server (Developer tab, Start Server).
2. In **Settings**, **Text assist (local AI)**, set **Provider** to **Local model**.
3. Click **Ollama** (address `http://localhost:11434/v1`) or **LM Studio** (`http://localhost:1234/v1`).
4. Type the **Model name** exactly as the server lists it, for example `llama3.1`.
5. Click **Test the model**. It says if the server answered.
6. If the model runs on another computer in your home (for example a Mac Studio), tick **My model runs on another computer on my network** and use its address. The app never allows an address on the internet.


## 17. Stats (Phase 7)

The app reads views, likes, comments and shares for videos it posted. It never reads other people's comments and has no inbox.

### Where to see them

- **Queue:** the Views, Likes, Comments and Shares columns show totals for each posted video. Hover a number to see it per platform.
- **Edit post:** open a posted video. The **Stats** section shows each platform with a line chart of views over time.
- **Analytics** (left menu, tab **Numbers**): pick a brand (or All brands) and **Last 7 days** or **Last 30 days**. You get totals per platform for videos published in that time.
- Click **Refresh stats** to read the numbers right now. Otherwise the app reads them by itself every 6 hours for the first 7 days of a video, then once a day until day 30, then stops.

### What each platform gives

- **YouTube:** views, likes, comments. YouTube does not share a share count, so it shows a dash.
- **Instagram:** views, likes, comments, shares.
- **Facebook Reels:** views, likes, comments. Shares are a rough number and show a ~ sign.
- **TikTok:** views, likes, comments, shares, but only for videos where the app knows the video id (see below).

A dash or "Not available" is not an error. The reason is written next to it.

### Steps you must do once

**Facebook and Instagram**

1. Open the Meta developer site and your app, then the use case you set up in SETUP_B step 3.
2. Add the permission `pages_manage_engagement` (it sits next to `read_insights`). Also make sure `instagram_manage_insights` is added.
3. In the app, go to **Connections** and click **Reconnect Meta**. Approve everything on the Meta page.

**TikTok**

1. Open the TikTok developer portal, your app, then **Scopes**. Add `video.list`. TikTok may ask you to explain why. Say it is used to show view counts to the account owner.
2. In the app, **Connections**, TikTok credentials, click **Replace**, tick **Also ask for video.list (stats)** and click Save (you do not have to retype the key, leave the key boxes empty).
3. Click **Reconnect TikTok** on each brand and approve.

### Videos you posted by hand (and TikTok Drafts)

TikTok does not tell the app the video id for a draft, and a manual post has no id either. When you click **Mark as posted**, paste the video link first (for example `https://www.tiktok.com/@name/video/123...` or a YouTube Shorts link). The app reads the id from the link, and stats start working. Without a link the stats say "Paste the video link when you mark the post as posted."

### Ask Claude

With MCP connected you can ask "How did last week's Trash Panda posts do?". The tools are `get_post_stats` and `get_brand_stats`, and the local API has `GET /v1/posts/{id}/stats` and `GET /v1/brands/{id}/stats?range=7d`.

### Videos that were on your channels before the app

1. Open **Analytics** and pick a brand (or All brands).
2. Click **Import existing videos**. The app lists the videos on each connected YouTube channel, Instagram account and Facebook Page, and reads their numbers. A big channel can take a minute.
3. They appear under **Existing videos** and count in the totals. Choose **All time** to include the oldest ones.
4. After that they are refreshed once a day for 90 days after they were published. Older ones keep the numbers from when you imported. Click **Import existing videos** again any time to pick up new uploads you made outside the app, and **Refresh stats** to re-read everything now.
5. TikTok is not included yet. It needs TikTok to approve `video.list` first.

Your logins stay as they are. YouTube already has the permission it needs, so you do not need to reconnect.

### Best times to post

1. Open **Analytics**. Under the totals is **Best times to post (Eastern time)**.
2. It shows your **Top hours**, a bar chart of typical views for each hour, and a day by hour grid where darker means more views. Hover a square for the numbers.
3. Pick a platform in the box on that card. With one brand and one platform it shows real views. With more it shows "times your typical video", so a big channel and a small one can be compared fairly.
4. Only videos at least 7 days old are used, so a new video does not look worse than it is. It needs at least 10 such videos, and an hour needs 2 videos to be ranked. Click **Import existing videos** first to give it more to work with.

### The posting schedule, per platform

Every channel has its own times for every platform. Setup Channels, pick a channel, **Posting schedule (Eastern time)**:

1. Pick **Shorts** or **Long form** at the top. Each has its own grid.
2. Each row is a platform (YouTube, Instagram, Facebook, TikTok, Bluesky). The left box ticks whether that kind posts there. The two columns are **Weekdays (Mon to Fri)** and **Weekends (Sat and Sun)**.
3. Click **+ time** in a cell to add a time. Pick the hour, minute and AM or PM. Click the **x** next to a time to remove it. A cell can have several times.
4. **copy to all** copies a platform's row to every other platform. **weekdays to weekends** copies its weekday times to the weekend column.
5. Tick the days the kind posts on (Mon to Sun) above the grid.
6. Click **Save schedule**. Nothing changes until you do.

How it is used:

- A new video takes the **next open time of every platform on its own**. A time that one platform already uses never blocks another platform, and one channel's times never block another channel (the old minimum gap setting is gone).
- This works the same for bot drops, **Manual Schedule**, **Bulk**, the Inbox and the Queue. In Manual Schedule and the Edit post window each platform has its own list of open slots, plus **Pick a different time...**, which lets you pick any date and time you like, on or off a slot.
- **Same time for all platforms** puts every platform of a post on one time. **Use each platform's next open slot** goes back to the default.
- In the Queue, one ticked post can be moved to a single time with the new-time box. That puts every platform on that time. Use **Edit post** to change one platform alone.
- A post's own time is its earliest platform time. The Queue shows each platform's time when they differ.
- The daily limit of a channel is counted for each platform.
- Channels from before this version got their old times copied to every platform, so nothing moved.

### Recommended slot times

1. Open **Setup Channels**, pick a channel, and look at **Posting schedule**.
2. At the bottom a **Recommended** box lists up to three times with how much better than typical they did.
3. Click **Add to every Shorts platform** (or Long form) to put a time on every ticked platform, change any platform's time if you like, then click **Save schedule**. Nothing changes until you do.

These are only patterns in your own results. A few videos can mislead, and the best hour can change as your audience grows.

## 18. Let agents help with the Studio (spend caps, skills, retries)

Claude (through MCP) and other bots can read your Studio spend and flagged tasks at any time. Changing things is **off** until you allow it.

### Turn it on

1. Open **Settings**, **Agent API**.
2. Tick **Agents may change Studio settings**.
3. Untick it again whenever you want agents to stop changing things. They can still read.

When it is off, any change an agent tries gets a clear `studio_locked` answer and nothing changes.

### What agents can do

| Tool | What it does |
| --- | --- |
| `get_studio_spend` | Month to date spend, every cap and what is left (always allowed) |
| `list_flagged_tasks` | Studio tasks that need a look, with the reason (always allowed) |
| `list_bible_skills` | The skill files in a brand's Bible, names and sizes (always allowed) |
| `set_studio_caps` | Change the monthly cap, the AI text cap, the per episode cap, or a brand's caps. 0 to 9999 dollars, or no cap |
| `add_bible_skill` | Import a skill file into a brand's Bible |
| `remove_bible_skill` | Remove a skill. Its full text is saved to a backup file first, in `removed-skills` inside your Studio library folder, so it can always be imported again |
| `retry_flagged_task` | Try a flagged task again (a writing task spends money again) |
| `rebuild_episode` | Write an episode again from the current Bible. An episode that already has a video is never rebuilt |
| `set_studio_brand_paused` | Pause or resume a brand's Studio work |

### Safety

- Agents cannot raise a cap above 9999 dollars, cannot approve a script that failed its checks, and cannot discard an episode.
- Every change is written to the **Activity Log** (for example "Agent API changed Studio spend caps").
- The same rules apply to the bots Muse and Grok, because they use the same local API and token.
- Example to ask Claude: "Set the Studio monthly cap to 400 dollars and the per episode cap to 40, then show me the caps."

## 19. Check on everything from your phone (Telegram)

If Telegram is set up (Settings, Alerts and backup), text your bot from anywhere. These answers come straight from the app's records, so the numbers are real.

| Send | You get |
| --- | --- |
| `/last` | The last post on each platform for every brand (Eastern time), and the next scheduled post |
| `/stats` or `/stats 30` | Views, likes and comments for videos published in the last 7 or 30 days, per brand and in total, plus the best video |
| `/today` | What is scheduled in the next 3 days, what failed in the last day, and what is flagged in the Studio |
| `/spend` | This month's spending and every cap with what is left |
| `/flags` | What is flagged in the Studio, with the reason |
| `/brands` | Every brand and whether it is paused |
| `/pause` or `/resume` | Pause or resume the whole studio |
| `/pause The Math of It` | Pause or resume one brand. Part of the name is enough, for example `/resume math` |

Pausing and resuming always asks first. Reply **YES** to go ahead. Anything else cancels.

You can also ask in plain words. "When was the last post?" and "show me the analytics" are answered from the records. Other questions go to your own text model, which only knows what the app tells it.

The phone dashboard, the iCloud report and the weekly summary are saved for when the new server is ready. See `docs/PHONE_DASHBOARD_PLAN.md`.

## 20. What changed in 0.10.0 (a quick tour)

- **One place to schedule.** **Schedule** has two tabs, One video and Many videos. On the **Calendar**, click a day or the **New post** button to start a post on that day. The **Queue** lists and moves what is scheduled, and the Studio and the Inbox folder schedule by themselves.
- **Time pickers.** Anywhere you set a time (posting slots, quiet hours, the Studio run time, a post's time, Bulk rows, Queue rescheduling) you pick the hour, minute and AM or PM from drop-downs and the date from a calendar pop-up.
- **Forms keep what you typed.** Channel setup (slots and defaults), Schedule and the Bible no longer snap back to the saved version while the app refreshes in the background.
- **One pause for a brand** (Channels, Channel setup) and one **Pause everything** (bottom of the left menu).
- **Analytics** has two tabs: **Numbers** (totals, best times, existing videos, Export CSV) and **What's working** (the old Studio Insights, now counting every video, not only Studio episodes).
- **Existing videos are listed automatically** for every connected account, soon after it connects and then once a day. The Home cards show the newest existing video when it is newer than your last post.
- **Get set up** checklist on Home for a new install (connect, posting times, existing videos, alerts, first post). **Hide** removes it.
- **Export CSV** on Analytics and the Queue saves a spreadsheet.
- **Reconnect works reliably.** Some networks hand out IPv6 addresses that never connect, which made Reconnect fail at random. The app now uses IPv4 first and asks again after a dropped connection, and an error now says the real reason, for example "timed out".
- The calendar's **+ more** pop-up is solid and readable.

## 21. The bot pipeline (0.11.0): Inbox, Upcoming and the new switches

In this setup the bots write and make every episode. ELO only takes finished videos, schedules them with the times you set, and posts them. **The schedule is only ever what you set in the app. A bot never picks or promises a time.**

### Turn off the writing (Settings, Pipeline)

1. Open **Settings**, then the **Pipeline** tab.
2. Untick **Allow ELO to use the Claude API**. ELO now makes no call to Anthropic at all. Models on your own computer (Ollama) still work. The key **Test** button says "Claude API is off".
3. Untick **Let ELO write and produce episodes itself**. The Director stops planning episodes. The writing and production buttons in the Studio are greyed out ("Writing comes from bots."). Library, Comments, Spend and the Director's Log keep working.

Both start switched **off** on a new install. On an install that was already in use they start **on**, so nothing changes until you untick them.

### Upcoming (menu: Plan, Upcoming)

A shared list of every episode in flight, from idea to dropped. The statuses are Idea, Scripted, Queued, Rendering, Needs review, **Muse passed** and Dropped. ELO sets Dropped by itself when the finished video arrives with the exact same episode id, whether the entry was at Needs review or Muse passed.

**Tracker** (the first tab) is the production tracker. For each channel it lists every planned episode with its air day, how far along it is (six steps from Idea to Dropped), and one box per platform. Before the drop the box says Not ready or Ready. After the drop it shows ELO's real state and time for that platform: Scheduled, Posting, Posted, Failed, or **Not dropped** when the drop has no entry for a platform the channel should have. The **Flags** box at the top lists what needs a look: a slot in the next 3 days with no finished episode planned for it, a Muse passed episode that is not dropped yet, an episode dropped for some platforms but not the others, a Muse passed episode with no post on or after its air date, and any episode still unfinished after its air date. Give each entry an **Air date** (in the edit window, or `air_date` from a bot) so the tracker knows what is late. The tracker only reports. It never changes a post, a slot or a time. Muse updates statuses with the steps in `docs/MUSE_UPCOMING_HOWTO.md`.

**Board** shows one column per status. **Table** has filters, grouping and sorting. Click **Add idea** to add your own. Click a card to edit it, move it forward or back (back needs a note), copy its episode id, or open its script. The badge on the menu counts entries in **Needs review**. **Move my Studio ideas into Upcoming** copies your old ideas bank over once.

Bots use the same list through the agent API with their own token. The rules are on the Bots card (Settings, Agent API): a bot edits only what it created, moves entries on its own channels forward, and never sets **Dropped**. ELO sets Dropped by itself when a video with the exact same episode id is accepted. If a bot edits the file directly in a way it should not, ELO flags it and **Restore previous** puts the file back. The file is `Shared/upcoming.json` in your Media Root.

### The Inbox (menu: Create and schedule, Inbox)

Bots drop a video and a small sidecar file in a channel's Inbox folder. ELO checks them (format, length, sound, checksum, approval, duplicates) and then either schedules the video at the channel's next open slot or lets it wait.

- **Waiting**: accepted, no slot yet (the channel is paused, has no connected account, or automatic scheduling is off). Buttons: **Schedule (next slot)**, **Pick slot**, **Hold**, **Reject**, **Open file**.
- **Held**: something did not match (for example the file name lacks the episode id, or the file changed after it was dropped). Nothing posts until you press **Release** or **Accept as it is**.
- **Rejected**: what was refused and why. The files are in the channel's `Inbox/Rejected` folder with `.error.txt` and `.reason.json`.
- **Log**: every drop ever received, with filters and **Export CSV**.
- **Issues**: things that do not add up (two posts in one slot, a post on a blackout day, a changed file, a drop waiting over 7 days). ELO checks at start, every hour, after changes, and when you press **Reconcile now**. It reports and never deletes.

A channel with no connected account (Backup Heroes, The Complaint Department for now) keeps its drops waiting. When you connect an account and untick **Pause this brand** on Channel setup, the waiting drops are scheduled in the order they arrived. If there is no connected account, the resume is refused with "Connect an account first".

### New rules on Channel setup (Pipeline rules)

- **Most posts a day**: starts at 1. With 1, only the first slot of each day is used, even if the channel has more times set.
- **Days this channel never posts**: blackout dates. There is also a list for every channel in Settings, Pipeline.
- **Low queue alert**: one alert when fewer than 3 days (changeable) of posts are scheduled ahead.
- **Slug**: the short name bots use for the channel.

### Other new switches (Settings, Pipeline)

Take drops on or off, strict checks, require the approval block, refuse duplicates, which bots may drop, the wait between retries (5, 15 and 60 minutes), a gap between any two posts, **Dry run everything**, and which events send you a message. Posted videos are deleted after 30 days (it was 60). The Queue has a **Swap times** button when you select two posts.

### Records, Audit log

Every setting change, schedule edit, rejection, post, file removal and Upcoming change is written to the **Audit log** (Records, Audit log tab) with who did it and what it was before. **Export CSV** saves it.

### Phone commands

`/queue` is the same as `/today`. If your text model is offline, Telegram says so and lists the commands that still work. Send `add idea for trash panda: a raccoon files taxes` to add an idea to Upcoming. On **Settings, AI models and Local AI**, **Use the local model for chat and the Director** sets both to the model on your own computer, and a light shows if it is online.

## 22. Short clips (0.11.2)

A show can post full episodes and short vertical clips on separate schedules.

1. Open **Channels**, then **Studio settings per channel**, and find the show.
2. In the **Short clips** box, tick the **Clip post days**, pick the **Clip time**, and tick which platforms clips go to (Instagram Reels, Facebook Reels, TikTok, YouTube Shorts). The episode days above are not touched.
3. Bots drop a clip with `"post_type": "clip"` in the sidecar. It must be tall (9:16) and 5 to 90 seconds. It gets the next clip slot. With no clip days ticked, it waits in the Inbox.
4. Clips show a **Clip** tag in the Inbox, the Queue and Upcoming. A clip that names its source episode gets "Full episode on YouTube" and the link in its description once that episode is live.

### Related video on a clip (0.11.3)

YouTube's Data API cannot set a Short's **Related video** (the tap-through link under the Short), so ELO cannot do it for you. A clip that names its source episode shows a yellow **Related video** note in the **Queue** with the episode link (or "not live yet" until the episode posts). The Activity Log also says so when the clip posts and when the episode goes live. To set it:
1. In YouTube Studio open the Short, then **Details**, then **Related video**, and pick the episode.
2. Back in ELO click **Done** on the note.

ELO also adds the show's YouTube channel link to the end of every clip description, after the "Full episode on YouTube" line, unless the sidecar says `"channel_link": false`.

## 23. The Calendar list (0.11.5)

The Calendar is one list, day by day. Posts show with the channel colour, the platforms and a status tag. A dashed circle is a slot from the channel settings with nothing in it, shown as "Teach Your Parents Tech has no videos scheduled" with an **Add a video** button. The slots come from each channel's own times and days (Channels, Channel setup), its blackout dates and its daily limit. Use **Open slots only** in the status drop-down to see only the gaps, and the arrows to change month.

## 24. Fill slots, gap warnings and beth (0.12.0)

- **Calendar:** an open slot with finished videos waiting has **Fill with a waiting video** (you pick which). **Fill all open slots** puts the oldest waiting video of each running channel into the next open slot of the month, one per slot. A bar then offers **Undo**. **Episodes only** and **Clips only** show the gaps of one kind.
- **Warnings:** Settings, Pipeline, **Empty slot warnings**. Once a day you get a message listing the empty slots until the end of tomorrow.
- **Inbox, Issues:** **Dismiss** hides one message and **Clear all** hides them all. They come back only if the problem goes away and returns. **Check again** runs the checks once more.
- **Beth:** Settings, Agent API, Bots, **Edit channels**. Beth works on all channels, including new ones. When beth removes, edits or fixes a post, you get a Telegram message. Nothing she does deletes a file. She can now create posts, change a post's time (or one platform's time), stop a post and replace its video. With no time she uses the first open slot of every platform, with a time she uses exactly that time. Your switch **Agents may create drafts only** still decides whether bots may schedule. Any bot can also put `scheduled_at` in a drop's sidecar to ask for an exact time.

## 25. Growth tools (0.13.0)

Everything is in Settings, **Growth**. Each tool has its own switch.

- **Staggered posting:** YouTube posts on the slot you set. Instagram, Facebook and TikTok follow a few minutes after each other (you choose the shortest and longest wait). The slot times do not change. It applies to posts made from now on.
- **Each platform gets its own words:** Facebook gets the description with no hashtags. Instagram gets one sentence per line and up to 10 hashtags. TikTok gets two short sentences and 5 hashtags. YouTube keeps the full description and gets search phrases added to its tags. In the post editor, **Reformat for each platform** does the same for any post that has not gone out. A bot's own version is never replaced.
- **Warnings:** Issues now warns when the same topic is scheduled back to back (bots send a `topic`). Every dropped video is measured for loudness, and the drop log says if it is quiet, loud or may clip. In the post editor, **Set sound to -14 LUFS** makes a corrected copy (the old file goes to Replaced). ELO cannot mix music under speech.
- **After a video is live:** at hours 1, 2 and 4 ELO checks the numbers and tells you about a slow start, or if YouTube shows the video as rejected or not public. After 48 hours it reads where viewers left and adds a lesson to **What viewers watched** (also saved as Shared/learnings.md for the writer bots). Real viewer questions in YouTube comments become idea cards in Upcoming.
- **Account numbers (Home and Analytics):** Home has a **Channel totals, all platforms** card, and Analytics has a **By channel and platform** tab. They show followers, views, likes, shares, watch hours, impressions and more for every platform ticked on the Upload-Post card, read about once an hour (or click **Read from Upload-Post now**). Some platforms report all time and others the last 28 or 30 days, so compare a platform with itself. The TikTok audience (countries, ages, when followers are online) is at the bottom of that tab.
- **Comments and Messages (Inbox):** open **Inbox**, then **Comments** or **Messages**. Comments come from every platform ticked for a channel on the Upload-Post card in AI Settings. Click **Reply** to type an answer, or **Suggest replies (local AI)** for three ideas from your own Ollama model (nothing leaves your network, and nothing is sent until you click Send). **Mark done** takes a comment off the waiting list. Messages are Instagram only, and Instagram only allows a reply within 24 hours of their last message. Comments are checked about every 15 minutes for new videos and less often for older ones. Click **Check for new comments** to look now.
- **First comment:** a post can have a first comment (a question or call to action). Bots send it as `first_comment` in the drop file. You can type one in New Post and in the post editor. About a minute after the video is live, ELO posts it through Upload-Post on every platform you ticked for that channel on the Upload-Post card in AI Settings. Instagram cannot take one, so add it by hand. The post editor shows each platform's comment, whether it went out, and a Try again button. TikTok only allows comments from Upload-Post if TikTok was connected there after comments were switched on. If it says to reconnect, disconnect and connect TikTok again on the Upload-Post site.
- **Pinned comment and poll:** if a drop has a `pinned_comment`, ELO posts it on YouTube when the video goes live and sends you a message to tap Pin (apps cannot pin). A `community_poll` reaches you 30 minutes after, to post in the YouTube Community tab (apps cannot post there).
- **Thumbnail rescue:** off by default. When on, a video that came with spare thumbnails and has a click rate under your line after 24 hours gets the second one. ELO tells you the new rate a day later.
- **Monday brief:** every Monday at the time you choose, one message and a file in Shared/Briefs: views on last week's posts, the top video, how many episodes are at each step, empty slots, and posting times that look better than yours. Use **Preview it** or **Send it now** to see it.
- **Emergency take down:** type an episode id. YouTube goes private. Facebook, Instagram and TikTok cannot be hidden by apps, so ELO lists them with links to remove by hand. Anything not posted yet is stopped. Nothing is deleted. B.E.T.H. can do the same with her token.
- **Disk space:** shows where the space goes. **Shrink old videos** makes a smaller H.265 copy of posted videos older than the days you pick (10 at a time) and checks its length. The big original is deleted only if you tick the box.

What ELO cannot do, because the apps do not allow it: pin comments, set YouTube end screens, post to the YouTube Community tab, hide a video on Facebook, Instagram or TikTok, and detect muted audio on Instagram. Google Drive backup is not built in.

## 26. More platforms (0.14.0)

Bluesky, X, LinkedIn and Pinterest now work like Facebook and the others: they show as a small tag (BS, X, LI, PI) on posts in the Calendar, Queue and editor, and you can tick them in the platform list.

- **A login decides.** A channel only uses one of these when it has a login for it (Connections, More platforms). With no login, the platform is not part of the channel and is not even listed.
- **Bots do not choose them.** Every bot video on a channel that has a login goes to that platform too, after the original four and a few minutes apart (see staggered posting).
- **Setup steps** for the keys and logins are in `docs/SETUP_MORE_PLATFORMS.md`.
- **Stats** for these platforms are not collected yet, so Stats shows them as "not read yet".
- **Length limits:** Bluesky 3 minutes, X 20 minutes, LinkedIn 30 minutes, Pinterest 15 minutes. A video that is too long skips that platform and the drop log says so.

## 27. The website (0.15.0)

Each channel has a **Website** card (Channels, Channel setup, pick the channel, scroll below Pipeline rules). Fill it in once and ELO keeps expectlessmedia.com in step with it.

- **Add to website?** Tick it to show the channel on the site. Archiving the channel, or unticking it, takes it off the site.
- **What the card holds:** title on the site, host names, tagline, description, YouTube channel id and handle, links (YouTube, TikTok, Instagram, Facebook, Bluesky), accent color, web address name, and the hero image (**Pick picture**).
- **A card only goes up when it is complete.** The card says what is still missing. A channel that is not complete is left alone.
- **How it reaches the site.** ELO keeps its own copy of the website project (it does not use the folder on your Desktop, so you can move or delete that). About a minute after you save a change, ELO downloads the latest site, changes only `src/data/channels.json` (and adds the hero picture), and sends it to GitHub. Cloudflare then publishes the site. Other site files are never touched.
- **First time:** press **Fill ELO from the website**. ELO reads the five channels already on the site and fills their cards, so nothing is retyped. Then add the two new channels by hand and tick **Add to website?**.
- **If you edit the site by hand** (or on GitHub), ELO picks the change up when it reads the site (every few hours, or press **Fill ELO from the website**), unless you have a newer change in ELO that has not gone up yet. ELO's change wins until it is sent.
- **Safety:** ELO refuses to take more than 2 channels off the site in one go. If GitHub does not accept this Mac, ELO tells you in plain words. Turn off **Send changes to the website automatically** to send changes yourself with the button.
- **Needs:** this Mac must be signed in to GitHub with SSH the way Terminal is (`ssh -T git@github.com` should say Hi).

## 28. TikTok message and no Snapchat (0.16.0)

- **TikTok message.** When a channel sends a video to TikTok, ELO sends you a message with the channel, the title and the description. Drafts mode: open TikTok, look in your inbox, find the video and post it. Turn alerts on under Settings, Alerts (iMessage number). Quiet hours do not hold this message.
- **Why the description is not in the draft.** TikTok does not let apps fill in text on a draft. Paste it from the message, or from your clipboard (ELO copies it too).
- **Snapchat** was removed. It never let apps post.

## 29. ELS Ventures and Etsy (0.21.0)

ELS Ventures is a new menu item, under Financial. It holds your storefronts. Etsy is the first one. Later ones (Amazon KDP, Gumroad) will show up in the same place with the same pages.

### What you see right now (sample data)

Etsy has not approved the ELO app yet, so the pages show made up sample data. A box at the top says so. Nothing there is real.

1. Click **ELS Ventures** in the left menu.
2. Click **Etsy**. If there is more than one storefront, they are buttons at the top.
3. Use the buttons under the title: **Sales**, **Listings**, **Items sold**, **Reviews**, **Notifications**.
   - **Sales** shows revenue, fees, net (what you keep), orders, units and average order. Pick Today, 7 days, 30 days, Year to date or Custom. Below are a chart and your top products.
   - **Listings** shows every listing. Type in the search box. Click a column name to sort. Click a title to see its pictures, tags, price history, views, favorites and sales. **Open on Etsy** opens the real listing.
   - **Items sold** shows each order and what was in it. Buyers show only as a username. ELO never keeps or shows emails or addresses.
   - **Reviews** shows the latest reviews. Anything with 1 to 3 stars has an orange **Low rating** tag.
   - **Notifications** shows new orders, new reviews, low reviews and new buyer messages. A red number on the menu item and on the Etsy button counts the ones you have not read. **Mark all read** clears it.

### Small windows

If the ELO window is narrower than about 900 pixels, the left menu hides. Click **Menu** at the top left to open it. Every screen is still there.

### See it on your phone

1. Open ELS Ventures. The card **See this on your phone** shows a link.
2. Send that link to your phone and open it while the phone is on Tailscale.
3. If the card says to turn on the phone link, go to Settings, Agent API, and switch on the Tailscale option.

The phone page only shows numbers. It cannot change anything, connect Etsy or post anything. Do not share the link: anyone with it can see your sales. Make a new one in Settings, Agent API if it ever leaks.

### Connecting the real shop (after Etsy approves the app)

1. In your Etsy developer app, add this exact redirect address: `http://127.0.0.1:38487/callback`
2. Open ELS Ventures, then Etsy. In the **Etsy connection** box, paste the **Keystring** and the **Shared secret**, then click **Save keys**. They are saved encrypted. ELO never shows them again.
3. Click **Connect Etsy**. Your browser opens Etsy. Click **Allow access**. Come back to ELO.
4. The sample data disappears and ELO starts reading your real shop. It checks again about every 20 minutes.
5. **Sync now** checks right away. **Disconnect Etsy** forgets the login.

If Etsy ever stops accepting the login, the page says **Etsy needs you to sign in again**. Click Connect Etsy again.

### Buyer messages

Etsy does not let apps read messages. ELO reads Etsy's "new message" emails instead.

1. In your email, forward or label Etsy's new message emails so they land in one folder or label.
2. In ELS Ventures, Etsy, fill in the **Buyer messages from email** box: the mail host (for Gmail, `imap.gmail.com`), your email address as the user, the folder or label name, and an app password.
3. Click **Save mailbox**, then **Test mailbox**. It should say it works.
4. New messages show in Notifications with the sender, subject, a short snippet and a link that opens the conversation on Etsy. Reply on Etsy.

ELO only reads the mailbox. It never moves, marks or deletes an email.

### Telegram

New orders, new reviews, low reviews and new messages are also sent to your Telegram, the same chat ELO already uses. The text of a review or message is never sent there, only that it arrived.

### Draft listings from beth

beth can create and change draft listings on Etsy. They are always drafts. Nothing goes live until you click Activate on Etsy yourself. Every change beth makes is written in the audit log with who, what and when. Until the shop is connected, her drafts wait inside ELO (they show on the Listings page with an id that starts with `pending-`) and are sent to Etsy after you connect. The bot steps are in `docs/ELS_VENTURES.md`.
