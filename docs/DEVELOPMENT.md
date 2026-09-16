# Development and local runtime

FIELDWEAVER intentionally has no runtime or development dependencies beyond Node.js. FW-001 established the local browser/tooling substrate; FW-002–FW-005 added the DOM-free deterministic canonical simulation substrate; FW-006 adds a read-only WebGL2 preview without changing that dependency policy.

## Supported runtime

- Node.js 22 or 24 for local tooling and CI.
- Current desktop Chromium or Firefox for the browser application.
- WebGL2 for the live preview. If WebGL2 is unavailable, the app reports that limitation without corrupting or replacing canonical state.

The browser application is native HTML/CSS/ES modules. It does not require a framework, package CDN, cloud API, telemetry endpoint, or other external service.

## Commands

From the repository root:

```text
npm run check             # syntax/static policy checks
npm test                  # Node built-in test runner
npm run verify            # check + test
npm run benchmark:sim     # canonical simulation diagnostic benchmark
npm run benchmark:render  # 30k-deposition 1080p renderer preparation profile
npm run serve             # http://127.0.0.1:4173 without opening a browser
npm start                 # serve and attempt to open the browser
```

There are currently no package dependencies, but `npm ci` is safe and is what CI runs so the lockfile remains authoritative if tooling dependencies are ever justified later.

## Launch helpers

- Windows: double-click or run `0Play.cmd`.
- POSIX: run `sh ./0Play.sh` (or mark it executable locally and run `./0Play.sh`).

Both launch helpers start the Node standard-library static server and attempt to open the local URL. They do not disable browser security and do not use `file://` module loading.

## Browser smoke check

Before claiming a browser-facing issue complete:

1. Start with `npm run serve`.
2. Open the printed localhost URL in a current Chromium browser and Firefox.
3. Confirm the FIELDWEAVER header, WebGL2 deposition preview, subsystem status, material legend, and diagnostics appear.
4. Confirm the seeded demo visibly contains all four FW-005 material behaviours: orange Ink discs, cyan Filament segments, yellow Dust points, and violet Shard segments.
5. Drag the canvas to pan, use the wheel/trackpad to zoom, resize the window, and confirm preview diagnostics update without the canonical hash guard stopping rendering.
6. Confirm field/emitter overlay markers are visible and separable from deposited artwork.
7. Open developer tools and confirm there are no console errors or failed external network requests.
8. Toggle browser offline mode after the initial local page load. The app should continue to operate because it has no external service dependency. Reloading still requires the local static server because native ES modules are served over localhost by design.
9. Activate **Refresh diagnostics** with keyboard focus and confirm status refresh does not mutate canonical model state.
10. Exercise WebGL2-unavailable failure handling if practical and confirm an actionable message appears while the rest of the application remains intact.

Record the browser version, OS/GPU, outcome, and any limitation before using that run as acceptance evidence. Headless Node tests are not a substitute for a real browser/GPU smoke run.

## Deterministic and renderer checks

`npm test` executes the canonical numeric/coordinate/PRNG/field/operator/simulation golden fixtures under Node with no DOM/GPU APIs. Renderer tests additionally cover viewport transforms, bounded accumulation/reset/rebuild, material batch preparation, field/emitter overlay preparation, representative four-material input, WebGL2-unavailable failure handling, and the invariant that preparation cannot alter simulation/deposition hashes.

`npm run benchmark:render` profiles only CPU-side preparation. It has no pass/fail timing threshold. The live browser diagnostics expose actual preparation/submission/frame estimates, buffer counts, preview capacity, viewport/DPR, and WebGL renderer information. See `docs/RENDERER.md` for the renderer contract and profiling procedure.

## Subsystem boundary

`src/core/`, `src/fields/`, and `src/sim/` remain DOM/GPU-free and importable by Node tests. `src/renderer/prepare.js` is also DOM/GPU-free so transform/buffer logic is headlessly testable. Only `src/renderer/webgl2.js`, the browser app, and UI shell touch WebGL/DOM APIs.

Rendering is a consumer of canonical deposition/model state, never a source of simulation truth. The WebGL framebuffer and timing values are explicitly noncanonical.
