# Expect Less Output: User Guide

This guide is for you, the owner. Every step is meant to be followed exactly, one at a time.

Phase note: YouTube (Phase 2), Facebook Pages and Instagram (Phase 3) are real now. TikTok (Phase 4) is real now too. A dry run waits a few seconds and says it worked, and never contacts the platform. Their real connections come in later phases.

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

1. Click **New Post**. Pick a short vertical video and the brand. Keep only **TikTok** ticked.
2. Under **TikTok** you will see "Post to TikTok as" and the account name. In Drafts mode TikTok asks for privacy and settings later, in its own app.
3. Under **When**, choose **Pick a different time...** and set it 5 minutes from now.
4. Click **Fine.**
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
   - **4 Review and send:** click **Fine.** and show the message.
4. Stop recording (the stop button in the menu bar). Upload that file when you submit the app for review (SETUP_C step 9) or the audit (step 10).

### Switch to Direct post after TikTok approves the audit

Only do this after TikTok has approved the Direct Post audit.

1. On **Connections**, in the **TikTok credentials** box click **Replace**, tick **Also ask for video.publish**, and click **Save**.
2. On each brand's card, click **Reconnect** and approve the new permission.
3. Change **Mode** to **Direct post**. The app asks "Has TikTok approved your Direct Post audit?" Click **Yes, it is approved**.
4. From now on, **New Post** shows the full TikTok screen. You must choose each time:
   - **Who can view this video.** Nothing is pre-selected. The choices come from TikTok for that account.
   - **Comment, Duet, Stitch.** All start unticked. Some may be greyed out because they are off in the TikTok app.
   - **Disclose commercial content** (off by default). Branded content cannot be private.
   - The consent line (Music Usage Confirmation, and the Branded Content Policy when branded content is on).
5. **Fine.** stays grey until all of it is valid. Bulk Upload has one TikTok box that applies to every row.
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

> Could not post. Probably for the best. Instagram, Trash Panda, "Fridge Math", Tue Jun 2, 5:00 PM ET. Reason: token expired. Open Expect Less Output to retry.

Open the app, find the post (Calendar or Queue) and click **Retry**.

## 12. Everyday extras (Phase 5)

- **Keyboard shortcuts:** Command+N new post, Shift+Command+N bulk upload, Command+1 calendar, Command+2 queue.
- **Duplicate a post** (to post it again): open the post and click **Duplicate**. You get a new draft with its own copy of the video.
- **Search the Queue:** type in the search box at the top of the Queue. It looks at the title, caption and file name.
- **See what each platform will get:** open a post. The box "What each platform will get" shows the final text, with the template and hashtags already applied.
- **Pause one brand:** open **Brands**, pick the brand, tick **Pause this brand**. Its posts wait. Untick it to resume. A post less than your grace time late (Settings) goes out; older ones are held as missed and you are alerted. **Pause the scheduler** in the menu bar pauses everything.
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
- They can never: connect or disconnect an account, read or change a password, key or token, delete a file or a post, or change your settings. There is simply no way to ask for those.
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
- You review the drafts in the **Queue** and schedule them yourself with **Fine.**

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

What happens next:

- The video and the sidecar are **moved** into the brand's Queue folder. Nothing is deleted.
- A file that cannot be accepted (a broken sidecar, a request to schedule while drafts-only is on, a wrong brand) is moved to `Inbox/Rejected` with a `.error.txt` that says why, and you get one alert. Nothing is quietly changed.
- The app waits until a file stops growing, so a big video that is still copying is safe.

## 15. Connect Claude with MCP (Phase 6)

MCP lets Claude use the app directly. The nine tools are `list_brands`, `get_next_open_slots`, `create_post`, `list_posts`, `get_post`, `update_post`, `cancel_post`, `retry_post` and `get_health`. They follow the same drafts-only rule.

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

Adds **Suggest titles**, **Suggest captions** and **Suggest hashtags** buttons to New Post and the post editor. They stay hidden until you turn this on. Only the brand name, title and caption are sent, never your videos or keys, and only to a model on this Mac.

1. Install and start a local model server:
   - **Ollama:** install it from ollama.com, then in Terminal run `ollama pull llama3.1` (or any model), and keep Ollama running.
   - **LM Studio:** install it, download a model, and start its local server (Developer tab, Start Server).
2. In **Settings**, **Text assist (local AI)**, set **Provider** to **Local model**.
3. Click **Ollama** (address `http://localhost:11434/v1`) or **LM Studio** (`http://localhost:1234/v1`).
4. Type the **Model name** exactly as the server lists it, for example `llama3.1`.
5. Click **Test the model**. It says if the server answered.
6. If the model runs on another computer in your home (for example a Mac Studio), tick **My model runs on another computer on my network** and use its address. The app never allows an address on the internet.
