# WebGL2 live preview (`fw-webgl2-preview-v1`)

FW-006 adds FIELDWEAVER's first live artwork view. The preview is intentionally **noncanonical**: canonical simulation/deposition state is produced by `src/sim/`, while `src/renderer/` consumes that state read-only and may use ordinary browser/WebGL floating point for display.

## Boundary and truth model

The renderer receives canonical deposition records, emitter definitions, and optional field-layer metadata. It never owns or mutates simulation state. The browser demo records the simulation `resultHash()` before rendering and verifies it is unchanged after every preview frame.

The WebGL framebuffer is never read by simulation code. Frame timing, resize/DPR, pan/zoom, GPU vendor, and preview truncation are diagnostics/view concerns only. Future canonical image export remains a separate software-raster path.

## Viewport

`createViewport()` defines:

- CSS width/height;
- device-pixel ratio;
- view-only zoom;
- chunk-aware canonical world position used only as the camera centre.

`worldToCanvas()` / `worldToClip()` derive display coordinates relative to the view centre. `panViewport()` and `zoomViewport()` return new view objects and never alter field, emitter, agent, deposition, or recipe data.

The WebGL canvas backing dimensions are `CSS size × DPR`; viewport transforms continue to use CSS dimensions so changing DPR improves raster resolution without changing the visible world framing. Node tests explicitly verify that changing DPR does not change canonical data or CSS-space world framing.

## Material display treatment

The four FW-005 material behaviours remain canonical in the simulation and receive deliberately distinct preview treatment:

| Material | Canonical deposition | Preview treatment |
|---|---|---|
| Ink | disc | warm orange translucent discs |
| Filament | segment | cyan connected lines |
| Dust | point | small yellow translucent points |
| Shard | segment | high-contrast violet segments |

These colours/sizes are view styling only and are not persisted as canonical material meaning.

## Overlays

Emitter origins and enabled field origins are prepared separately from artwork geometry. The WebGL renderer draws them in additional overlay calls only when `showOverlays` is true. They are therefore separable from the deposition artwork path and can be disabled without changing canonical or preview accumulation state.

## Preview accumulation, reset, and replay

`PreviewAccumulator` is an explicit bounded ring with a default capacity of 100,000 deposition records and a hard configurable maximum of 1,000,000.

- Appending beyond capacity drops the oldest preview-only record and increments a diagnostic counter.
- `reset()` removes every retained record.
- `rebuild(records)` clears first, then reconstructs the bounded preview window from the supplied canonical record sequence.
- If the canonical deposition array becomes shorter than the number already consumed (for example after deterministic reset/replay), `WebGL2PreviewRenderer` automatically rebuilds instead of retaining stale GPU-era history.
- Every frame clears the framebuffer and redraws from the bounded retained record window; no hidden framebuffer accumulation is simulation truth.

Preview truncation is surfaced in diagnostics as `previewTruncated` / `previewDropped`.

## Failure handling

If `canvas.getContext('webgl2')` fails, `RendererUnavailableError` contains an actionable message. The application displays it in the workspace rather than attempting a fake renderer or modifying canonical state. WebGL context loss is likewise reported as a preview failure; canonical simulation data remains untouched.

## Diagnostics

Each successful render exposes:

- total frame, CPU preparation, and WebGL submission time estimates;
- draw-call count;
- artwork and overlay vertex counts;
- transient vertex-buffer bytes;
- bounded preview count/capacity/drop state;
- CSS viewport, DPR, framebuffer dimensions, and zoom;
- reported WebGL renderer/vendor strings.

Timing values are diagnostic only and never participate in canonical logic or CI pass/fail thresholds.

## 1080p / 30k preparation profile

`npm run benchmark:render` is the reproducible FW-006 CPU-side profile. It creates 30,000 representative Ink/Filament/Dust/Shard deposition records, prepares their line/point batches for a `1920×1080 @ 1× DPR` viewport, performs four warm-ups followed by twelve measured rounds, and prints median/p95/min/max preparation time plus generated vertex and buffer counts.

CI runs this command on the Node 22 matrix job after correctness tests. The benchmark is deliberately **informational**: machine timing is printed to the Actions log but no threshold can weaken or redefine correctness. Actual GPU submission/frame cost is measured by the in-app renderer diagnostics on the browser/hardware under test.

## Representative browser demo

Until FW-007 adds the editing instrument, app startup creates a fixed seeded four-material FW-005 scenario, runs it to tick 220, and renders its canonical deposition records. The view supports pointer drag to pan and mouse-wheel/trackpad zoom. Field/emitter overlays remain visible so the relationship between simulation sources and deposits can be inspected.

## Automated browser acceptance gate

`scripts/browser-smoke.mjs` drives the application through the W3C WebDriver protocol without adding a JavaScript browser-testing dependency. CI executes it independently in Chrome/Chromium and Firefox on the hosted Ubuntu runner. The smoke gate requires all of the following from an actual browser WebGL2 context:

- the renderer reaches the explicit `ready` state;
- `canvas.getContext('webgl2')` succeeds, the context is not lost, and `gl.getError()` is clean;
- the four-material legend is present and renderer diagnostics report multiple submitted artwork/overlay draw calls;
- pointer pan and wheel zoom change view diagnostics without tripping the application's canonical-result-hash guard;
- a browser-window resize changes the framebuffer dimensions while rendering remains healthy;
- a real browser screenshot is produced and validated as nontrivial PNG data;
- browser version, platform, WebGL/GLSL versions, renderer/vendor, framebuffer and screenshot size are emitted to the CI log.

The screenshot and local-server log are uploaded as short-lived CI evidence. This proves the supported browser paths in the exact CI environment actually exercised; it does not claim cross-machine pixel identity or turn the WebGL screenshot into a canonical image oracle.

## Manual browser smoke procedure

For additional desktop/hardware coverage, use a current desktop Chromium and Firefox:

1. `npm run serve` and open the printed localhost URL.
2. Confirm all four legend colours and visibly different point/line/trail structures appear in the preview.
3. Drag to pan and wheel to zoom; verify the canonical hash guard does not stop the preview.
4. Resize the window and, if available, move between monitors with different DPR; the canvas should remain sharp and preserve framing semantics.
5. Confirm field/emitter overlay markers are visible and visually separate from deposited artwork.
6. Open diagnostics and confirm draw calls, timings, vertex/buffer counts, preview window, framebuffer size, renderer/vendor, and zoom update.
7. Open developer tools and confirm there are no console errors or external-resource failures.
8. Disable WebGL2 (or exercise a browser/profile where it is unavailable) and confirm the actionable renderer-unavailable message appears while the app shell/canonical state remain intact.

Manual runs must record browser version, OS/GPU and outcome before being used as evidence. Automated CI evidence is environment-specific and should likewise be reported with its observed browser/renderer metadata rather than generalized into universal hardware support claims.
