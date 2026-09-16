# WebGL2 live preview (`fw-webgl2-preview-v1`)

FW-006 adds FIELDWEAVER's first live artwork view. FW-016 hardens its interaction path after real-hardware profiling exposed an O(preview-history) pan/zoom regression. The preview is intentionally **noncanonical**: canonical simulation/deposition state is produced by `src/sim/`, while `src/renderer/` consumes that state read-only and may use ordinary browser/WebGL floating point for display.

## Boundary and truth model

The renderer receives canonical deposition records, emitter definitions, and optional field-layer metadata. It never owns or mutates simulation state. The fixed startup demo computes its canonical `resultHash()` once, publishes that identity for browser acceptance evidence, and passes the renderer a frozen preview-only copy of the deposition-reference array. It deliberately does **not** recompute the complete canonical result hash on every camera event: at tens of thousands of depositions that guard itself was an O(N) main-thread stall. Canonical non-mutation is enforced by model boundaries plus deterministic/unit/browser tests.

The WebGL framebuffer is never read by simulation code. Frame timing, resize/DPR, pan/zoom, GPU vendor, geometry-cache state and preview truncation are diagnostics/view concerns only. Future canonical image export remains a separate software-raster path.

## Viewport and cached camera transform

`createViewport()` defines CSS width/height, device-pixel ratio, view-only zoom, and a chunk-aware world position used only as the camera centre. `worldToCanvas()` / `worldToClip()` provide direct reference transforms for tests and one-time preparation.

Artwork geometry is prepared against a **reference viewport** only when the bounded deposition-window revision changes. `createViewportTransform(reference, current)` derives an affine clip-space scale/offset and point-size scale. Pan, zoom and resize update shader uniforms instead of traversing and reprojecting every deposition record on the CPU.

The WebGL canvas backing dimensions are `CSS size × DPR`. DPR changes improve raster resolution without changing canonical world state. View-only transforms never invalidate stable artwork geometry.

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

Emitter origins and enabled field origins are tiny, separate overlay batches. They are prepared against the current viewport and uploaded independently of cached artwork. They can be disabled without changing canonical state or preview accumulation.

## Preview accumulation, geometry caching, reset, and replay

`PreviewAccumulator` is an explicit bounded ring with a default capacity of 100,000 deposition records and hard configurable maximum of 1,000,000. It owns a monotonic preview-only `revision` which changes only when retained deposition content changes.

`PreviewGeometryCache` keys the expensive prepared artwork to that revision:

- appending/replacing/resetting/replaying deposition history advances the revision and requires a geometry rebuild;
- pan, zoom, DPR and framebuffer resize leave the revision unchanged and therefore reuse the same prepared artwork arrays and GPU buffers;
- stable artwork buffers use `STATIC_DRAW` and are uploaded only on geometry rebuild;
- tiny overlays remain independently dynamic;
- `reset()` and `rebuild(records)` invalidate cached artwork before the next render, preventing stale trails;
- if canonical deposition history becomes shorter or its previously consumed tail identity changes, the renderer rebuilds from the supplied bounded history.

The framebuffer is still cleared and redrawn each frame, but ordinary camera interaction submits already-resident GPU geometry using new transform uniforms rather than rebuilding/reuploading the artwork.

## Input scheduling

Pointer movement, wheel zoom and window resize all call one animation-frame scheduler. Multiple input events received before the next frame collapse into one render execution. This prevents a slow frame from creating an ever-growing synchronous pointer-event/render backlog.

The app publishes diagnostic-only render request/execution counters in document data attributes so Chrome/Firefox acceptance tests can prove a burst of input requests is actually coalesced.

## FW-016 regression evidence

The fix was prompted by a real Firefox/ANGLE/NVIDIA GTX 980-class desktop run with approximately 63,726 retained depositions and 101,532 artwork vertices. Before FW-016, diagnostics reported roughly 483–551 ms of CPU preparation but only 1–2 ms of WebGL submission per view render. Repeated drags became substantially worse because every pointer event also triggered a complete canonical result hash outside renderer timing.

The root causes were therefore CPU architecture, not GPU throughput:

1. full accumulator snapshot on every view render;
2. complete deposition validation/normalization/reprojection on every pan/zoom;
3. multi-megabyte artwork-buffer upload on every frame;
4. synchronous render per pointer event;
5. complete canonical result serialization/hash per render in the demo guard.

FW-016 removes all five from the normal view-only path.

## Failure handling

If `canvas.getContext('webgl2')` fails, `RendererUnavailableError` contains an actionable message. The application displays it rather than attempting a fake renderer or modifying canonical state. WebGL context loss is likewise reported as a preview failure; canonical simulation data remains untouched.

## Diagnostics

Each successful render exposes:

- total frame, CPU preparation, and WebGL submission time estimates;
- whether artwork geometry was **rebuilt** or **reused**, rebuild count and current rebuild cost;
- draw-call and artwork/overlay vertex counts;
- cached artwork bytes, overlay bytes, and bytes uploaded to the GPU on the current frame;
- bounded preview count/capacity/drop state;
- CSS viewport, DPR, framebuffer dimensions, and zoom;
- reported WebGL renderer/vendor strings.

For a view-only frame after initial construction, the expected signal is `Geometry cache: reused` and near-zero artwork upload bytes. Timing values remain diagnostic only and never participate in canonical logic.

## ~64k interaction profile

`npm run benchmark:render` models the real regression scale: 63,726 representative Ink/Filament/Dust/Shard deposition records at a `1118×710 @ 1.13× DPR` view. It measures the single initial artwork build, then performs 120 pan/zoom transform rounds and asserts structurally that geometry rebuild count remains exactly one. It reports initial-build time plus view-transform median/p95 timings, vertices and buffer size.

CI runs the profile on the Node 22 verification job. Machine timing is informational; **cache reuse is the correctness gate**.

## Representative browser demo

Until FW-007 adds the editing instrument, app startup creates a fixed seeded four-material FW-005 scenario and renders its canonical deposition records. The view supports pointer drag to pan and mouse-wheel/trackpad zoom. Field/emitter overlays remain visible so simulation sources and deposits can be inspected.

## Automated browser acceptance gate

`scripts/browser-smoke.mjs` drives the real app through W3C WebDriver in Chrome/Chromium and Firefox. In addition to WebGL2 health, material/draw evidence, resize and screenshots, FW-016 requires a burst of 48 pointer movements plus 12 wheel events to prove:

- viewport state changes;
- the artwork geometry rebuild count remains unchanged;
- diagnostics explicitly report geometry-cache reuse;
- the published canonical result identity remains unchanged;
- at least the full burst is registered as render requests, while animation-frame coalescing limits it to at most two render executions in the acceptance window.

A subsequent browser resize must also preserve the artwork rebuild count. Browser screenshots/logs remain noncanonical, environment-specific acceptance evidence only.

## Manual browser smoke procedure

For additional desktop/hardware coverage, use current Chromium and Firefox:

1. `npm run serve` and open the printed localhost URL.
2. Confirm all four material treatments appear.
3. Note diagnostics after initial load: the geometry cache should have rebuilt once.
4. Drag continuously and wheel-zoom repeatedly. Subsequent diagnostics should say `Geometry cache: reused`; rebuild count should remain stable and artwork upload should drop to zero on view-only frames.
5. Resize the window or move between monitors with different DPR. Framing should remain correct without an artwork rebuild.
6. Confirm field/emitter overlays remain visually separate.
7. Confirm diagnostics remain responsive and there are no console errors or external-resource failures.
8. Disable WebGL2 (or use a profile where unavailable) and confirm the actionable renderer-unavailable message while canonical state remains intact.

Manual performance evidence should record browser version, OS/GPU, deposition count, geometry rebuild state, prepare/submit times and outcome rather than claiming universal timing guarantees.
