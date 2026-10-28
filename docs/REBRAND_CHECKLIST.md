# Rebrand checklist: Expect Less Media to Expect Less Studios (new domain)

Written the night before so tomorrow goes smoothly. Nothing here has been changed yet. Tick the boxes as you go.

Short version: the website is easy to move. The risky part is the TikTok and Google sign-ins, because they are tied to the old domain. Do those in the right order and nothing breaks.

## The golden rules

1. **Do not switch off the old domain until the very end.** Keep expectlessmedia.com working and forwarding to the new one for at least a few weeks.
2. **Do the new domain first, the old one last.** Add the new address to TikTok and Google BEFORE ELO uses it.
3. **One step at a time, test after each step.**
4. Pick a quiet time when nothing is about to post.

## What I found (where the old name lives)

In the ELO app (this project):
- TikTok sign-in return address: `https://expectlessmedia.com/oauth/tiktok/` (`src/main/tiktok/config.ts`). This is the big one.
- Website sync commit email `elo@expectlessmedia.com` (`src/main/website/service.ts`). Cosmetic only.
- Schema ids `https://expectlessmedia.com/schemas/...` (`src/shared/pipeline.ts`, `src/shared/upcoming.ts`, plus the two files in `docs/`). Only labels, nothing fetches them.
- App id `com.expectlessmedia.elo` (`electron-builder.yml`) and the watchdog label `com.expectlessmedia.elo.watchdog` (`src/main/studio/watchdog.ts`, `scripts/watchdog/*.sh`). **Leave these alone.** They are internal names, not shown anywhere. Changing the app id can make macOS treat it as a different app (lost permissions, a second watchdog running). Safer to keep.
- The app name "Expect Less Output" itself. Your call whether it changes. If it does, the data folder `~/Library/Application Support/Expect Less Output` changes too, so do NOT rename the app unless we plan a data move. Recommended: keep the app name.
- Docs that mention the domain: `docs/SETUP_C_TIKTOK.md`, `docs/SETUP_D_WEBSITE_PAGES.md`, `docs/SETUP_A_GOOGLE_YOUTUBE.md`, `docs/05_PHASE_4_TIKTOK.md`, `docs/USER_GUIDE.md`, `docs/00_START_HERE.md`, `docs/01_PROJECT_SPEC.md`, `docs/SELLING_READINESS.md`.

In the website project (`Expectlessmedia` repo on GitHub, the Desktop folder):
- `astro.config.mjs`: `site: 'https://expectlessmedia.com'` (controls the sitemap and links).
- `wrangler.jsonc`: Cloudflare project name `expectlessmedia`.
- `src/data/site.json`, `public/robots.txt`.
- Pages: `index`, `about`, `channels`, `output`, `privacy`, `terms`, `disclosures`, `work-with-us`, `404`, `[slug]`, `watch/[id]`, and the Header, Footer and Spotlight components.
- `.github/workflows/refresh-videos.yml` (check for a hard coded site address).
- Spec and prompt .md files (documentation only).
- The GitHub repo name `Expectlessmedia` and the git address ELO uses to push (`git@github.com:sapper1313/Expectlessmedia.git`).

## Step 0: Decide first (5 minutes)

- [ ] The new domain name, exactly: ______________________
- [ ] Where it is bought (Cloudflare Registrar is easiest because the site is already on Cloudflare).
- [ ] New brand text: "Expect Less Studios" everywhere the site says "Expect Less Media".
- [ ] Do the YouTube, TikTok and other channel names change, or only the website? (Channel renames are separate and touch each platform.)
- [ ] New logo files ready? (The site has `public/brand/ExpectLessStudios-side.jpg` and `-stacked` images already sitting there, untracked.)
- [ ] Keep the GitHub repo name or rename it? Recommended: **rename it later**, after everything works. GitHub forwards the old name, but ELO's saved address should be updated too.
- [ ] Keep the app name "Expect Less Output" and the app id? Recommended: yes, keep both.

## Step 1: Buy and connect the new domain

- [ ] Buy the new domain.
- [ ] Cloudflare: add it as a site (if not bought there). Wait for it to say Active.
- [ ] Cloudflare, Workers and Pages, the `expectlessmedia` project, Settings, Domains: **add the new domain as a custom domain**. Keep the old one too for now.
- [ ] Visit the new address. The site should load (it will still say "Media" for now).
- [ ] Email: if you use email at the old domain (like hello@), set up email at the new one before anything else depends on it. List of addresses used: ______________________

## Step 2: Make the old domain forward to the new one (do this LAST of the domain steps)

- [ ] In Cloudflare, add a redirect rule: everything on expectlessmedia.com goes to the same path on the new domain (permanent, 301).
- [ ] Make sure `/oauth/tiktok/` is NOT forwarded until TikTok is switched over (Step 4). Better: do Step 4 first, then this step.
- [ ] Test: old address opens the new site.

## Step 3: Change the website project

(Claude can do this part in one go. Say "do the website rebrand".)

- [ ] `astro.config.mjs` `site:` to the new address.
- [ ] Replace "Expect Less Media" with "Expect Less Studios" in pages, Header, Footer, Spotlight, `site.json`, `robots.txt`.
- [ ] Swap in the new logo files.
- [ ] Privacy, Terms, Disclosures pages: new name, new domain, new contact email.
- [ ] Check `refresh-videos.yml` for any old address.
- [ ] Build it locally, look at every page, then push. Cloudflare publishes it.
- [ ] Check the sitemap at `/sitemap-index.xml` shows the new domain.
- [ ] Keep the `/oauth/tiktok/` page. It must exist on the new domain.

## Step 4: TikTok (the one that breaks if done in the wrong order)

TikTok only accepts the exact return address you registered. A mismatch means every TikTok sign-in fails.

- [ ] TikTok developer portal, your app: **add** the new Redirect URI `https://NEWDOMAIN/oauth/tiktok/` (keep the old one for now).
- [ ] Update the app's Terms of Service URL, Privacy Policy URL and website URL to the new domain pages. These are part of what TikTok reviewed. Changing them may trigger a re-review, so do it early and expect a wait.
- [ ] Verify the new domain with TikTok again if they ask (URL ownership for your domain).
- [ ] In ELO, TikTok settings: change the return address to the new one (a code change of one line in `src/main/tiktok/config.ts`, plus saving it in the app).
- [ ] Test by reconnecting one TikTok account. Only then remove the old Redirect URI.
- [ ] Remember the sandbox rule: test users must still be added as Target Users.

## Step 5: Google and YouTube

- [ ] Google Cloud Console, OAuth consent screen: update the app homepage, privacy policy and terms links to the new domain.
- [ ] Add the new domain under Authorized domains (it may need Search Console verification).
- [ ] OAuth client: ELO's sign-in uses a local address on this Mac, so redirect URIs probably need no change. Check them anyway.
- [ ] If the consent screen is in production and verified, changing links can trigger re-verification. Do not delete the old links until the new ones are accepted.
- [ ] Test by reconnecting one YouTube channel.
- [ ] Reminder: `docs/SETUP_D_WEBSITE_PAGES.md` holds a Google client secret in plain text. You said to leave it. When you are ready, rotate the secret and remove it from the doc.

## Step 6: Instagram, Facebook, Bluesky, X, LinkedIn, Pinterest

- [ ] Meta developer app (Instagram and Facebook): update the privacy policy URL, terms URL and app domain.
- [ ] Any other app you registered with a website field: update it.
- [ ] Profile bios and links on every channel that point to the old domain.

## Step 7: ELO

(Claude can do this part. Say "do the ELO rebrand".)

- [ ] TikTok return address default (`src/main/tiktok/config.ts`).
- [ ] Commit email `elo@...` (`src/main/website/service.ts`).
- [ ] Schema `$id` values and regenerate with `npm run schemas` and `npm run openapi`.
- [ ] Docs: replace the old domain in the setup guides and the user guide.
- [ ] Website card, Website connection: update the repo address only if the GitHub repo was renamed.
- [ ] Run the tests, build, relaunch.
- [ ] Do NOT touch the app id or the watchdog label.

## Step 8: GitHub (optional, last)

- [ ] Rename the repo (GitHub, Settings). GitHub forwards the old name.
- [ ] Update the Cloudflare project to point at the renamed repo if it asks.
- [ ] Update the address in ELO's Website connection box.
- [ ] Check the refresh-videos job still runs (Actions tab, Run workflow).
- [ ] Update the local clone on your Mac if you keep one: `git remote set-url origin <new address>`.

## Step 9: Search and links

- [ ] Google Search Console: add the new domain and submit the new sitemap.
- [ ] Use Search Console's "Change of address" tool from the old domain to the new one.
- [ ] Update links in video descriptions you control, channel About pages and anywhere else you pasted the old address.
- [ ] Update link-in-bio pages.

## Step 10: Final check, then retire the old domain slowly

- [ ] New site loads, every page, on phone too.
- [ ] Old links forward to the right new pages.
- [ ] One TikTok post, one YouTube post, one Facebook and one Instagram post go through (use a dry run first, then one real one).
- [ ] Website sync: change a tagline in ELO and confirm it appears on the new site.
- [ ] The video refresh job ran on the new site.
- [ ] Wait 2 to 4 weeks, keep paying for the old domain and keep the forward on. Renew it for at least a year. Letting it lapse lets someone else grab it.

## Things that can go wrong (and the fix)

| Problem | Likely cause | Fix |
| --- | --- | --- |
| TikTok says redirect_uri mismatch | New address not added in the TikTok portal, or a missing trailing slash | Add exactly `https://NEWDOMAIN/oauth/tiktok/` |
| TikTok app review restarts | Changed Terms or Privacy URLs | Normal. Keep the old values working while it reviews. |
| Site shows old name | Cloudflare cache | Wait a few minutes or purge the cache |
| Google sign-in warns about an unverified app | Consent screen links changed | Keep old links valid until new ones are approved |
| ELO cannot push to the website | Repo renamed and ELO still has the old address | Update the address in Website connection |
| Two watchdogs or lost permissions | App id was renamed | Put the app id back to `com.expectlessmedia.elo` |
