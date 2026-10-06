# Setup B: Meta (Facebook Pages and Instagram)

Time needed: about 20 minutes. Cost: free.
You will end up with an **App ID** and an **App Secret** to paste into Expect Less Output.

Meta changes these screens often. If a screen does not match, screenshot it and ask Claude "where do I click?"

## Before you start (check these once)

1. Each brand's Instagram is a **Professional** account (Business or Creator). You said yes.
2. Each Instagram is **linked to that brand's Facebook Page**. To check, in the Instagram app go to your profile, tap the menu (three lines), then **Accounts Center** or **Settings**, and look for the connected Facebook Page.
3. Your personal Facebook profile has **full control** of every brand Page. In Meta Business Suite, open each Page's settings, then **Page access**, and make sure you have full control.
4. You do NOT need to set up Business Portfolios for this.

## Step 1: Become a Meta developer

1. Go to https://developers.facebook.com
2. Click **Log in** and log in with your personal Facebook account (the one that manages the Pages).
3. Click **Get Started** (or **My Apps** if you already see it).
4. Follow the prompts: accept the terms, verify your account with your phone number or email, and pick **Developer** as your role if asked.

## Step 2: Create the app

1. Click **My Apps** (top right), then **Create App**.
2. **App details:**
   - App name: `Expect Less Output`
   - App contact email: your email
   - Click **Next**.
3. **Use cases:** select **Manage everything on your Page**. If you also see a use case for publishing Instagram content through Facebook Login, select it too. Click **Next**.
   - If you do not see these, choose **Other**, click **Next**, choose app type **Business**, and continue. Then tell Claude Code which path you used.
4. **Business:** choose **I don't want to connect a business portfolio yet** (or skip). Click **Next**.
5. Review and click **Create app** (or **Go to dashboard**). Enter your Facebook password if asked.

## Step 3: Add the permissions

1. In the app dashboard left menu, click **Use cases**.
2. Next to "Manage everything on your Page," click **Customize**.
3. Find each permission below. If it does not say "Ready for testing" or "Added," click **Add** next to it:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `business_management`
   - `instagram_basic`
   - `instagram_content_publish`
   - `read_insights`
   - `instagram_manage_insights`
4. If an Instagram permission is not in this list, go back to **Use cases** and look under the Instagram use case, or click **Add use case** and add the Instagram one. Then add it there.

## Step 4: Set the login redirect

1. In the left menu find **Facebook Login** settings (it may be inside the use case under **Settings**, or under **Products**, then **Facebook Login**, then **Settings**).
2. In **Valid OAuth Redirect URIs** type:
   ```
   http://localhost:53682/meta/callback
   ```
   (If Claude Code picked a different port, use the address Claude Code gives you.)
3. Click **Save changes**.
4. If Meta refuses a localhost address, that is fine. While the app is in Development mode, localhost is usually allowed automatically. Tell Claude Code if login fails.

## Step 5: Copy the App ID and App Secret

1. In the left menu click **App settings**, then **Basic**.
2. Copy the **App ID** into a note in your "ELO Keys" folder.
3. Next to **App Secret** click **Show**, enter your Facebook password, and copy it to the same note.
4. Do not share these or paste them into any chat.

## Step 6: Leave the app in Development mode

- At the top of the dashboard it says **Development** (or "Unpublished"). Leave it that way.
- Because you are the app's admin and you manage all the Pages, everything works for your own accounts without Meta's App Review.

## Step 7: Paste into Expect Less Output and connect (after Phase 3 is built)

1. In Expect Less Output go to **Connections**, then **Meta**, and paste the App ID and App Secret. Click **Save**.
2. Click **Connect Meta**. Your browser opens a Facebook login.
3. Facebook asks which Pages and Instagram accounts to allow. Choose **all** brand Pages and **all** brand Instagram accounts. Click **Continue** or **Save** through each screen.
4. Back in Expect Less Output, match each brand to its Facebook Page and Instagram account and click **Save**.
5. Facebook connections last about 60 days. Expect Less Output will remind you 7 days before. When reminded, click **Reconnect Meta** and repeat steps 2 to 4.

## When the new brands launch

After you create the Facebook Page and Instagram for Teach Your Parents Tech or The Math of It (and link them together), click **Reconnect Meta** in Expect Less Output. On the Facebook screen, make sure the new Page and Instagram are checked, then assign them to the brand.
