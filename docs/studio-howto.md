# Autonomous Studio: how to use it (plain steps)

The Studio is the new **Studio** item in the left menu of Expect Less Output. A Director runs each brand on its schedule. Writers write the episodes, checkers check them, a Producer makes the video through the Grok API (shorts), a Thumbnail agent makes covers, and a Publisher schedules everywhere. You only step in when something is flagged.

Everything starts **paused and in mock mode**. Mock mode makes placeholder videos and canned text, makes no network calls and spends nothing. A video made in mock mode is never published to a real platform, even if an account is connected.

## 1. First look (no keys needed)

1. Open the app, click **Studio**, then **Settings**.
2. Leave **Mock mode** ticked. Press **Cheap test**. It says "Made a 3.0 second clip (mock, nothing was spent)."
3. Go back to **Overview** and press **Resume everything**. The Director asks the Writers for scripts, the Producer makes mock videos, and mock posts appear in the Calendar and Queue as dry runs.
4. Press **Dry run day** any time to see, hour by hour, what the Director would do. It changes nothing.

## 2. Paste your keys (Studio, Settings, Keys and connections)

| What | Where it comes from |
| --- | --- |
| Grok / xAI API key | console.x.ai, API keys |
| Anthropic API key | console.anthropic.com, API keys |
| Cloudflare R2 (2 keys) | Needed only for custom Instagram cover pictures, see `docs/SETUP_E_CLOUDFLARE_R2_IF_NEEDED.md`. Then fill in the public host card. |

For each one: paste, press **Save**, then **Test connection**. The key is kept in the macOS Keychain and is never shown again. Testing in mock mode makes no network call, so turn mock mode off to test for real.

## 2b. Bluesky: one account per brand

Open **Channels**, then the **Studio settings per channel** tab, and scroll down to **Bluesky accounts (one per brand)**. It has a row for every brand. Type that brand's handle and an **app password** (Bluesky, Settings, Privacy and security, App passwords), press **Save**, then **Test connection**. Never your real password.

## 3. Set your limits before you turn mock mode off

Studio, Settings, **Spend caps**: a global monthly cap, a cap per brand, a cap per episode, and a separate cap for AI text. Each takes 0 to 9999, or tick **No spend cap**. Caps are hard stops: a step that would cross one does not run, and you get one alert. You also get alerts at 50, 80 and 100 percent. The **Spend** tab shows month to date, the last 50 paid calls, and Export CSV.

Estimate before you go live: each brand shows about what one episode costs (first pass and worst case). Changing "Every N days" shows the monthly cost now and after the change before you save.

## 4. Brands: cadence, platforms, flags (Settings, Brands)

- **Every N days** (shorts) or a **Weekly schedule** (Wonder Hollow Workshop: post Tuesday and Friday, produce on Sunday and Monday for Tuesday, Wednesday and Thursday for Friday).
- Changing N applies from the next due date. Dates already planned never move.
- **Production run time** (default 9:00 AM Eastern): work starts after this time.
- **Script runway days** (default 7): the Director keeps that many days of approved scripts ready, without bothering you.
- Platform ticks. Bluesky is off until you tick it. Wonder Hollow Workshop is YouTube only.
- **AI disclosure** (on) and **Made for kids** (on for Wonder Hollow only).
- Model per format: shorts use **Lite**, long videos use **1.5**. One box is always ticked.
- Resolution: 480p for shorts, 720p for long. 1080p costs much more.

## 5. Series bibles and skills (Studio, Bible)

Pick a brand. Edit the premise, voice, characters, hooks, do and don't lists, banned phrases and length targets. **Import skills** reads Markdown or text files (or a whole folder) and stores them under the brand. The Writer receives the full bible and every skill on every call. **Export Markdown** copies it all out. The ideas bank is a list of topics the Writer uses and refills when low. Holidays and fun days (seeded 18 months ahead) are shown to the Writers 21 days ahead.


**Character reference images.** In the Bible, under each character, click **Add images** and pick the pictures (every angle). Save the bible first if the character is new. Give each picture a short label such as "front" or "side". When a character changes, click **Retire** on the old pictures instead of deleting them: they stay here and are not sent. **Use again** switches one back on. The Producer sends up to 14 pictures with every clip, taking turns between characters. Each picture adds a small cost per clip, so keep only the ones that matter. Renaming a character keeps its pictures. Removing a character stops its pictures being used. Pictures added under Studio Settings still work and count as brand wide.

## 6. Wonder Hollow: how Grok Bot takes over

1. The Writer produces a complete package that passes the Math Checker (counted objects checked by running code) and the Safety Checker. It then shows as **Ready for production** in the **Library**, and as a plain `.json` in `~/ELO/Library/hollow/ready/`. The Calendar shows the production window.
2. In the Library, open the episode to read it. **Copy scene prompt** and **Copy all prompts** are there. You can also tell Grok Bot: it reads `GET /v1/episodes?status=Ready for production` through the local API (see `docs/AI_BOT_PROMPT.md`).
3. Grok Bot makes the clips on your Grok subscription, binds them, and sends the finished video back: put a JSON file with `{"episode_id": "...", "video_url": "https://..."}` in the Wonder Hollow Workshop **Inbox** folder (or a video plus the same JSON). Nothing else changes about the Inbox.
4. The app checks the video (plays, 16:9, right length, sound), then writes the YouTube text, makes the thumbnail (1280 by 720, under 2 MB), applies made for kids and the AI label, and schedules the next Tuesday or Friday. A bad video marks the episode **Flagged** with the reason.

To let ELO make Hollow videos itself through the API instead, tick **Make this brand's video through the API** on the brand. It is off by default.

## 7. Where flagged things appear

**Studio, Flagged** lists anything stopped: a script that could not pass its checks, a clip that failed quality checks after its retries, a cap stop. For a clip you can **Approve as is**, **Edit prompt and retry**, **Regenerate clip** or **Discard**. You also get one iMessage per flagged item. Risky comments are on **Studio, Comments**.

## 8. Local AI on the other computer

Studio, **Local AI**: type the Ollama address of the Dell, press **Test**, press **Download recommended models**, then **Run self test**. The screen has the exact steps for the Dell (Windows and Linux) and a Copy button. Never forward that port from the router. If the Dell is off, checks fall back (ffmpeg and Whisper only, or Claude vision if you tick it). Moving to a bigger machine later is changing the address and picking larger models.

## 9. Bluesky, thumbnails

- Bluesky is sent from the Studio, at the same time as the other platforms, retried after 2, 10 and 30 minutes, then you get the usual alert. They show on **Studio, Publishing**.
- YouTube Shorts cannot take a custom thumbnail through the API, so the winning thumbnail is shown for the first quarter second of the video instead. Long videos get a custom thumbnail and an A/B swap test (after about 48 hours the second best is tried, the click rate is compared, the winner stays). The test needs YouTube Analytics permission: reconnect YouTube once on Connections.
- The thumbnail guidelines are in Settings, with history and a Revert button. They refresh from the platforms' help pages once a month.

## 10. Daily life

- **Morning digest**: one iMessage at 7:30 AM Eastern (time editable).
- **Retention**: after 60 days (editable) the Archivist deletes the video and full size thumbnail of posted items at 3 AM. Packages, small previews and stats are kept forever. **Dry run purge** shows what would go.
- **Backups**: every night after 2 AM to `~/ELO/Backups`, last 14 kept. The database part never contains a key.
- **Pause everything** (bottom of the left menu) stops all new work. Each brand has its own pause, and every agent can be switched off on the Bible tab.

## 11. The watchdog (alerts you if the app stops)

Studio, Settings, **Watchdog** shows two Terminal commands. Paste the install command once. It adds a small launchd job that checks every 5 minutes that the Director is still checking in. If it has not for 30 minutes during run hours, you get an iMessage even if the app is closed. The other command removes it. The app also tells you if the Mac slept through a production time.

## 12. Turning mock mode off

1. Keys saved and tested, caps set, brands set, Local AI test passed.
2. Settings, untick **Mock mode**. Press **Cheap test** once to see a real clip and its real cost.
3. Resume everything if it is paused.
4. To go back to testing, tick Mock mode again. Posts made in mock mode stay dry runs.

## 13. If something looks wrong

Studio, **Director's Log** shows every agent action with filters. **Activity Log** (the existing screen) still shows posting and alerts. Nothing is ever paid for twice after a quit or a crash: every paid request is written to the ledger the moment it is made.

## 14. What is new in round two

- **Home** shows everything at a glance. Click any tile or card to jump there. Red numbers in the left menu mean something needs a look.
- **Search everything:** press Command K and type. It finds episodes, posts, ideas, comments, the bible, log lines and pages of the app, such as "spend caps".
- **Channels** is where you set up a channel, connect its logins and set how often the studio writes for it.
- **Settings** has tabs. Keys, spend caps and production are under Studio. Models, prices and Local AI are under AI models and Local AI.
- **Models and prices:** pick a cheaper model for simple agents. Fix a price if Anthropic changes it. A model that starts with ollama runs on your own machine and is free.
- **Talk to the Director:** on the Studio Overview. Say "I updated the bible for Trash Panda, make the changes" and press the button it suggests. Nothing runs until you press a button.
- **Calendar:** click anything to see it large. For a posted YouTube or Facebook video, press Edit live to change the title or text on the platform. Instagram, TikTok and Bluesky do not allow edits after posting.
- **Library episode:** watch the video, see what it cost, make chapters and captions, and cut shorts. Shorts are always drafts.
- **Research tab:** find titles and tags for a topic, watch competitor channels, see what is trending, and turn it into ideas.
- **Insights:** the re-post queue lists your best older videos. YouTube is off by default because the same video twice can look like spam.
- **Telegram:** set it up under Settings, Alerts and backup. Then ask "how is the last post doing?" from your phone.

