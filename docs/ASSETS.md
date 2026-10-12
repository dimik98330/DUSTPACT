# Assets and credits

The project retains its source rights as stated in [`COPYRIGHT`](../COPYRIGHT). That notice does not replace the original licenses of third-party assets or dependencies.

## Characters

The four rigged characters are derived from **KayKit: Adventurers Character Pack 1.0**, created by **Kay Lousberg**:

- Pinned upstream source: [commit 672074b73ba276876a19e8816ecdc5241817ab47](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/tree/672074b73ba276876a19e8816ecdc5241817ab47).
- Original license shipped with the assets: [`apps/web/public/models/characters/LICENSE.txt`](../apps/web/public/models/characters/LICENSE.txt), **Creative Commons Zero (CC0)**.
- Runtime models: Rogue_Hooded, Knight, Mage and Barbarian, processed into `*-game.glb` files in that directory.

Local Blender processing removed weapon attachments and retained eight animation clips: Idle, Walking_A, Running_A, Interact, PickUp, Cheer, Sit_Floor_Idle and Blocking. Each rig has 41 bones. The game uses locomotion/interaction animations. These are adapted KayKit assets, not character art authored entirely by DUSTPACT.

## World and artwork

- The caravan model, [`caravan.glb`](../apps/web/public/models/caravan.glb), was authored for DUSTPACT with Blender. Terrain, camp, spring, gateway and settlement silhouettes are procedural runtime geometry in the game's Three.js world.
- [`dustroad.png`](../apps/web/public/art/dustroad.png) is a retained generated panorama from an earlier presentation. It is not the background geometry of the current 3D world. The retained provenance record identifies it as generated artwork but does not establish an external artist or a separate third-party asset license.
- The README cover in [`docs/media/dustpact-cover.svg`](media/dustpact-cover.svg) was authored for this repository. The PNGs in `docs/media` are captures of the actual product UI; they illustrate local/generated-actor scenarios, not external-wallet or human-playtest evidence.

Blender **4.5.9 LTS** was used for the asset processing. Design references informed visual direction; no proprietary reference-game artwork, models or code are included.

## Fonts, icons and dependencies

| Resource     | License               | Delivery                                                 |
| ------------ | --------------------- | -------------------------------------------------------- |
| Manrope      | SIL Open Font License | `@fontsource/manrope`, locally bundled by the web build  |
| Literata     | SIL Open Font License | `@fontsource/literata`, locally bundled by the web build |
| Lucide icons | ISC                   | `lucide-react`                                           |
| Three.js     | MIT                   | `three`                                                  |
| React        | MIT                   | `react`, `react-dom`                                     |

Exact package versions are recorded in `package-lock.json`. Dependency license notices remain in their installed packages and apply independently of DUSTPACT's own source-rights notice. The table lists the principal visual resources, not every transitive dependency.

README badges are externally served by Shields.io. The game screenshots and cover are stored in the repository.
