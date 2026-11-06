# Anxiety Disorders: 3D Brain Presentation

An interactive group presentation for a nursing mental health course. A 3D brain moves to show
the region each slide is about, and turns to glass to reveal structures deep inside it.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

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
