# Setup: Bluesky, X, LinkedIn, Pinterest and Snapchat

These five are optional. A channel only posts to one when you give it a login here. If you leave a platform blank for a channel, that platform is not part of the channel and ELO ignores it.

All of it happens in ELO on **Connections**, in the boxes under TikTok called **More platforms**.

Two things to know first:

- **One login per channel.** Each channel signs in to its own account on each platform. When you press Connect, your browser opens that platform. Make sure the browser is signed in to the right account for that channel (a private window helps), or sign in to the right one on the page.
- **Keys are for the whole app, logins are per channel.** For X, LinkedIn and Pinterest you save one set of app keys (Client ID and Client Secret), then press Connect once per channel.

Nothing here has been tried against the real platforms yet. If a step looks different on their site, take a screenshot and tell Claude.

---

## Bluesky (easy, no app needed)

1. Open Bluesky, then Settings, then **Privacy and security**, then **App passwords**.
2. Press **Add App Password**. Name it `ELO`. Copy the password (Bluesky shows it once).
3. In ELO, Connections, More platforms, find the channel's **Bluesky** box. Type the handle (like `veda.bsky.social`) and paste the app password. Press **Save and test**.

Limits: Bluesky takes videos up to 3 minutes and 100 MB, and has a daily video allowance. Longer videos skip Bluesky.

---

## X (Twitter)

X charges for its API. At the time of writing it is pay per use (about 1.5 cents per post). You must add credit before it works.

1. Go to **developer.x.com** and sign in with the X account you want to use.
2. Sign up for API access and add a few dollars of credit (Billing, or Credits).
3. Create a **Project**, then an **App** inside it.
4. Open the App, find **User authentication settings**, press **Set up**, and fill in:
   - App permissions: **Read and write**
   - Type of App: **Web App, Automated App or Bot** (the confidential one)
   - Callback URI / Redirect URL: `http://127.0.0.1:47831/callback`
   - Website URL: your website
   Press **Save**.
5. Open **Keys and tokens**. Under **OAuth 2.0 Client ID and Client Secret**, copy both (you may need to press Generate for the secret).
6. In ELO, More platforms, **X app keys**: paste both and press **Save keys**.
7. In each channel's **X** box press **Connect**, sign in to that channel's X account, and press **Authorize app**.

Videos: up to 20 minutes on most accounts. Posts are 280 characters.

---

## LinkedIn

Posts go to your personal profile. The login lasts 60 days. ELO warns you a week before it ends, and you press Connect again.

1. Go to **linkedin.com/developers** and press **Create app**. LinkedIn asks for a Company Page to attach the app to. Any page you manage works, and you can make a tiny one just for this.
2. Open the app, then **Products**. Request **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**. Both approve right away.
3. Open **Auth**. Under **Authorized redirect URLs for your app** add `http://127.0.0.1:47832/callback`.
4. On the same page copy the **Client ID** and **Primary Client Secret**.
5. In ELO, More platforms, **LinkedIn app keys**: paste both and press **Save keys**.
6. In each channel's **LinkedIn** box press **Connect** and approve.

Videos: 3 seconds to 30 minutes. Posting as a Company Page needs a different LinkedIn approval that is not built.

---

## Pinterest

1. Go to **developers.pinterest.com**, sign in with a Pinterest **business** account, and press **Connect app** (or My apps, Connect app). Pinterest reviews new apps, which can take a few days. You get **Trial access** first.
2. Open the app. Add `http://127.0.0.1:47833/callback` as a **Redirect URI**.
3. Copy the **App ID** and **App secret key**.
4. In ELO, More platforms, **Pinterest app keys**: paste both and press **Save keys**.
5. In each channel's **Pinterest** box press **Connect**, approve, then pick the **Board** the videos should go to.

Important: with Trial access Pinterest only shows the pins to you. To make them public, apply for **Standard access** on the same page (Pinterest asks for a short screen recording of the sign-in flow).

Videos: 4 seconds to 15 minutes.

---

## Snapchat

Snapchat does not let apps post to Spotlight (that is only for approved business partners), so this one is a reminder, not an automatic post.

1. In ELO, More platforms, the channel's **Snapchat** box: type the Snapchat username and press **Save**.
2. When a video's time comes, ELO copies the caption, tells you, and shows the post as waiting. Open Snapchat, choose Spotlight, pick the video, paste the caption and post. Then open the post in ELO and press **Mark as posted**.

---

## If something does not connect

- "Port is already in use": close any other sign-in tab and press Connect again.
- The platform says the redirect address is wrong: copy the address ELO shows in the app keys box exactly, with `http://` and no spaces.
- The login worked but a post fails: the Queue shows the exact message from the platform. Send it to Claude.
