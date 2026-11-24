# Anxiety Disorders: 3D Brain Presentation

An interactive group presentation for a nursing mental health course. A 3D brain moves to show
the region each slide is about, and turns to glass to reveal structures deep inside it.

**The deck lives at https://anxiety-brain-deck.web.app.** Anyone can view it. Anyone with the team
password can edit it, from any device, at the same time as everyone else.

## Presenting and editing slides

- **ArrowRight**, **Space**, or **PageDown** steps forward; **ArrowLeft** or **PageUp** steps back.
- Number keys **1–9** jump directly to Sections 1–9.
- Press **I** (or move the mouse and click **Input mode** at the bottom right) and enter the team
  password to edit:
  - Switch between sections in the top bar, double-click a section tab to rename it, or use **+ Section** / **−** to add or remove sections.
  - Toggle each section's **Backdrop** between **Blue** and **Lavender** (the 3D background smoothly crossfades when moving between sections).
  - Choose each section's **Cursor** effect: **Move away** (the dots step aside around the cursor), **Ripple** (rings spread through the background colour and carry the dots with them), or **Off**.
  - Add or remove slides within a section using **+** / **−** next to the slide numbers.
  - Click **Text box** to add text, drag to position, drag handles to resize, and double-click to edit.
  - The clock icon opens the **version history**; the lock icon signs out; **Done** (`Esc`) returns to presenting.

Signing in lasts until the browser tab closes. Reloading the tab keeps you signed in; a new tab
asks for the password again.

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

## Editing together

- **Everyone sees changes live**, whether they are editing or just watching.
- **Each section and each text box saves on its own**, a moment after you stop typing. Two people
  editing different boxes, or different sections, never get in each other's way.
- **The badge in the toolbar** says what is happening: *Saved*, *Saving…*, *Offline* (your changes
  save when you reconnect), *Conflict*, or *Edited elsewhere* (see below).
- **A change never overwrites someone else's.** Every save names the revision it started from, and
  the database refuses it if someone else saved that part first. Then:
  - If you changed different things (say, you moved a box while they fixed its text), the app
    combines both without asking.
  - If you both changed the same thing, it shows both versions and asks: **Reload theirs**,
    **Keep mine**, or **Merge both** (keeps both texts).
- **The box you are typing in is never changed under you.** If someone else edits it meanwhile, the
  badge says *Edited elsewhere*, and you choose between the versions when you finish typing.
- **History:** while people edit, a snapshot of the whole deck is saved about every 5 minutes.
  **Restore** in the version history brings one back for everyone. A restore is saved as a new
  change, so nothing in the history is ever lost.

## How the deck is stored, and who can change it

The deck is plain data in Cloud Firestore (project `anxiety-brain-deck`). It is public on purpose,
so it is not encrypted; HTTPS protects it in transit and Google encrypts it at rest.

| Path | What it holds |
| --- | --- |
| `presentations/anxiety-deck` | The index: section order, text box ids, snapshot bookkeeping |
| `presentations/anxiety-deck/sections/{id}` | One section and its slides |
| `presentations/anxiety-deck/boxes/{id}` | One text box |
| `presentations/anxiety-deck/versions/{n}` | Snapshots of the whole deck (editor only) |

Every document carries `schemaVersion`, `revision`, `updatedAt` (server time) and `updatedBy`.
[`firestore.rules`](firestore.rules) enforce, for every write:

- only the one shared editor account (pinned by UID) may write;
- exactly the expected fields, within size limits;
- `updatedBy` is the signed-in account and `updatedAt` is the server's time;
- `revision` goes up by exactly 1;
- nothing is ever deleted (removing a box saves it with `deleted: true`);
- anyone may read a document, but nobody may list or query the collections, except the editor
  listing versions;
- versions can only be added, no more than one every few minutes, and never changed.

[App Check](https://firebase.google.com/docs/app-check) with reCAPTCHA Enterprise keeps scripts
other than this app from using the project, and the site sends a Content-Security-Policy in
report-only mode.

## Setup checklist (Jose)

These need the Firebase console or your own credentials, so only you can do them. Do them in this
order: the rules go live before the new app, and the deck is migrated in between.

1. **Editor account.** Firebase console → Authentication → Sign-in method: Email/Password on.
   Users → add (or reset the password of) `editors@anxiety-presentation.invalid` with a strong
   team password: a long passphrase, not the old default. Share it only with the group and the
   professor.
2. **Pin its UID in the rules.** Copy that user's **User UID** and replace `REPLACE_WITH_EDITOR_UID`
   in [`firestore.rules`](firestore.rules). Until then, nobody can save anything.
3. **Email enumeration protection.** Authentication → Settings → User actions → turn on
   *Email enumeration protection*.
4. **App Check.**
   1. App Check → Apps → register the web app with **reCAPTCHA Enterprise**; add
      `anxiety-brain-deck.web.app` and `anxiety-brain-deck.firebaseapp.com` as allowed domains.
   2. Put the site key in `.env` as `VITE_APPCHECK_SITE_KEY`, and set `VITE_EDITOR_EMAIL` (see
      [`.env.example`](.env.example)). Remove `VITE_DECK_ENCRYPTION_KEY` once step 6 is done.
   3. For local development, register a debug token (App Check → Apps → ⋮ → Manage debug tokens)
      and put it in `.env.development.local` as `VITE_APPCHECK_DEBUG_TOKEN`.
   4. Watch App Check → APIs → Cloud Firestore and Authentication for a day or two after the
      deploy. Once nearly all requests are verified, click **Enforce** for both.
5. **Deploy the rules first:** `firebase deploy --only firestore:rules`. From now on the old app
   can no longer save, so the deck holds still for the migration.
6. **Migrate the deck to plain data**, dry run first (details under *Migrating the old deck*):
   ```bash
   gcloud auth application-default login
   read -s "LEGACY_DECK_KEY?Old deck key: "; echo; export LEGACY_DECK_KEY
   node tools/migrate-plaintext.mjs --project anxiety-brain-deck --dry-run
   node tools/migrate-plaintext.mjs --project anxiety-brain-deck
   unset LEGACY_DECK_KEY
   ```
7. **Then deploy Hosting:** `firebase deploy --only hosting` (it builds first, from your `.env`).
   Open https://anxiety-brain-deck.web.app and check the deck, then edit something.
8. **Repository homepage.** On GitHub: the ⚙ next to *About* → Website →
   `https://anxiety-brain-deck.web.app`.
9. **Shut down Supabase.** In the Supabase dashboard, pause and then delete project
   `qcqtyjoawhiixshnyubi`. Nothing uses it any more.

The old Vercel site keeps working as a permanent (301) redirect to the Firebase address
([`vercel.json`](vercel.json)), so old links still land on the deck.

## Run it locally

```bash
npm install
npm run dev          # uses the Firebase project in .env
```

Then open http://localhost:5173. Without `.env` the deck runs view-only, from the content built
into the app.

### Against local emulators (no real project needed)

The Firebase emulators need Java 21.

```bash
npm run emulators       # terminal 1: Auth + Firestore emulators and a local editor account
npm run dev:emulators   # terminal 2: the app, talking to the emulators
```

The local team password is `local-password`. The first time you unlock, the app saves the deck on
screen to the emulator.

### Tests

```bash
npm run typecheck
npm test               # unit tests: sync engine, merging, storage format, migration
npm run test:rules     # Firestore rules and the migration, against the emulator (needs Java 21)
npm run build
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all four on every pull request.
The emulators only ever run under a `demo-` project id, which cannot reach a real project.

## Migrating the old deck

Before this change the deck was one encrypted document. `tools/migrate-plaintext.mjs` turns it into
the plain layout above. It uses the Firebase Admin SDK with your own Google credentials
(`gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS` pointing at a
service-account key kept outside the repository); nothing is stored in the repository.

- It asks for the old `VITE_DECK_ENCRYPTION_KEY` (or reads `LEGACY_DECK_KEY`), and never prints it.
- `--dry-run` decrypts, checks every section and box against the rules' limits, and prints a
  summary, without writing anything.
- Before writing, it saves the encrypted original, unchanged, to `backups/` on your computer (git
  ignores that folder) and to `migrationBackups/` in Firestore, which no client can read.
- It writes every section and box, the index, and a first saved version. Run it again and it sees
  the deck is already migrated and does nothing.

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
