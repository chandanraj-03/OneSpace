# Provider credential setup (Phase 1)

This guide explains how to create credentials for the cloud storage providers supported by OneSpace: **Google Drive**, **Google Photos**, **Dropbox**, and **MEGA**.

## Redirect URIs used by OneSpace

Use these callback URLs depending on whether you are running locally or deployed on Render:

| Provider | Local Redirect URI | Render Cloud Redirect URI |
| --- | --- | --- |
| Google (Drive, Photos, Login) | `http://localhost:8787/api/accounts/google/callback` | `https://onespace-api.onrender.com/api/accounts/google/callback` |
| Dropbox | `http://localhost:8787/api/accounts/dropbox/callback` | `https://onespace-api.onrender.com/api/accounts/dropbox/callback` |

> If you deploy to another domain or change ports, update the redirect URIs in both the provider developer dashboard and your environment configuration (`backend/.env` or Render Dashboard).

## Environment variables

Add the credentials to `backend/.env` (or configure in Render Blueprint / Dashboard):

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:8787/api/accounts/google/callback

DROPBOX_CLIENT_ID=
DROPBOX_CLIENT_SECRET=
DROPBOX_REDIRECT_URI=http://localhost:8787/api/accounts/dropbox/callback
```

- **Note on Google**: The single pair of `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` handles **Google Drive**, **Google Photos**, and **Google 1-Click Login**!
- MEGA does not use developer credentials in `.env`. MEGA connects directly from the app UI with email/password.

## Google Drive & Google Photos

### 1. Open Google Cloud Console

Open:

`https://console.cloud.google.com/`

Sign in with the Google account that will own the OAuth app.

### 2. Create or select a project

1. Click the project selector in the top bar.
2. Click **New Project** if you do not already have one.
3. Name it, for example `OneSpace`.
4. Open the project.

### 3. Enable Google APIs

1. In the left navigation, go to **APIs & Services** → **Library**.
2. Search for and enable:
   - **Google Drive API**
   - **Photos Library API** (Google Photos)

### 4. Configure the OAuth consent screen

1. Go to **APIs & Services** → **OAuth consent screen**.
2. Choose **External** (or **Internal** if using Google Workspace).
3. Click **Create**.
4. Fill in:
   - **App name**: `OneSpace`
   - **User support email**: your email
   - **Developer contact information**: your email
5. Click **Save and Continue**.
6. On the **Scopes** page, click **Add or Remove Scopes**.
7. Add the scopes:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `.../auth/drive` (or `.../auth/drive.metadata`)
   - `.../auth/photoslibrary.readonly`
8. Click **Update** and then **Save and Continue**.
9. Under **Test users**, add your Google email address.
10. Click **Save and Continue**.

### 5. Create OAuth client credentials

1. Go to **APIs & Services** → **Credentials**.
2. Click **Create Credentials** → **OAuth client ID**.
3. For **Application type**, choose **Web application**.
4. Set **Name** to `OneSpace Web Client`.
5. Under **Authorized redirect URIs**, add both:

   ```text
   http://localhost:8787/api/accounts/google/callback
   https://onespace-api.onrender.com/api/accounts/google/callback
   ```

6. Click **Create**.
7. Copy the **Client ID** and **Client Secret**.

### 6. Copy values into `.env` (or Render Dashboard)

```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:8787/api/accounts/google/callback
```

## Dropbox

Dropbox uses an app key and app secret. In OneSpace they map to:

- **App key** → `DROPBOX_CLIENT_ID`
- **App secret** → `DROPBOX_CLIENT_SECRET`

### 1. Open Dropbox App Console

Open:

`https://www.dropbox.com/developers/apps`

Sign in with the Dropbox account that will own the app.

### 2. Create an app

1. Click **Create app**.
2. For **Choose an API**, select **Scoped access**.
3. For access type, choose one:
   - **Full Dropbox** if OneSpace should access the user's whole Dropbox.
   - **App folder** if OneSpace should only access a dedicated app folder.
4. Give the app a unique name, for example `OneSpace Local`.
5. Click **Create app**.

### 3. Add redirect URI

1. Open the app **Settings** tab.
2. Find **OAuth 2** → **Redirect URIs**.
3. Add:

   ```text
   http://localhost:8787/api/accounts/dropbox/callback
   ```

4. Save or click **Add**.

### 4. Copy app key and app secret

In the **Settings** tab:

- Copy **App key** into `DROPBOX_CLIENT_ID`.
- Click **Show** near **App secret**, then copy it into `DROPBOX_CLIENT_SECRET`.

### 5. Enable permissions

1. Open the **Permissions** tab.
2. Enable these scopes:

   ```text
   account_info.read
   files.metadata.read
   files.content.read
   files.content.write
   ```

3. Click **Submit** if Dropbox asks you to submit permission changes.

### 6. Copy values into `.env`

```env
DROPBOX_CLIENT_ID=your_dropbox_app_key
DROPBOX_CLIENT_SECRET=your_dropbox_app_secret
DROPBOX_REDIRECT_URI=http://localhost:8787/api/accounts/dropbox/callback
```

### Notes

- Dropbox calls the OAuth client ID an **App key**.
- The redirect URI must match exactly.
- OneSpace requests offline access so it can keep using a refresh token.

## MEGA

MEGA does not require creating a developer OAuth application for OneSpace.

### How MEGA connection works

1. Start OneSpace.
2. Open the **Storage** page.
3. Click **Connect** → **MEGA**.
4. Enter:
   - MEGA email
   - MEGA password
   - 2FA code if your account uses two-factor authentication
5. Submit the form.

OneSpace stores the MEGA session and credentials encrypted in the local SQLite database so it can sync and perform file operations later.

### Notes

- There is no `MEGA_CLIENT_ID` or `MEGA_CLIENT_SECRET` for this implementation.
- Keep your local `.env` and SQLite database private.
- If MEGA returns `EAGAIN`, it means MEGA is temporarily busy or unavailable. Wait a few moments and try connecting again.

## What needs OAuth, and what does not

| Provider | OAuth app required? | What you prepare | Where you connect |
| --- | --- | --- | --- |
| Google Drive | Yes (OAuth client in Google Cloud) | Client ID + secret in `.env` | Connect → Google Drive (redirect login) |
| Dropbox | Yes (Dropbox app) | App key + secret in `.env` | Connect → Dropbox (redirect login) |
| MEGA | No | Email + password (+ 2FA) | Connect → MEGA (in-app form) |

- **Developer credentials in `.env`:** Google Drive and Dropbox use a redirect OAuth flow — register the app once, set the client id/secret in `.env`, and every user simply clicks Connect and authorizes.
- **End-user credentials only (no `.env`):** **MEGA** takes the user's email/password directly.

## After editing `.env`

Restart the API server so the new values are loaded:

```text
npm run dev
```

Then open OneSpace and connect accounts from the **Storage** page. For the redirect-based providers (Google Drive, Dropbox), you are sent to the provider to authorize and then returned to the **Storage** page.

## Troubleshooting

### Redirect URI mismatch

If a provider says the redirect URI is invalid, verify that the value in the provider dashboard exactly matches the value in `.env`.

### Missing client secret

For Dropbox, use **App secret**, not the app name.

### Google app is blocked or unavailable

Make sure the OAuth consent screen is configured and that your Google account is added as a test user while the app is in testing mode.

### Dropbox refresh token is missing

Make sure you are using the OneSpace connect flow. The backend requests offline access automatically.

### MEGA temporary error

`EAGAIN` means the MEGA service is temporarily busy or unavailable. Wait a few moments and try again.
