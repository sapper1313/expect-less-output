# Amazon product lists

A video can carry 0 to 5 Amazon picks. ELO builds the links, makes a list page on expectlessmedia.com, and adds two lines to the description and the first comment. Nobody types a link.

## What the desk sends

In the drop sidecar (and in the agent API when a post is created) add:

```json
"products": [
  { "asin": "B0XXXXXXXX", "name": "Short display name", "note": "One plain sentence on why it is in this video." }
]
```

- `asin`: 10 letters and numbers. `name`: up to 70 characters, written by the desk. `note`: up to 240 characters. Max 5. The same ASIN twice is shown once.
- No prices, no Amazon images, no ratings. Text cards only.
- No `list_url` field. ELO makes it: `https://expectlessmedia.com/lists/<episode_id>/`.

## What ELO does

1. Saves the picks with the post. Always, even if lists are off.
2. If lists are live, the channel has a tracking id, the channel is on the website and is not a 24/7 stream: builds `https://www.amazon.com/dp/<ASIN>?tag=<tracking id>` for each pick, checks it matches that exact shape, and sends `src/data/lists/<episode_id>.json` to the website.
3. Only after that works, adds the block to the caption, any per-platform caption, and the first comment:
   - Line 1: the channel's pointer line plus where to go. Long YouTube, Facebook and Bluesky get the full list URL. Shorts, Instagram and TikTok get `expectlessmedia.com/<channel>/resources/` (the bio page), because their text is not clickable.
   - Line 2: the disclosure sentence.
4. If step 2 fails, the post goes out with its text unchanged and the failure shows on the post (`list_state: failed`) and in the Log. Nothing holds a post.
5. After the video is live on YouTube, ELO adds its video id to the list file (within about 10 minutes) so the list also shows on the video's watch page.

The manual New Post page has the same Amazon picks box and uses the same code. A manual post's list id is `<channel-slug>-manual-<post number>`.

## Owner setup (once)

1. In Amazon Associates add expectlessmedia.com as a Site, and create one tracking id per channel.
2. In ELO: Setup Channels, pick the channel, Website tab, Amazon lists card. Paste the tracking id. Edit the two lines if the defaults are not right (the Spanish channel starts with Spanish lines).
3. Turn on "Amazon lists are live". Posts that were waiting catch up.
4. Starter picks per channel live on the website in `src/data/resources/<channel slug>.json` (the desk supplies them). A channel only gets list pages if it has `amazonLists` in `channel-extras.json` (Teach Your Parents Tech, Usefully Useless Info and Mamá, No Toques Eso today). Ambient and stream channels have none.
