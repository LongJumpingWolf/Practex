/* /api/upload-image.js — Vercel serverless function.
   Relays image uploads to ImgBB (https://imgbb.com) so the ImgBB API key never sits
   in the client-side page source, and so uploads go out from Vercel's IP rather than
   the visitor's (avoids shared-residential-IP rate-limit exhaustion on ImgBB's free
   tier, where many people behind one ISP-assigned IP would otherwise compete for the
   same quota).

   Setup:
   1. Get a free API key at https://api.imgbb.com/ (sign in with a Google/email
      account, no credit card).
   2. In your Vercel project: Settings → Environment Variables → add
        IMGBB_API_KEY = <your key>
      then redeploy (env vars only take effect on the next deploy).
   3. Nothing else to configure — Practex already POSTs to /api/upload-image with
      { imageBase64: "<base64 string, no data: prefix> " } and expects back either
      { url: "<https url>" } on success or { error: "<message>" } on failure.

   This file only works if deployed on Vercel (or another host that runs
   /api/*.js files as serverless functions, e.g. via the same convention). If you're
   hosting on something that only serves static files (e.g. GitHub Pages), image
   upload won't work — images will still be usable locally on the device that added
   them, they just won't sync to other devices. */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'IMGBB_API_KEY is not set on the server' });
    return;
  }

  const { imageBase64 } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    res.status(400).json({ error: 'Missing imageBase64 in request body' });
    return;
  }

  try {
    const form = new URLSearchParams();
    form.set('image', imageBase64);

    const uploadRes = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });

    const data = await uploadRes.json().catch(() => null);

    if (!uploadRes.ok || !data || !data.success || !data.data || !data.data.url) {
      const message = (data && data.error && data.error.message) || `ImgBB upload failed (HTTP ${uploadRes.status})`;
      res.status(502).json({ error: message });
      return;
    }

    res.status(200).json({ url: data.data.url });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : 'Unexpected error during upload' });
  }
}
