# Grok Bot: how to hand a finished Wonder Hollow video to ELO by link

Give this whole file to Grok Bot. It covers only the last step: sending a finished video back. For how to read the episodes and make the video, see `docs/GROKBOT_GUIDE.md`.

## The idea in one minute

You do not copy the video file anywhere. You upload the finished video to a place that gives a direct link, then drop one small JSON file in the Wonder Hollow Workshop Inbox folder. ELO sees the file, downloads the video from your link, checks it, writes the YouTube text, makes the thumbnail, and schedules it.

The JSON file is required. It is the only way ELO knows which episode the video belongs to.

## Step 1: make a good link

The link must be:

- **Direct.** Opening it must start downloading the video itself. A page that shows a video player, a "preview" page, or a "click to download" page does not work. For Google Drive, Dropbox and similar sites, use the real download link, not the share link.
- **Public to anyone who has it.** ELO does not log in, accept cookies or click anything. A link that asks for a password or a sign in fails.
- **http or https.**
- **A real MP4 or MOV file.** ELO opens the first bytes of the download to check. A web page, a zip file or a WebM file is rejected.
- **Under 2 GB.**
- **Fast enough.** The whole download must finish in 10 minutes.
- **Alive for at least 15 minutes after you drop the file.** A link that expires in a few minutes is risky. A signed link that lasts an hour is fine.
- **Sent with the full file size.** If the server cuts the download short, ELO notices and rejects it.

Links that carry a secret token are fine. ELO writes only the site name in its logs, never the full link.

## Step 2: write the JSON file

Save a file with this content. Use the real episode id from ELO (it looks like `wonder-hollow-workshop-2026-0003`):

```json
{
  "episode_id": "wonder-hollow-workshop-2026-0003",
  "video_url": "https://example.com/the-video.mp4"
}
```

Rules for the file:

1. The name ends in `.json`. A good name is the episode id, for example `wonder-hollow-workshop-2026-0003.json`.
2. Use exactly those two fields. Anything else you add (a title, a caption, a time) is ignored. Do not send a `scheduled_at`: a time in the past makes the file get rejected, and ELO picks the next Tuesday or Friday itself.
3. The `episode_id` must exist in ELO. Check it with `GET /v1/episodes/{id}` first.
4. Do **not** also put a video file with the same name in the Inbox. If a video file with the same name is already there, ELO uses that file and ignores the link.

## Step 3: put it in the Inbox

Save the JSON file in the Wonder Hollow Workshop Inbox folder:

```
<ELO Media Root>/Wonder Hollow Workshop/Inbox
```

The usual place is `~/Movies/Expect Less Output/Wonder Hollow Workshop/Inbox`. If the owner moved the Media Root, ask them for the path. In ELO, **Brands** must also have **Watch this brand's Inbox folder** ticked for Wonder Hollow Workshop. If nothing happens after a minute, ask the owner to check that box.

Write the file in one go. If you can, write it to a temporary name first and rename it to `.json` when it is complete. ELO waits until the file stops changing for about 5 seconds, so a normal save is also safe.

Do not rename, move or delete anything else in the Inbox. ELO moves its own files.

## Step 4: check that it worked

1. Within about a minute, a video named after your JSON file (for example `wonder-hollow-workshop-2026-0003.mp4`) appears in the Inbox while ELO downloads it. Big files take longer.
2. Read the episode again with `GET /v1/episodes/{id}`. The status moves `Video received`, then `Checking video`, then `Scheduled`.
3. When it says `Scheduled`, you are done. Do not send it again.

## When something goes wrong

ELO moves the JSON file (and the video, if one arrived) to the `Rejected` folder inside the Inbox and writes a plain `.error.txt` next to it. The episode becomes `Flagged` when the problem is with the video itself.

| Message | What it means | What to do |
| --- | --- | --- |
| video_url is not a valid web address | The link is broken or has a typo | Fix the link |
| video_url must be an http or https address | Wrong kind of link | Use https |
| The server answered 403 or 404 | The link needs a login, or it expired or never existed | Make a public direct link |
| The download stopped early | The server cut the file short | Upload again and use a stable host |
| The download came back empty | The link gave no file | Check the link in a private browser window |
| The download is not an MP4 or MOV video | It was a web page, a zip, or another format | Export an MP4 or MOV, use the direct link |
| The file is bigger than 2 GB | Too large | Export at a lower bit rate |
| Could not download the video | Network trouble or more than 10 minutes | Try again |
| No episode exists in the Library | Wrong `episode_id` | Check the id with `GET /v1/episodes` |

After a rejection, fix the problem and drop a new JSON file with the same `episode_id`. Do not hand the same episode in twice once it has been scheduled.

If the video downloads but fails ELO's own check (not 16:9, no sound, far too short, a long black or frozen stretch), the episode shows `Flagged` with the reason. Make the video again and send a new link.

## The video itself

- 16:9, MP4 or MOV, with sound all the way through.
- About 3 minutes. A video that runs a little longer is fine.
- The goodbye song ends on the Hollow logo, with no credits.
- Counted objects are on screen with the exact quantity, counted aloud in order.

## Checklist

1. Make the video, upload it, and test the link in a private browser window. It must start downloading right away.
2. Write the JSON with `episode_id` and `video_url`.
3. Save it in the Wonder Hollow Workshop Inbox.
4. Watch the episode go to `Scheduled`.
5. If it lands in `Rejected`, read the `.error.txt`, fix the problem, and drop a new JSON.
6. Never use em dashes in anything you write. Never share the owner's API token anywhere except the request header.
