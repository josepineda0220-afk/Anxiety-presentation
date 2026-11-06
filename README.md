# Anxiety Disorders: 3D Brain Presentation

An interactive group presentation for a nursing mental health course. A 3D brain moves to show
the region each slide is about, and turns to glass to reveal structures deep inside it.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Presenting and adding text

Number keys 1–4 move between slides. Each slide points the brain at something and has its own text.

Press **I** (or move the mouse and click **Input mode**, bottom right) to add and arrange text:

- **Text box** adds a box to the current slide. Its placeholder starts selected, so just type.
- Drag a box to move it. Drag the handle on its right edge to set its width; double-click the handle to fit the text again.
- Double-click a box, or select it and press Enter, to edit the text. Esc stops editing.
- The toolbar sets the selected box's style (Title, Heading, Body), colour (black, white, grey) and box
  (clear, or frosted glass). With nothing selected, it sets up the next box.
- Delete removes the selected box. **Done** or Esc goes back to presenting.

Text boxes are saved in the browser's local storage. They survive a reload, but stay on the computer they
were made on.

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
