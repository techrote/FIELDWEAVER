# Development and local runtime

FIELDWEAVER intentionally has no runtime or development dependencies beyond Node.js. FW-001 established the local browser/tooling substrate; FW-002–FW-005 added the DOM-free deterministic canonical simulation substrate; FW-006 adds a read-only WebGL2 preview; FW-016 fixes its view-interaction scaling without changing that dependency policy.

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
npm run benchmark:render  # ~64k-deposition cached interaction profile
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
2. Open the printed localhost URL in current Chromium and Firefox.
3. Confirm the FIELDWEAVER header, WebGL2 deposition preview, subsystem status, material legend, and diagnostics appear.
4. Confirm all four material behaviours are visible.
5. Note **Geometry cache** after startup; the initial artwork build should have occurred once.
6. Drag continuously and generate several wheel/trackpad events. The viewport must update while geometry diagnostics switch to **reused**, rebuild count remains unchanged, and view-only frames do not upload the multi-megabyte artwork buffer again.
7. Resize the window and, where possible, change monitor/DPR. The framebuffer must update without rebuilding unchanged artwork geometry.
8. Confirm field/emitter overlay markers remain visible and separable from deposited artwork.
9. Open developer tools and confirm there are no console errors or failed external network requests.
10. Toggle browser offline mode after the initial local page load. The app should continue to operate because it has no external service dependency.
11. Activate **Refresh diagnostics** with keyboard focus and confirm it remains responsive after repeated drag interaction.
12. Exercise WebGL2-unavailable failure handling if practical and confirm an actionable message appears while canonical state remains intact.

Record browser version, OS/GPU, deposition count, cache rebuild count, prepare/submit timing and outcome before using a manual run as acceptance evidence.

## Deterministic and renderer checks

`npm test` executes canonical numeric/coordinate/PRNG/field/operator/simulation golden fixtures under Node with no DOM/GPU APIs. Renderer tests cover viewport transforms, bounded accumulation/reset/rebuild, stable geometry-cache identity across pan/zoom/resize, material batch preparation, representative four-material input, WebGL2-unavailable failure handling, canonical hash isolation, and the RAF-coalesced browser interaction contract.

`npm run benchmark:render` models approximately the real FW-016 regression scale (63,726 depositions). It builds artwork once and then performs repeated view transforms while asserting geometry rebuild count remains one. Timing is diagnostic; structural reuse is the correctness oracle. Chrome/Firefox CI additionally inject a burst of pointer/wheel input and require geometry-cache reuse plus RAF coalescing.

See `docs/RENDERER.md` for the full renderer/cache contract and profiling rationale.

## Subsystem boundary

`src/core/`, `src/fields/`, and `src/sim/` remain DOM/GPU-free and importable by Node tests. `src/renderer/prepare.js` is also DOM/GPU-free so transform/cache logic is headlessly testable. Only `src/renderer/webgl2.js`, the browser app, and UI shell touch WebGL/DOM APIs.

Rendering is a consumer of canonical deposition/model state, never a source of simulation truth. The WebGL framebuffer, view transforms, cache state and timing values are explicitly noncanonical.
