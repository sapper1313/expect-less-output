# Setup D: Website Pages on ExpectLessMedia.com (prompt for Claude Code)

Run this prompt in Claude Code inside your **Expect Less Media website project** (not the Expect Less Output project). TikTok requires these pages, and Google's audit form asks for a website.

Paste everything below the line into Claude Code.

---

In this website project, add four new pages that match the existing site design. Before building, look at how the site is structured and deployed (it is hosted on Cloudflare) and ask me any questions. Use plain, clear language. No em dashes anywhere.

1. **App info page** at `/output/`
   - Title: Expect Less Output
   - Show the wide logo (I will give you `ExpectLessOutput-wide-noBG.png`; ask me for it) and the tagline "The algorithm has been fed."
   - Text: Expect Less Output is a private desktop scheduling tool built and used by Expect Less Media to publish short videos to its own YouTube, Facebook, Instagram, and TikTok accounts. It is not offered to the public.
   - Links to the privacy policy and terms pages.
   - Contact email (ask me which address).

2. **Privacy policy** at `/privacy/`
   - Covers Expect Less Output and the website.
   - State: Expect Less Output runs only on the owner's computer. It connects only to accounts owned by Expect Less Media using official login flows from Google (YouTube), Meta (Facebook and Instagram), and TikTok. Access tokens are stored encrypted on the owner's computer and are never sold or shared. Videos and captions are sent only to the platforms the owner chooses. No data from other users is collected. How to request deletion (contact email). Effective date.
   - Include the sentences required by Google's API Services User Data Policy and the YouTube API Services terms: Expect Less Output uses YouTube API Services, with links to the YouTube Terms of Service (https://www.youtube.com/t/terms) and the Google Privacy Policy (https://policies.google.com/privacy), and how to revoke access at https://security.google.com/settings/security/permissions.
   - Add a note at the bottom of your response telling me this is a template and not legal advice.

3. **Terms of service** at `/terms/`
   - Simple terms for the site and Expect Less Output as an internal tool: no warranty, owner-use only, governing law Wyoming (ask me to confirm), contact email.

4. **OAuth return page** at `/oauth/tiktok/`
   - A tiny static page with no tracking and no analytics.
   - JavaScript reads `code`, `state`, `error`, and `error_description` from the URL query string.
   - If `code` exists: immediately redirect to `expectless://oauth/tiktok?code=<code>&state=<state>` (URL-encode both). Also show the text "Returning you to Expect Less Output. If nothing happens, copy this code and paste it into Expect Less Output:" with the code in a box and a Copy button.
   - If `error` exists: show the error text and "Close this tab and try again in Expect Less Output."
   - Must be served over HTTPS at exactly `https://expectlessmedia.com/oauth/tiktok/` (with the trailing slash working).
   - The page must not be indexed: add `<meta name="robots" content="noindex">`.

Then deploy, give me the four live URLs, and give me numbered steps to confirm each page loads on my phone.
