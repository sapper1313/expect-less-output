# Your tasks for round two

Everything I could build and test myself is done. This is the short list of things only you can do. Each one is small. Do them in this order. You do not need to come back to this file for anything else.

## 1. Check the three prices (2 minutes)

1. Open the app, then Settings, then the tab **AI models and Local AI**.
2. Scroll to **Models and prices**.
3. Open Anthropic's price page in your browser and compare.
4. Fix any number that is different. The boxes save when you click away.

What to know: Sonnet at $3 in and $15 out per million was already your setting. The Haiku numbers ($1 and $5) and the Opus numbers ($5 and $25) are my best guesses. I could not confirm them for the 5.5 models, so they may be wrong. The spend caps use these numbers, so fix them first.

## 2. Pick cheaper models for the simple jobs (3 minutes, saves money)

1. Same screen, top of the page, in **Agents and their models**.
2. Change these to **Claude Haiku 5.5**: Script QC, Math Checker, Thumbnail, Publisher, Comments, Producer.
3. Leave **Show Writer** and **Hollow Safety Checker** on Sonnet.
4. After a day, look at the Flagged tab. If Script QC starts failing scripts for silly reasons, put it back on Sonnet.

## 3. Give the app a text model on your Ollama computer (5 minutes)

The app can only list models that already exist on that computer.

1. On the Ollama computer, open a terminal and run this one command. It downloads a free 8 billion size model:

```bash
ollama pull llama3.1:8b
```

2. Back in the app, go to Settings, **AI models and Local AI**, find the card **Text assist (local AI)**.
3. Press **Pick a model for me**, then **Test the model**. You should see "The model answered".
4. Now the Suggest buttons next to titles and captions use your own computer, for free.
5. Optional: in **Agents and their models**, set **Assistant** (the Telegram helper) and **Comments** to the same local model so they cost nothing.

If the Ollama computer was off when the app started, step 3 is how you fix it.

## 4. Set up Telegram so you can ask questions from your phone (5 minutes)

1. In Telegram, search for **@BotFather** and open it.
2. Send `/newbot`. Give it a name, then a username that ends in `bot`.
3. BotFather sends a long token. Copy it.
4. In the app go to Settings, **Alerts and backup**, find **Chat with the studio from your phone (Telegram)**.
5. Paste the token and press **Save**, then tick **Turn on the phone chat**, then press **Test the bot**.
6. Press **Show pairing code**. A 6 digit number appears.
7. In Telegram, open your new bot, press Start, and send it that number. It says "Paired".
8. Try: "how is the last post doing?" or send `/status`, `/latest`, `/spend`, `/flags`.

Safety: only the phone you paired can talk to it. It can pause or resume the studio only after you reply YES. It cannot change keys or caps. The app has to be running on your Mac for it to answer.

## 5. Press Retry all on the Flagged tab (1 minute)

Studio, then **Flagged**, then **Retry all**. The earlier failures were caused by bugs that are fixed now. The cards now say which channel and why.

## 6. Only if one of these messages shows up

| You see | Do this |
| --- | --- |
| "YouTube Analytics refused the request" when loading watch time | Channels, Connections, reconnect YouTube once so it can read analytics |
| A permission error when you press Edit live on a Facebook video | Channels, Connections, reconnect Meta once |
| "Connect YouTube for this channel first" in Research | Connect that channel's YouTube under Channels, Connections. The search suggestions in Title Lab work without it |
| "Ollama does not have the model" | Do step 3 again and press Refresh list |

## 7. Ten minute test drive

Try each of these once so you know it works for you:

1. Open **Home**. Scroll down. Click a channel's connection dot.
2. Press Command K and type "spend caps". Press Enter.
3. Open **Calendar** and click any item. It should open large.
4. Studio, **Bible**. Pick a different channel. The text should change. Type something and wait 10 seconds. It should stay.
5. Studio, Overview, **Talk to the Director**. Type "what is flagged?".
6. Studio, **Research**. Type a topic in Title Lab and press Find titles.
7. Studio, **Library**, open an episode. Look for the cost line, the video player, and the chapters and captions card.
8. Click anywhere on text in the app and copy it with Command C.

## What is not in this round

- **Link tracking** for merch and posts: you said later.
- **Approval flow** for helpers: you said skip.
- **Revenue tracking:** you said skip for now.
- **Merch and print on demand:** saved in `docs/FUTURE_IDEAS.md`. Nothing is built.

## Things to know, in plain words

- Chapters and captions are timed from the script, not from the finished video. Check the chapters against the real video before you trust them. If a video has an intro, the times will be off. That is why "Add chapters automatically" is off by default.
- Watch time, retention, live edits, competitor lists, trends and caption upload were built to the documented Google and Meta shapes and tested with fake servers. They have not touched your real channels yet. The first real use is your test.
- Cut shorts are always drafts. Nothing posts by itself.
- Re-posting skips YouTube by default.
- Calls that the AI cuts off are now counted in your spend, so the total may look a little higher than before. It is more accurate.
- The first Wonder Hollow retry costs about 50 cents per attempt. The writer now asks for shorter fields so it should finish in one try.
