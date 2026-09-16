# Development and local runtime

FIELDWEAVER intentionally has no runtime or development dependencies beyond Node.js. FW-001 established the local browser/tooling substrate; FW-002–FW-005 established deterministic fields/simulation; FW-006/FW-016 provide the cached read-only WebGL2 preview; FW-007 adds the dependency-light editor without changing that policy.

## Supported runtime

- Node.js 22 or 24 for local tooling and CI.
- Current desktop Chromium or Firefox for the browser application.
- WebGL2 for the live preview. Failure is reported without replacing canonical state.

The browser application is native HTML/CSS/ES modules. It has no package CDN, cloud API, telemetry endpoint, framework, or other required external service.

## Commands

```text
npm run check             # syntax/static policy checks
npm test                  # Node built-in deterministic/editor tests
npm run verify            # check + test
npm run benchmark:sim     # canonical simulation diagnostic benchmark
npm run benchmark:render  # ~64k-deposition cached interaction profile
npm run serve             # http://127.0.0.1:4173
npm start                 # serve and attempt to open the browser
```

`npm ci` is intentionally uneventful today because there are no package dependencies; CI still runs it so the lockfile remains authoritative.

## Launch helpers

- Windows: run `0Play.cmd`.
- POSIX: run `sh ./0Play.sh`.

Both use the Node standard-library static server and normal localhost browser security; neither relies on `file://` or weakens browser security.

## Browser/editor smoke check

Before claiming a browser-facing issue complete, run the following in current Chromium and Firefox:

1. Launch the app and confirm renderer **and editor** reach ready state with no console errors.
2. Confirm field stack, brush, emitter, material, seed, transport, diagnostics and keyboard-focus controls are present and labelled.
3. Add a field, paint a stroke, undo it and redo it. The editor overlay and authoring identity must follow the deterministic model state.
4. Disable/reorder a field and verify undo/redo.
5. Place/move an emitter on canvas, assign a material, edit rate and material controls.
6. Single-step exactly once; set a multi-step count and confirm exact advancement; run/pause; change speed; reset to tick 0.
7. Confirm authoring edits reset simulation while pan/zoom/run do not mutate the authored recipe identity.
8. Switch back to Pan and repeat the FW-016 interaction burst: stable artwork geometry must remain cached and pointer/wheel renders must stay RAF-coalesced.
9. Resize the window and, where possible, change monitor/DPR; framebuffer dimensions must update without rebuilding unchanged artwork geometry.
10. Toggle offline mode after initial localhost load; no external service/resource failure should appear.
11. Induce load if practical and confirm scheduler backlog is visible rather than silently converted into different simulation semantics.
12. Exercise WebGL2-unavailable handling if practical; the editor shell/model must remain intelligible while preview failure is actionable.

Record browser version, OS/GPU, outcome, and any limitation before using a manual run as evidence. CI performs a WebDriver subset of the editor workflow plus the renderer cache regression in both Chrome and Firefox.

## Deterministic, editor and renderer checks

`npm test` runs canonical numeric/coordinate/PRNG/field/operator/simulation golden fixtures plus DOM-free `EditorSession` tests. Editor tests cover painted-field influence, undo/redo, layer enable/order, emitter/material editing, concrete seed identity, exact stepping and replay invariance across UI speed settings.

`npm run benchmark:render` models the real FW-016 scale (63,726 depositions): artwork builds once, then repeated view transforms must leave rebuild count at one. Timing remains diagnostic; structural cache reuse is the correctness oracle.

See `docs/EDITOR.md` for editor/transport/keyboard semantics and `docs/RENDERER.md` for the preview/cache boundary.

## Subsystem boundary

`src/core/`, `src/fields/`, `src/sim/`, and `src/editor/model.js` remain DOM/GPU-free and Node-testable. `src/renderer/prepare.js` is likewise DOM/GPU-free. Only the browser app, UI shell and WebGL renderer touch DOM/WebGL APIs.

Canonical simulation advances only through explicit integer ticks. Browser elapsed time may decide how many ticks the editor scheduler requests, but elapsed time, frame cadence, renderer state, viewport, overlay, GPU buffers and scheduler debt never enter canonical state transitions.
