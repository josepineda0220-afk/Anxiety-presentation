"""Step 2 of the brain pipeline: turn the extracted atlas meshes into the web-ready model.

  * Fills each hemisphere as a true solid and extracts its outer surface. The atlas cortex is
    ~70 thin sheets that nearly touch; meshing those directly turns the hairline gaps into noise.
  * Cuts cortical regions (DLPFC and others) straight out of that surface so they sit flush.
  * Rebuilds low-poly structures (the amygdala is only 384 polygons) so close-ups stay smooth.
  * Bakes a sulcal-depth shading term into vertex colours.
  * Writes named nodes that src/brain/regions.ts refers to.

Usage:
  uv run --no-project --python 3.13 --with bpy --with numpy --with scipy --with trimesh \
      --with scikit-image python -I tools/build_brain.py <brain_only.blend> <out.glb>

Coordinates: 1 unit = 5 cm, origin at the centre of the brain, +Y up, +Z anterior, +X patient left.
"""
import sys
import time

import bpy
import numpy as np
import scipy.sparse as sp
import trimesh
from scipy import ndimage
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from skimage import measure

src, dst = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=src, use_scripts=False, load_ui=False)
objects = {o.name: o for o in bpy.data.objects if o.type == "MESH"}


def collections_of(obj):
    return set(obj.get("source_collections", "").split(";"))


def arrays(mesh):
    mesh.calc_loop_triangles()
    verts = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", verts)
    tris = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int32)
    mesh.loop_triangles.foreach_get("vertices", tris)
    return verts.reshape(-1, 3), tris.reshape(-1, 3)


def combined(names, mirror=()):
    """Stack source meshes. Names in `mirror` also get a copy reflected across the midline."""
    vert_chunks, tri_chunks, offset = [], [], 0
    for name in names:
        verts, tris = arrays(objects[name].data)
        vert_chunks.append(verts)
        tri_chunks.append(tris + offset)
        offset += len(verts)
        if name in mirror:
            flipped = verts * np.array([-1.0, 1.0, 1.0])
            vert_chunks.append(flipped)
            tri_chunks.append(tris[:, ::-1] + offset)
            offset += len(verts)
    return np.vstack(vert_chunks), np.vstack(tri_chunks)


def to_object(verts, tris, name):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts.tolist(), [], tris.tolist())
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def evaluate(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    return arrays(mesh)


def largest_component(verts, tris):
    n = len(verts)
    edges = np.vstack([tris[:, [0, 1]], tris[:, [1, 2]]])
    graph = sp.coo_matrix((np.ones(len(edges), dtype=np.int8), (edges[:, 0], edges[:, 1])), shape=(n, n))
    _, labels = connected_components(graph, directed=False)
    keep_label = np.bincount(labels).argmax()
    keep = labels == keep_label
    remap = np.full(n, -1, dtype=np.int64)
    remap[keep] = np.arange(keep.sum())
    tri_keep = keep[tris].all(axis=1)
    return verts[keep], remap[tris[tri_keep]].astype(np.int32)


def rebuild(verts, tris, name, voxel, target_tris, smooth_iters=6, keep_largest=True):
    """Voxel remesh, keep the outer surface, smooth away the voxel steps, decimate to budget."""
    started = time.time()
    obj = to_object(verts, tris, name)
    remesh = obj.modifiers.new("remesh", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = voxel
    remesh.adaptivity = 0.0
    verts, tris = evaluate(obj)
    raw = len(tris)
    if keep_largest:
        verts, tris = largest_component(verts, tris)

    obj = to_object(verts, tris, name + "_shell")
    smooth = obj.modifiers.new("smooth", "SMOOTH")
    smooth.factor = 0.6
    smooth.iterations = smooth_iters
    if len(tris) > target_tris:
        decimate = obj.modifiers.new("decimate", "DECIMATE")
        decimate.ratio = target_tris / len(tris)
    verts, tris = evaluate(obj)
    print(f"  {name:18} remesh {raw:>8} -> {len(tris):>7} tris  ({time.time() - started:.1f}s)", flush=True)
    return verts, tris


def decimate(verts, tris, name, target_tris):
    obj = to_object(verts, tris, name + "_decimated")
    if len(tris) > target_tris:
        modifier = obj.modifiers.new("decimate", "DECIMATE")
        modifier.ratio = target_tris / len(tris)
    return evaluate(obj)


def flood_fill(grid, seal):
    """Everything the outside air cannot reach, treating `grid` as walls."""
    walls = ndimage.binary_dilation(grid, iterations=seal)
    labels, _ = ndimage.label(~walls)
    outside = labels == labels[0, 0, 0]
    del labels, walls
    return ~ndimage.binary_dilation(outside, iterations=seal)


def plug_cavities(solid, factor=4, reach=7, width=3):
    """
    Fills wide air pockets trapped inside the shape.

    The atlas has no planum polare, which leaves a hole above each temporal pole. Air floods in
    and hollows out the lobe. Sulci are narrow and survive this; a flooded lobe is wide and does
    not. Works on a coarse copy, since it only needs the rough shape of the pocket.
    """
    shape = solid.shape
    padded = np.pad(solid, [(0, (-n) % factor) for n in shape])
    a, b, c = (n // factor for n in padded.shape)
    coarse = padded.reshape(a, factor, b, factor, c, factor).any(axis=(1, 3, 5))
    margin = reach + 1
    coarse = np.pad(coarse, margin)
    air = ndimage.binary_closing(coarse, iterations=reach) & ~coarse
    pocket = ndimage.binary_opening(air, iterations=width)
    pocket = ndimage.binary_dilation(pocket, iterations=width + 1) & air
    pocket = pocket[margin:-margin, margin:-margin, margin:-margin]
    print(f"    plugged {int(pocket.sum())} mm3 of trapped air", flush=True)
    fine = pocket.repeat(factor, 0).repeat(factor, 1).repeat(factor, 2)[: shape[0], : shape[1], : shape[2]]
    return solid | fine


def repaired_field(solid, lo, pitch, sigma, bad_points, spread=0.0035, close=8, soft_sigma=3.2):
    """
    Smoothed occupancy, with defective atlas patches rebuilt.

    Two patches (temporal pole, paracentral gyrus) are crumpled in the source and carry open
    edges, which leaves small tunnels no surface smoothing can remove. Closing the volume there
    removes the tunnels, and a wider blur rounds it off, fading back into the healthy tissue.
    """
    field = ndimage.gaussian_filter(solid.astype(np.float32), sigma)
    if bad_points is None:
        return field

    index = ((bad_points - lo) / pitch).astype(np.int64)
    pad = int(spread / pitch) + close + 12
    start = np.maximum(index.min(axis=0) - pad, 0)
    stop = np.minimum(index.max(axis=0) + pad, solid.shape)
    box = tuple(slice(a, b) for a, b in zip(start, stop))

    mask = np.zeros(stop - start, dtype=bool)
    local = index - start
    mask[local[:, 0], local[:, 1], local[:, 2]] = True
    mask = ndimage.binary_dilation(mask, iterations=int(spread / pitch))

    crop = solid[box]
    closed = ndimage.binary_closing(crop, iterations=close)
    rebuilt = np.where(mask, closed, crop)
    soft = ndimage.gaussian_filter(rebuilt.astype(np.float32), soft_sigma)
    blend = ndimage.gaussian_filter(mask.astype(np.float32), 5.0)
    field[box] = field[box] * (1 - blend) + soft * blend
    return field


def solid_surface(verts, tris, name, target_tris, pitch=0.00025, seal=1, sigma=0.9, plug=False, bad_points=None):
    """Rasterise to voxels, flood the outside, and take the boundary of whatever it can't reach."""
    started = time.time()
    source = trimesh.Trimesh(vertices=verts, faces=tris, process=False)
    margin = (seal + 4) * pitch
    lo = verts.min(axis=0) - margin
    shape = np.ceil((verts.max(axis=0) + margin - lo) / pitch).astype(int) + 1
    grid = np.zeros(shape, dtype=bool)
    remaining = int(source.area / (pitch / 2.6) ** 2)
    while remaining > 0:
        batch = min(remaining, 3_000_000)
        points, _ = trimesh.sample.sample_surface(source, batch)
        index = ((points - lo) / pitch).astype(np.int32)
        grid[index[:, 0], index[:, 1], index[:, 2]] = True
        remaining -= batch

    solid = flood_fill(grid, seal)
    del grid
    if plug:
        # Flooding again seals the slivers of air left between the plug and the lobe wall.
        solid = flood_fill(plug_cavities(solid), seal)
    field = repaired_field(solid, lo, pitch, sigma, bad_points)
    del solid

    surface_v, surface_t, _, _ = measure.marching_cubes(field, 0.5, spacing=(pitch, pitch, pitch))
    surface_v = surface_v.astype(np.float64) + lo
    surface_t = surface_t[:, ::-1].astype(np.int32)
    raw = len(surface_t)
    surface_v, surface_t = largest_component(surface_v, surface_t)
    surface_v, surface_t = decimate(surface_v, surface_t, name, target_tris)
    print(f"  {name:18} solid  {raw:>8} -> {len(surface_t):>7} tris  ({time.time() - started:.1f}s)", flush=True)
    return surface_v, surface_t


def mirrored(verts, tris):
    return verts * np.array([-1.0, 1.0, 1.0]), tris[:, ::-1].copy()


def cut_from_shell(shell_v, shell_t, source_v, source_t, reach=0.0013):
    """The part of the shell lying on a source patch, as its own mesh."""
    source = trimesh.Trimesh(vertices=source_v, faces=source_t, process=False)
    points, _ = trimesh.sample.sample_surface(source, 250_000)
    distance, _ = cKDTree(points).query(shell_v, k=1, distance_upper_bound=reach * 2)
    inside = distance < reach
    tri_keep = inside[shell_t].all(axis=1)
    remap = np.full(len(shell_v), -1, dtype=np.int64)
    used = np.unique(shell_t[tri_keep])
    remap[used] = np.arange(len(used))
    return shell_v[used], remap[shell_t[tri_keep]].astype(np.int32)


def adjacency(n, tris):
    edges = np.vstack([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    edges = np.vstack([edges, edges[:, ::-1]])
    matrix = sp.coo_matrix((np.ones(len(edges)), (edges[:, 0], edges[:, 1])), shape=(n, n)).tocsr()
    matrix.data[:] = 1.0
    degree = np.asarray(matrix.sum(axis=1)).ravel()
    degree[degree == 0] = 1.0
    return sp.diags(1.0 / degree) @ matrix


def depth_term(verts, tris, normals, iterations, lam=0.7):
    """How far each vertex sits below a smoothed copy of the surface (sulci are negative)."""
    walk = adjacency(len(verts), tris)
    smoothed = verts.copy()
    for _ in range(iterations):
        smoothed = (1 - lam) * smoothed + lam * (walk @ smoothed)
    return np.einsum("ij,ij->i", verts - smoothed, normals)


def shading(verts, tris, normals):
    """Returns RGBA uint8. R: broad sulcal depth, G: fine creases, B: unused, A: 255."""
    def normalised(values):
        lo, hi = np.percentile(values, [4, 96])
        return np.clip((values - lo) / max(hi - lo, 1e-9), 0, 1)

    broad = normalised(depth_term(verts, tris, normals, 90))
    fine = normalised(depth_term(verts, tris, normals, 14))
    out = np.full((len(verts), 4), 255, dtype=np.uint8)
    out[:, 0] = (broad * 255).astype(np.uint8)
    out[:, 1] = (fine * 255).astype(np.uint8)
    return out


def side_names(suffix):
    names = []
    for name, obj in objects.items():
        if not name.endswith(suffix):
            continue
        if "Neo-cortex" in collections_of(obj) or name.startswith("White matter of telencephalon"):
            names.append(name)
    return names


cerebellum_names = [
    name for name, obj in objects.items()
    if collections_of(obj) & {"Cerebellum", "Superior cerebellar peduncle"} and not name.startswith("Base of peduncle")
]
brainstem_names = [
    name for name in objects
    if name.split(".")[0] in {
        "Pons", "Midbrain", "Medulla oblongata", "Olive", "Pyramid of medulla oblongata",
        "Base of peduncle", "Superior colliculus", "Inferior colliculus",
    }
]

SOLIDS = {
    "amygdala": "Amygdaloid body",
    "caudate": "Caudate nucleus",
    "putamen": "Putamen",
    "pallidum": "Globus pallidus",
    "thalamus": "Thalamus",
    "hippocampus": "Hippocampus",
}
PATCHES = {
    "dlpfc": ["Middle frontal gyrus"],
    "ofc": ["Orbital gyri", "Straight gyrus (Gyrus rectus)"],
    "acc": ["Cingulate gyrus and sulcus (Middle anterior part)"],
    "insula": ["Insula (Subcentral gyrus and ant. and post. sulci*)"],
}

for names in (*([s + ".l"] for s in SOLIDS.values()), *([n + ".l" for n in p] for p in PATCHES.values())):
    missing = [n for n in names if n not in objects]
    assert not missing, f"missing {missing}"

print("cortex sources:", len(side_names(".l")), "cerebellum:", len(cerebellum_names), "brainstem:", len(brainstem_names))

results = {}

# The atlas hemispheres are exact mirror images, so build the left and reflect it.
defective = [combined([name]) for name in ("Temporal pole.l", "Paracentral gyrus and sulcus*.l")]
bad_points = np.vstack([
    trimesh.sample.sample_surface(trimesh.Trimesh(vertices=v, faces=t, process=False), 60_000)[0]
    for v, t in defective
])
shell_v, shell_t = solid_surface(*combined(side_names(".l")), "cortex_l", 200_000, plug=True, bad_points=bad_points)
results["cortex_l"] = (shell_v, shell_t, "shell")
results["cortex_r"] = (*mirrored(shell_v, shell_t), "shell")

for node, sources in PATCHES.items():
    patch_v, patch_t = cut_from_shell(shell_v, shell_t, *combined([n + ".l" for n in sources]))
    print(f"  {node:18} patch  {len(patch_t):>7} tris", flush=True)
    results[f"{node}_l"] = (patch_v, patch_t, "patch")
    results[f"{node}_r"] = (*mirrored(patch_v, patch_t), "patch")

for node, source in SOLIDS.items():
    solid_v, solid_t = rebuild(*combined([source + ".l"]), f"{node}_l", 0.00028, 7_000)
    results[f"{node}_l"] = (solid_v, solid_t, "solid")
    results[f"{node}_r"] = (*mirrored(solid_v, solid_t), "solid")

results["cerebellum"] = (*solid_surface(*combined(cerebellum_names), "cerebellum", 60_000), "shell")
stem_v, stem_t = combined(brainstem_names, mirror={"Medulla oblongata.l"})
results["brainstem"] = (*solid_surface(stem_v, stem_t, "brainstem", 20_000), "shell")
results["corpus_callosum"] = (*rebuild(*combined(["Corpus callosum"]), "corpus_callosum", 0.00034, 7_000), "solid")

all_verts = np.vstack([v for v, _, _ in results.values()])
lo, hi = all_verts.min(axis=0), all_verts.max(axis=0)
centre = (lo + hi) / 2
centre[0] = 0.0  # keep the anatomical midline at exactly x = 0
SCALE = 20.0
print("source bounds (m)", lo.round(4), hi.round(4))


def to_web(verts):
    shifted = (verts - centre) * SCALE
    return np.column_stack([shifted[:, 0], shifted[:, 2], -shifted[:, 1]])


scene = trimesh.Scene()
total = 0
for node, (verts, tris, kind) in results.items():
    mesh = trimesh.Trimesh(vertices=to_web(verts), faces=tris, process=False)
    if kind != "patch":
        trimesh.repair.fix_normals(mesh, multibody=False)
    normals = np.asarray(mesh.vertex_normals)
    colours = shading(mesh.vertices, mesh.faces, normals)
    mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, vertex_colors=colours)
    mesh.metadata["name"] = node
    scene.add_geometry(mesh, node_name=node, geom_name=node)
    total += len(mesh.faces)

scene.export(dst, file_type="glb", include_normals=True)
print("wrote", dst, "triangles", total)
