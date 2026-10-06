# Setup E: Cloudflare R2 (only if Claude Code says Instagram needs it)

Skip this unless Claude Code tells you in Phase 3 that Instagram cannot take the video file directly. R2 holds each video for a few minutes so Instagram can download it, then Expect Less Output deletes it. The free tier covers this easily.

## Step 1: Turn on R2

1. Go to https://dash.cloudflare.com and log in.
2. In the left menu click **R2 Object Storage**.
3. If asked, click **Purchase R2 Plan** or **Enable R2** and add a payment method. The free tier is 10 GB of storage. Expect Less Output deletes files right after posting, so you should stay at $0.

## Step 2: Create a bucket

1. Click **Create bucket**.
2. Name: `elo-temp`
3. Location: **Automatic**.
4. Click **Create bucket**.

## Step 3: Auto-delete old files (safety net)

1. Open the `elo-temp` bucket, then **Settings**.
2. Find **Object lifecycle rules** and click **Add rule**.
3. Name: `delete-after-1-day`. Apply to all objects. Action: **Delete objects** after **1** day.
4. Click **Save**.

## Step 4: Create an access key for Expect Less Output

1. Go back to **R2 Object Storage** (overview page).
2. Click **Manage R2 API Tokens** (or **API**, then **Manage API tokens**).
3. Click **Create API token**.
   - Name: `Expect Less Output`
   - Permissions: **Object Read & Write**
   - Specify bucket: choose **elo-temp** only.
   - TTL: **Forever**.
4. Click **Create API Token**.
5. Copy these into your "ELO Keys" note (you will only see the secret once):
   - **Access Key ID**
   - **Secret Access Key**
   - **Endpoint** for S3 clients (looks like `https://<account id>.r2.cloudflarestorage.com`)

## Step 5: Paste into Expect Less Output

In Expect Less Output go to **Settings**, then **Instagram temporary storage**, and paste the Endpoint, Access Key ID, Secret Access Key, and bucket name `elo-temp`. Click **Save**, then click **Test**.
