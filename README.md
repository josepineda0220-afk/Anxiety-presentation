# Anxiety Disorders: 3D Brain Presentation

An interactive group presentation for a nursing mental health course. A 3D brain moves to show
the region each slide is about, and turns to glass to reveal structures deep inside it.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Presenting and editing slides

- **ArrowRight**, **Space**, or **PageDown** steps forward; **ArrowLeft** or **PageUp** steps back.
- Number keys **1–9** jump directly to Sections 1–9.
- Press **I** (or move the mouse and click **Input mode** at the bottom right) and enter the team password
  (default: `nursing2026`, configurable via `VITE_EDIT_PASSWORD`) to unlock editing:
  - Switch between sections in the top bar, double-click a section tab to rename it, or use **+ Section** / **−** to add or remove sections.
  - Toggle each section's **Backdrop** between **Blue** and **Lavender** (the 3D background smoothly crossfades when moving between sections).
  - Choose each section's **Cursor** effect: **Move away** (the dots step aside around the cursor), **Ripple** (rings spread through the background colour and carry the dots with them), or **Off**.
  - Add or remove slides within a section using **+** / **−** next to the slide numbers.
  - Click **Text box** to add text, drag to position, drag handles to resize, and double-click to edit.
  - Click the lock icon to re-lock Input Mode, or **Done** (`Esc`) to return to presenting.

## Exploring the brain

There is no on-screen hint for this; it works the same while presenting and in Input Mode, on a
phone, tablet, or computer.

- **Double-tap (or double-click) the brain** to take hold of it.
- **Scroll or drag in any direction** to turn it: one finger on a touch screen, two fingers on a
  trackpad, or the mouse wheel (hold **Shift** to turn sideways) or a click-and-drag with a mouse.
- **Pinch out** to gradually pull the parts of the brain apart, and pinch in to bring them back
  together. This needs a touch screen or a trackpad; with a plain mouse, hold **Ctrl** and scroll.
- **Double-tap again**, anywhere, to let go. The brain eases back to what the slide was showing.
  Moving to another slide lets go as well.

Only your own screen changes. Teammates and viewers keep seeing the slide as it was.

## Cloud Sync (Supabase), Password Gate & End-to-End Encryption (E2EE)

All edits are cached locally and, when Supabase is configured, encrypted client-side in the browser using
**Web Crypto (`PBKDF2` + `AES-256-GCM`)** before being sent to Supabase over HTTPS. Supabase only ever stores
opaque `ciphertext`, `iv`, and `salt`. Database writes are gated by a Postgres `SECURITY DEFINER` RPC that
verifies a cryptographic token derived from the team password.

### 1. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** in your Supabase dashboard, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
3. Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

- `VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY`: from **Project Settings → API**.
- `VITE_EDIT_PASSWORD`: the password your team will type when unlocking Input Mode.
- `VITE_DECK_ENCRYPTION_KEY`: a secret passphrase used to derive the 256-bit AES-GCM encryption key.

### 2. Deploy with Automatic HTTPS

Both **Vercel** ([`vercel.json`](vercel.json)) and **Cloudflare Pages / Netlify** ([`public/_headers`](public/_headers)) are preconfigured with automatic HTTPS and `Strict-Transport-Security` (HSTS) headers:

- **Vercel**: Import the Git repository at [vercel.com/new](https://vercel.com/new), add the environment variables from `.env`, and click **Deploy**.
- **Cloudflare Pages**: Connect the repository in Cloudflare Pages with build command `npm run build`, output directory `dist`, and add the environment variables from `.env`.

## The brain model

`public/models/brain.glb` is already built, so you only need this to change the model itself.
It needs [uv](https://docs.astral.sh/uv/) and the Z-Anatomy `Startup.blend`, which is not stored here.

```bash
# 1. Pull the brain out of the full-body atlas
uv run --no-project --python 3.13 --with bpy \
  python -I tools/extract_brain.py Startup.blend brain_only.blend

# 2. Build the web model
uv run --no-project --python 3.13 --with bpy --with numpy --with scipy --with trimesh \
  --with scikit-image python -I tools/build_brain.py brain_only.blend brain_raw.glb

# 3. Compress it
npx gltf-transform meshopt brain_raw.glb public/models/brain.glb --level medium
```

## Credits

3D anatomy is derived from [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy) and
BodyParts3D, under CC BY-SA 4.0. See `public/models/LICENSE.md`.

For education only. Not medical advice.
