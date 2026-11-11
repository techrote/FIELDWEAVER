# FIELDWEAVER exhibition workbench

This is a noncanonical *selection UI* over immutable accepted recipes, with an explicit canonical CPU preview/export action. It does not register new recipes, extend the simulation model, or change the renderer's source of truth.

## User workflow

1. Launch FIELDWEAVER normally. The sidebar **Exhibition · accepted presets** panel exposes the four FW-014 release presets in a two-column grid. Select with mouse, Tab/Enter/Space, the native selector, or Previous/Next. Selection only updates descriptive metadata; it never replaces in-progress work.
2. Inspect the exact source recipe hash, unsigned root seed, target tick, fixed crop and lineage parent (where present). These values come from the accepted preset catalog, not from live editor state.
3. Choose **Render canonical proof**. The panel calls the existing `createCanonicalExport` CPU replay/software raster at the accepted tick and crop (96×64 pixels for the current built-ins), with explicit capacities 4096 agents and 250,000 deposition records and 32×32 raster tiles. No WebGL screenshot, Canvas2D sampling, stock thumbnail, external service, or noncanonical proxy is involved. The generated PNG and raw RGBA hash are only shown after replay completes.
4. Download **proof PNG** and **provenance** for a genuine, reproducible pair. The provenance includes the complete normalized recipe, seed, replay hashes, tick, crop, lineage and canonical decoded RGBA8 hash. PNG byte identity is not the canonical oracle.
5. Select **Load preset** to transactionally adopt the accepted recipe into the editor. This is the only gallery action that replaces live work. It also copies the accepted crop and target tick into the existing **Canonical export** controls where available. Run that existing export panel to reproduce the larger workflow.
6. Switching entries immediately invalidates any prepared gallery proof and disables the prior PNG/provenance download buttons; no previous image may be presented as the new entry's export.

## Scope and integrity

The gallery currently enumerates **only the four immutable built-in release presets**. New original or mutated artwork must not be advertised as accepted merely because an unmerged gallery branch exists; Integration must review its recipe, licensing/provenance, deterministic replay and admission first. Catalog expansion is a separate guarded deliverable.

`src/ui/exhibition-catalog.js` is a read-only adapter over `src/presets/catalog.js`. The authoritative export remains `src/export/package.js` and `docs/EXPORT.md`; the 96×64 accepted raster results are locked by `fixtures/fw-014-presets.json`. `tests/exhibition.test.mjs` verifies navigation, recipe immutability, exact golden software-raster hashes, PNG decode equality and provenance. The release browser smoke exercises real DOM selection/rendering and ensures stale proofs are invalidated.

**Accessibility:** native buttons/select, visible focus outlines, aria-pressed single selection, described selection metadata, and live status; no auto-playing animation or network activity.

**Limitations:** proof generation runs on the main thread after one animation frame so it is synchronous canonical replay, not a continuously updating live thumbnail. The small 96×64 raster is a validation preview; users can increase output resolution through canonical export, but changing the crop or scale produces a different canonical pixel hash. No gallery screenshot or aesthetics claim is made without browser rendering evidence.
