"""Step 1 of the brain pipeline: pull only the brain out of the full-body Z-Anatomy atlas.

Reads the 300 MB Startup.blend, applies modifiers, bakes world transforms, and saves a small
clean .blend holding just the brain meshes, so later steps open in seconds.

Usage:
  uv run --no-project --python 3.13 --with bpy python -I tools/extract_brain.py <Startup.blend> <brain_only.blend>

Scripts embedded in the source file are never executed (use_scripts=False).
"""
import sys
import bpy
import numpy as np

src, dst = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=src, use_scripts=False, load_ui=False)


def meshes_in(col):
    found = {o for o in col.objects if o.type == "MESH"}
    for child in col.children:
        found |= meshes_in(child)
    return found


wanted = meshes_in(bpy.data.collections["Brain"])
depsgraph = bpy.context.evaluated_depsgraph_get()

records = []
for obj in sorted(wanted, key=lambda o: o.name):
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated)
    if len(mesh.polygons) == 0:
        bpy.data.meshes.remove(mesh)
        continue
    mesh.transform(obj.matrix_world)
    mesh.calc_loop_triangles()
    verts = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", verts)
    tris = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int32)
    mesh.loop_triangles.foreach_get("vertices", tris)
    collections = sorted(c.name for c in obj.users_collection)
    records.append((obj.name, verts.reshape(-1, 3), tris.reshape(-1, 3), collections))
    bpy.data.meshes.remove(mesh)

print("extracted", len(records), "meshes,", sum(len(r[2]) for r in records), "triangles")

bpy.ops.wm.read_factory_settings(use_empty=True)
for name, verts, tris, collections in records:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts.tolist(), [], tris.tolist())
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj["source_collections"] = ";".join(collections)
    bpy.context.scene.collection.objects.link(obj)

bpy.ops.wm.save_as_mainfile(filepath=dst, compress=True)
print("saved", dst)
