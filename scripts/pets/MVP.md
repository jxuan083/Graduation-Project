# Pet presentation MVPs

Open `http://127.0.0.1:5178/pet-lab.html` while serving `frontend/`:

```sh
python3 -m http.server 5178 --bind 127.0.0.1 --directory frontend
```

This is a separate comparison page. It does not replace the production pet,
call the care API, change pet stats, or implement a draw/purchase system.
The earlier Autumn and puppy 3D drafts were rejected visually and are not
accepted character art. The lab explores two different presentation pipelines.

## What actually runs

1. **Rive**: `companion.riv`, authored as RML and built using official Rive CLI
   1.6.0, played with vendored `@rive-app/canvas` 2.45.0. It contains native
   vector geometry, 3 timelines, 1 state machine, 3 animation states and 6
   data-driven transitions. No embedded scripts, account, signing or MCP is used.
   `action`, `cat`, `dog`, and `shirtColor` are real view-model properties.
2. **Pre-rendered 3D**: a new Blender costume character rendered into transparent
   320×320 PNG frames. `frames.json` maps equipment/action IDs to sequences.
   No Three.js, glTF, realtime lights or 3D engine runs in this renderer.
   The MVP renders 2 characters × 2 clothes × 3 actions × 24 frames, 12 fps.

Each includes feeding (button or successful drag to mouth), petting, toy play,
action feedback, loading/error states and reduced motion. There is deliberately
no facial deformation: a user photo is a separate elliptical image layer,
uniformly scaled and cropped with adjustable position. Photo data stays in
memory via blob URLs, never uploads or persists, and is revoked on removal/exit.
Default artwork uses a drawn demonstration face, not a real user's photo.
The head remains frontal and fixed in both pipelines to keep photo registration
and identity intact. Body, arms, ears and tail carry the animated response.
This is a pipeline/interaction MVP; final character art and realistic facial
chewing are not supplied.

## Characters, clothes and toys

`frontend/features/pets/mvp/catalog.js` defines stable, independent item IDs:
`dog` / `cat`, `sage` / `rose`, `ball` / `bone`. The two characters are costume
variants sharing `companion-v1`; they are not two independently designed final
characters. Clothes currently demonstrate two colors of the same garment.
Toys have separate visuals; both reuse the play gesture in this MVP.
The preview grants all six items and stores only equipment IDs and the preferred
pipeline in localStorage. This is not an inventory or entitlement check.

A future draw result should grant item IDs server-side; an inventory should
track owned IDs separately from selected equipment. Server validation must
check ownership and rig compatibility before equipping. Rive can swap parts
without exporting every outfit combination; the current pre-rendered pipeline
has a combination cost. Additional outfits and accessories require authored art,
attachment points, masks and draw order; a stable ID alone does not supply these.
Do not copy client-side preview selection into a paid inventory authority.

## Rebuild

```sh
python3 scripts/pets/build_rive_mvp.py
~/.rive/bin/rive scripts/pets/rive-mvp --verify
~/.rive/bin/rive inspect scripts/pets/rive-mvp --summary
~/.rive/bin/rive scripts/pets/rive-mvp --once
cp scripts/pets/rive-mvp/build/rive-mvp.riv frontend/assets/pets/mvp/companion.riv
blender -b --python scripts/pets/build_prerender_mvp.py -- --all
```

A Blender run without `--all` creates one frame and a draft manifest for visual
checking; run `--all` before serving/committing the finished lab.
Rive's generated AGENTS.md assumes scripted projects cannot be previewed on the
web. This lab is intentionally script-free, and the user explicitly requested a
comparison page. The official CLI docs confirm unsigned files without scripts
can play in web runtimes: https://rive.app/docs/cli/getting-started

## Validation

Run `npm test`, syntax checks on the lab modules, and Rive verify/inspect.
A development-only Playwright run passed 13 groups of checks (2026-10-19): it checks the served page and screenshots on
desktop/mobile, loads both actual renderers, switches every equipment type,
plays actions repeatedly, drops food inside/outside the target, checks photo
sharing/removal and reduced motion, and asserts no page errors or external
network requests. No browser automation dependency is added to the app.
The existing 40 JavaScript tests passed. Rive verify/inspect reported no errors or warnings.
The photo test used an obvious drawn crop fixture, not a real person: no identity-quality
claim has been made from that test. Real-phone performance and final art preference
still require the user's selection.
