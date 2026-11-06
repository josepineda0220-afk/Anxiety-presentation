# 3D brain model license

`brain.glb` is derived from the **Z-Anatomy** atlas by Gauthier Kervyn and Marcin Zielinski
(https://github.com/Z-Anatomy/Models-of-human-anatomy), which is itself based on **BodyParts3D**
(The Database Center for Life Science, https://lifesciencedb.jp/bp3d/).

Licensed under [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).

Changes made for this project: selected the brain structures only, merged each cerebral
hemisphere into a single remeshed surface, rebuilt low-polygon structures, reduced polygon
counts, added baked shading data in vertex colors, and converted the result to glTF.
The scripts that do this are in `tools/`.

Any redistribution of this model must keep this attribution and the same license.
