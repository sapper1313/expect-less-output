# Amazon Lists — desk deliverable for Claude (ELO)
Date: 2026-11-23. From: the production desk (Muse). For: Claude, ELO `docs/AMAZON_LISTS.md` feature.
Status: feature BUILT in ELO, switched OFF, awaiting the owner's tracking IDs. Nothing below changes any drop until the owner turns on "Amazon lists are live" in ELO.

## 1. Sidecar contract — how the desk will send it (effective at go-live)
On bot drops (New Post route), the desk adds an OPTIONAL `products` list to the drop sidecar:
- 0 to 5 items per episode. Omit the field entirely when an episode has no products.
- Each item: `asin` (exactly 10 characters), `name` (desk-written, up to 70 characters), `note` (one sentence, up to 240 characters).
- The desk NEVER sends a `list_url` or any link. ELO builds the product links (amazon.com/dp/<ASIN>?tag=<channel tracking id>), the list page (expectlessmedia.com/lists/<episode_id>/), and the description block (line 1 pointer + link, line 2 disclosure; same block in the first comment).
- Platform shapes per the guide: long YouTube, Facebook and Bluesky get the full list link; Shorts, Instagram and TikTok get expectlessmedia.com/<channel>/resources/.
- If the list page fails, the post goes out unchanged and the failure is logged. A products problem NEVER holds a post.
- ASINs are verified against the live Amazon product page at packaging time (exact 10-character ASIN read off the page). The desk does not guess or reuse an ASIN from memory.
- Compliance carried from the Associates plan: the disclosure sentence and link-level labels are ELO's block (built by the feature); the desk's `name`/`note` text never states a price, a discount, or "lowest ever" language — notes say what the product is and why it fits the video.

## 2. Eligible channels
Teach Your Parents Tech, Usefully Useless, Mamá No Toques Eso, and Grandma's Scratch Pantry (owner correction 2026-11-23: Grandma's IS on the site and eligible; the cookbook is its anchor starter pick). Excluded: the 24/7 stream channels only (Tin Roof Rainy Nights, Fireplace, Brown Noise — blocked by the ELO 24/7 flag). Discontinued channels (Clock Out Early, The Math of It) get no products.

## 2b. First comment structure (owner decision, 2026-11-27)
The first comment leads with the channel's comment question (the engagement ask comes first), then the pointer line. Platform shape, chosen so nothing costs views:
- Facebook and YouTube (the link rides in the comment/description itself): pointer introduces the link directly: "Everything from this video is right here:" + the list link + the disclosure line. (A link in the body of a Facebook POST costs reach; a link in the first comment of a native video post does not. YouTube does not suppress comments/descriptions with links.)
- Instagram and TikTok (no clickable comment links): pointer is "Everything from this video is linked in our bio." Mamá: "Todo lo de este video está en el enlace de nuestro perfil."
- Bios are the weakest traffic source, so the first comment is the primary pointer everywhere; the bio link stays as the backstop.
This refines section 3's pointer wording wherever the two meet: the description block keeps the section 3 pointer; the first comment uses the structure above.

## 3. Pointer wording per channel (desk's answer to Claude's open item)
- Teach Your Parents Tech: "Products from this video:" (default)
- Usefully Useless: "Products from this video:" (default)
- Mamá, No Toques Eso: "Productos de este video:" (default)
- Grandma's Scratch Pantry: "Grandma's kitchen picks from this video:" (custom — direct promotion is fine on this channel)

## 4. Evergreen starter picks per channel (desk's answer to Claude's open item)
Names only — ASINs get verified live at first use, per section 1. Source: the owner's Amazon Associates integration plan (2026-11-23).

- **Teach Your Parents Tech — "Video calls made easy":** Echo Show 8; Echo Dot; Fire HD 10 + case; tablet stand; wireless-charging phone stand; large-button universal remote; long braided charging cables (3-pack); smart plug (2-pack); magnifying lamp; pill organizer with alarm.
- **Usefully Useless — "Behind the facts":** The Travel Book (Lonely Planet); a 1,000-facts book; trivia card game; Ravensburger/White Mountain 1,000-pc puzzle; desktop globe; National Geographic chemistry kit; Shashibo cube; waterproof playing cards. Rotate 2-3 per video, tied to that video's fact — never all of them on every video.
- **Mamá, No Toques Eso — "La cocina y el celular, sin miedo":** Echo Show 8; Fire HD tablet; phone stand; Fullstar picadora; instant-read thermometer; licuadora; comal/tortilla press (verify live rank first); kitchen organization set with Spanish labels; smart plug; large-print night-light.
- **Grandma's Scratch Pantry — "Grandma's working kitchen":** the cookbook itself as the anchor pick (publisher/retail link, labelled as his own book) — ASIN PENDING: the book's Amazon ASIN cannot exist until Amazon approves the book; the desk fills it in the moment the approval lands and does not hold any list or post for it meanwhile; Lodge 12-inch cast-iron skillet; Lodge 6-qt enameled Dutch oven; kitchen scale; instant-read thermometer; nesting mixing bowls; Danish dough whisk; banneton + sourdough starter kit; bench scraper; wooden spoon set.

## 5. Still on the owner before go-live (not the desk)
1. Create one tracking ID per channel in Associates Central.
2. Add expectlessmedia.com as a Site in Associates Central.
3. Turn on "Amazon lists are live" in ELO.

## 6. Desk behavior until go-live
Drops continue exactly as today — no `products` field is sent while the feature is off. The first drop after the switch flips is the first one that can carry products, starting with the evergreen picks above where an episode has no episode-specific products.
