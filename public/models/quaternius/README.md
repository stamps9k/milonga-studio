# Quaternius character models

The 3D view's "Character" figures. Both are from **Universal Base
Characters** by Quaternius (August 2025 release, Standard version):
https://quaternius.com/packs/universalbasecharacters.html, downloaded
from https://quaternius.itch.io/universal-base-characters on 2026-11-17.

Licence: **CC0 1.0 Universal** (public domain dedication), as stated on
the pack's itch.io page. No attribution is required, but the models are
Quaternius's work and are credited here.

| File                   | From the pack                                               | Used for   |
| ---------------------- | ----------------------------------------------------------- | ---------- |
| `superhero_male.glb`   | `Base Characters/Godot - UE/Superhero_Male_FullBody.gltf`   | the lead   |
| `superhero_female.glb` | `Base Characters/Godot - UE/Superhero_Female_FullBody.gltf` | the follow |

Changes from the originals, to keep the repository small (each file is
about 1.3 MB instead of about 20 MB):

- every texture scaled down from 2048 to 1024 pixels, colour, normal and
  roughness maps saved as JPEG (quality 90), the eye texture as PNG;
- two texture references in the originals point at files the pack names
  differently (`T_Hair_1_Normal_png.png`, `T_Eye_Normal_png.png`); the
  matching files were used;
- packed into single `.glb` files with unused data removed
  (`gltf-transform prune`).

The meshes and rigs are unchanged. The rigs use Unreal-style bone names
(`pelvis`, `thigh_l`, `calf_l`, `foot_l`, ...), which
`src/libs/render/character.mts` relies on.

These are stand-ins for trying out the character view: the free version
of the pack only has the "Superhero" bodies. Better-suited characters
(normal proportions, clothes) can replace these files; any rig with the
same bone names works without code changes.
