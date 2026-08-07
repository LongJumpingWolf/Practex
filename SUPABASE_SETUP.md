# Setting up Supabase + Google sign-in for Practex

This covers everything from zero to a working "Continue with Google" button that syncs
your library to the cloud. Budget about 15–20 minutes the first time.

**Important constraint up front:** Google OAuth will not work by opening `Practex.html`
directly from your file system (`file://...`). It needs to be served from a real
`https://` URL. Free options that work fine for this: **Vercel**, **Netlify**, **GitHub
Pages**, or Supabase's own static hosting isn't a thing, so pick any of the first three —
just drag-and-drop the HTML file in, no build step needed since it's a single static file.

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → sign in → **New project**.
2. Pick an org, name it (e.g. `practex`), set a database password (save it somewhere —
   you won't need it for this setup, but Supabase requires one), pick a region close to
   your users, and create the project. It takes 1–2 minutes to provision.

## 2. Get your API keys

1. In your new project, go to **Settings → API**.
2. Copy the **Project URL** (looks like `https://abcdefghijk.supabase.co`).
3. Copy the **anon / public** key under "Project API keys" (a long JWT-looking string).
   Do *not* use the `service_role` key — that one must never go in client-side code.
4. In this folder, copy `config.example.js` to a new file named `config.js` (same
   folder as `index.html`), and fill in your two values:
   ```js
   window.PRACTEX_CONFIG = {
     SUPABASE_URL: 'https://abcdefghijk.supabase.co',
     SUPABASE_ANON_KEY: 'eyJ...'
   };
   ```
   `config.js` is deliberately a separate file from `index.html` — set it up once and
   you never have to touch it again, even if `index.html` gets updated later. The anon
   key is safe to ship in client code — it only grants what your Row Level Security
   policies allow (which is: a user can only ever touch their own rows — see the
   schema file). Make sure `index.html` actually has a
   `<script src="config.js">` tag before its main script — it's already there if
   you're using the file as provided.

## 3. Run the database schema

1. In Supabase, go to **SQL Editor → New query**.
2. Open `supabase_schema.sql` (in this folder), copy the whole thing, paste it in, and
   click **Run**.
3. You should now see two tables under **Table Editor**: `mcqs` and `user_settings`,
   both with RLS (Row Level Security) enabled.

## 4. Create Google OAuth credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → create a new
   project (or reuse one) → **APIs & Services → OAuth consent screen**.
   - User type: **External** (unless everyone using this has a Google Workspace account
     in the same org, in which case Internal is fine).
   - Fill in the app name, your email, etc. You can leave scopes at the default
     (email/profile) — Practex doesn't need anything beyond basic sign-in.
   - Add yourself as a test user if the app is still in "Testing" publishing status
     (Google will otherwise block anyone else from signing in until you publish it).
2. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Name it whatever (e.g. `Practex`).
   - **Authorized redirect URIs** — this is the one step people get wrong. Go back to
     Supabase → **Authentication → Providers → Google**, and it will show you the exact
     callback URL to use, which looks like:
     ```
     https://<your-project-ref>.supabase.co/auth/v1/callback
     ```
     Copy that exact URL into Google Cloud's "Authorized redirect URIs" field.
3. Click **Create**. Google will show you a **Client ID** and **Client Secret** — keep
   this tab open, you need both in the next step.

## 5. Enable Google in Supabase

1. In Supabase: **Authentication → Providers → Google**.
2. Toggle it **on**.
3. Paste in the **Client ID** and **Client Secret** from step 4.
4. Save.

## 6. Set your Site URL / Redirect URLs in Supabase

1. Still in Supabase: **Authentication → URL Configuration**.
2. Set **Site URL** to wherever you're hosting `Practex.html` (e.g.
   `https://your-practex-site.vercel.app`).
3. Under **Redirect URLs**, add that same URL (and `http://localhost:xxxx` too if you
   want to test locally via a local dev server — note: `file://` still won't work even
   listed here, it must be served over `http(s)://`, a local server like
   `npx serve` or VS Code's "Live Server" extension is enough for local testing).

## 7. Set up image hosting (ImgBB) — optional, but needed for images on questions

Practex can attach images to questions (screenshots, diagrams, etc.). Images are never
stored in Supabase — only a `{hash: url}` text lookup is. The actual image bytes go to
[ImgBB](https://imgbb.com), a free image host, via a small server-side relay
(`api/upload-image.js`) that keeps your ImgBB key private and routes uploads through
your hosting provider's IP instead of each visitor's own.

**This step only works if you're hosting on Vercel** (or another provider that runs
`/api/*.js` files as serverless functions the same way). If you're on a purely static
host like GitHub Pages, skip this — the rest of the app still works fine, images just
won't have anywhere to upload to (they'll still work locally on whichever device added
them).

1. Get a free API key at [api.imgbb.com](https://api.imgbb.com/) — sign in with
   Google/email, no credit card needed.
2. In your Vercel project: **Settings → Environment Variables** → add
   ```
   IMGBB_API_KEY = <your key>
   ```
3. Make sure `api/upload-image.js` is included in your deployment (it should already
   be in this folder — Vercel auto-detects anything under `api/` as a serverless
   function, no extra config needed).
4. Redeploy — environment variables only take effect on the *next* deploy, not
   retroactively:
   ```powershell
   git add api/upload-image.js
   git commit -m "Add image upload relay"
   git push
   ```
5. Run the schema addition for the image-URL table if you haven't already — it's
   included in `supabase_schema.sql` (the `mcq_image_urls` table, third one in the
   file). If you already ran the whole file once, just re-run it — `create table if
   not exists` is safe to run again.

## 8. Deploy the file

Push `Practex.html` (as `index.html`) to whichever static host you picked
(Vercel/Netlify/GitHub Pages — all support literally dragging a file into their
dashboard, no build config needed). Once it's live at your `https://` URL, that's the
URL you should have used in step 6.

## 9. Test it

1. Open your deployed URL.
2. You should see the "Continue with Google" sign-in screen instead of the app.
3. Click it → Google's consent screen → approve → you should land back on Practex,
   signed in, with an empty library ready to import into.
4. Check Supabase's **Table Editor → user_settings** — you should see a row appear once
   you interact with any setting (dark mode, FSRS toggle, etc.), and **mcqs** should
   populate once you add or import questions.
5. If you set up image hosting: open any question's Edit modal, click "Add image" or
   paste a screenshot, and confirm a thumbnail appears. Check **Table Editor →
   mcq_image_urls** — a row should show up shortly after (upload happens in the
   background, so it may take a couple seconds).

---

## Troubleshooting

- **"Could not start Google sign-in"** shown on the button → usually means
  `SUPABASE_URL`/`SUPABASE_ANON_KEY` weren't filled in, or Google isn't enabled/saved
  correctly in Supabase yet.
- **Redirects back to Practex but nothing happens / stuck loading** → double check the
  redirect URI in Google Cloud matches Supabase's callback URL *exactly* (including
  `https://`, no trailing slash mismatch), and that your Site URL / Redirect URLs in
  Supabase match where the file is actually hosted.
- **"Error 400: redirect_uri_mismatch"** from Google → same as above, the URI Google
  received doesn't match what's registered in Cloud Console.
- **Signed in but library stays empty / errors in console** → open browser dev tools
  (F12) → Console tab, the app logs Supabase errors there (e.g. RLS policy issues,
  missing tables). Most commonly this means step 3 (running the SQL schema) was
  skipped or only partially ran.
- **Works for you but not for anyone else** → your Google OAuth consent screen is
  probably still in "Testing" mode, which only allows explicitly-added test users to
  sign in. Publish it (Google Cloud Console → OAuth consent screen → Publish App) once
  you're ready for real users — note Google may require verification for some scopes
  if you request more than basic profile/email, which Practex doesn't.
- **Images upload locally (thumbnail shows) but never appear on another device** →
  check the browser console for "Image cloud sync failed" — almost always means
  `IMGBB_API_KEY` isn't set on Vercel, or wasn't set *before* the last deploy (env vars
  don't apply retroactively — redeploy after adding one). Also confirm
  `api/upload-image.js` actually shipped: Vercel dashboard → your deployment → check
  the file tree includes it under `api/`.
- **"That file isn't an image" or nothing happens on paste** → the paste shortcut only
  works while the Edit Question modal is open and focused; clicking elsewhere on the
  page first (e.g. the browser's URL bar) means the paste event never reaches Practex.
