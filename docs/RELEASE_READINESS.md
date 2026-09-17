# FW-014 release readiness

This document is the release-readiness record for FIELDWEAVER 0.11.0. It is descriptive, not a new canonical contract. Canonical semantics remain defined by `RAG.md`, `docs/CANONICAL.md`, and the subsystem documents.

## Release entry points

A fresh checkout requires Node.js 22 or 24. On Windows run `0Play.cmd`; on POSIX run `sh ./0Play.sh`. Both preserve the FW-001 local-only launch path. Equivalent commands are `npm ci`, `npm run verify`, then `npm start` or `npm run serve`. FIELDWEAVER does not require a package CDN, cloud API, telemetry service, font host, or other external runtime dependency.

The first sidebar panel exposes four deterministic built-in presets. Selecting a preset changes only the previewed metadata; **Load preset** transactionally adopts its validated recipe. The preset recipe hash is published independently from preview timing and is checked by Node and Chrome/Firefox release acceptance.

| Preset | Primary release coverage | Golden target tick |
|---|---|---:|
| First Weave | Four materials, uniform + vortex field stack, colour and behaviour LUT mappings | 48 |
| Operator Atlas | Uniform, vortex, attractor, turbulence, direction quantizer, mixed field stack | 40 |
| Timeline Pulse | Commands, exact-tick intervention, burst, field disable, freeze/resume, material edit | 44 |
| Infinite Lineage | Far-chunk framing, mutation lineage, Infinite Plate/canonical-export workflow | 36 |

`fixtures/fw-014-presets.json` locks each shipped preset to recipe, canonical state, deposition, result, and raw-RGBA hashes. Timing, WebGL pixels, camera history, and cache residency are deliberately excluded.

## Consolidated diagnostics

The existing **Diagnostics** panel remains the single diagnostic surface. FW-014 appends release telemetry to the same panel rather than creating another source of truth. It reports:

- preview frame prepare/submit time, draw calls, stable geometry cache reuse/rebuild count, vertices, prepared bytes, GPU upload bytes, preview-window bounds, viewport and WebGL renderer information;
- canonical simulation batch size, last batch wall-clock duration and diagnostic milliseconds/tick, plus active agents and retained depositions;
- scheduler backlog from the editor diagnostics;
- replay checkpoint count/bound, checkpoint byte estimate and evictions;
- current mutation-family size;
- Infinite Plate state, requested/active chunk count, bounded cache-entry count and last foreground evaluation duration;
- canonical export state, raw RGBA identity, wall-clock preparation duration and diagnostic megapixels/second after an export;
- an explicit boundary line distinguishing canonical CPU simulation/replay/software raster state from noncanonical WebGL and wall-clock telemetry.

All wall-clock values are noncanonical observations. They never enter recipes, PRNG streams, simulation transitions, mutation identities, canonical hashes, or exported pixels.

## Bounded-memory audit

The release deliberately uses count/capacity limits where exact byte accounting would imply precision the runtime cannot guarantee. Exact/estimated bytes are shown where a subsystem already owns a meaningful representation.

| Subsystem | Default / release bound | Failure or eviction behaviour |
|---|---|---|
| Editor canonical agents | 8,192 default; validated max 1,000,000 | Capacity is fixed for a session; excess spawns are counted as dropped, not silently reallocated |
| Editor depositions | 250,000 default; validated max 10,000,000 | Canonical deposition-capacity exhaustion is explicit where completeness is required |
| Live preview accumulation | 100,000 retained records | Bounded ring/window; preview truncation is visible and noncanonical |
| Authoring undo/redo | 128 entries default | Oldest authoring history is evicted |
| Timeline edit history | 64 entries default, configurable maximum 4,096 | Oldest edit-history entry is evicted |
| Replay checkpoints | every 32 ticks; 12 checkpoints default, configurable maximum 4,096 | Oldest nonzero checkpoint is evicted; diagnostics expose count, estimate and evictions |
| Mutation siblings | maximum 8 generated siblings; visual comparison maximum 4 | Invalid counts are rejected; comparisons use isolated replay state |
| Infinite Plate chunk cache | 32 entries default; maximum 4,096 | LRU-style eviction; cache contents are nonsemantic |
| Infinite Plate request | maximum 4,096 chunks; default work safeguard 250,000,000 tick-agent slots | Oversized requests fail with an actionable range error before publishing a result |
| Interactive assembled canonical image | 16,777,216 pixels | Full assembly rejects larger images and directs callers to bounded tile iteration |
| Export dimensions | maximum 100,000 px per axis | Invalid/unsafe crops fail before rasterization |
| Raster tile | 256 px default; bounded tile buffers | Tile order and size do not alter canonical RGBA output |

Infinite Plate cached entries may share deposition objects with replay results, so the UI reports cache-entry pressure instead of presenting a fabricated byte-accurate heap figure. Replay checkpoint bytes and renderer prepared/GPU-upload bytes are explicit estimates/measures owned by those subsystems. Browser heap size remains host/runtime dependent and noncanonical.

## Performance evidence and regression policy

FW-016 began from real Firefox/ANGLE/GTX 980-class desktop evidence at 63,726 retained depositions and 101,532 artwork vertices: renderer preparation took roughly 483–551 ms per interaction frame while WebGL submission itself took only 1–2 ms. That identified full geometry reconstruction/upload and per-pointer-event rendering as the dominant hotspot. The accepted correction made view changes affine transform updates over stable geometry, requestAnimationFrame-coalesced pointer rendering, and cached canonical identity. `docs/FW-016-PERFORMANCE.md` preserves the original evidence.

The post-fix regression benchmark `npm run benchmark:render` uses the same 63,726-deposition workload. Its correctness gate is structural: exactly one artwork geometry rebuild across 120 pan/zoom rounds. It additionally prints initial-build, median view-update and p95 view-update timing together with host Node/platform information. Those milliseconds are diagnostic only because the CI host differs from the original desktop.

FW-014 adds `npm run benchmark:release`, a repeated canonical simulation pressure profile that reaches exactly 30,000 long-lived simple active agents at tick 470. It performs one warm-up and three reported samples, requires state/deposition hashes to agree across all samples, and reports min/median/max elapsed time plus median milliseconds/tick. CI executes both profiles on Node 22. No universal frame-rate or milliseconds/tick promise is inferred from shared runners.

Representative browser rendering continues to be exercised through Chrome and Firefox WebGL2 smoke at a 1280×820 CI window. A 1920×1080 target remains the documented product baseline; browser rendering performance is workload and GPU dependent, while correctness is guarded by deterministic model hashes and structural cache assertions rather than a fragile CI timing threshold.

## Browser support and acceptance matrix

The supported desktop browser baseline is current Chromium and current Firefox with WebGL2. CI uses the runner-provided Chrome/Chromedriver and Firefox/Geckodriver; Firefox runs under Xvfb with software WebRender enabled and Chrome uses SwiftShader in headless acceptance. This is intentionally conservative: passing the software path does not claim identical GPU-driver performance.

Every release CI browser lane exercises:

| Workflow | Chrome | Firefox |
|---|---|---|
| Application/editor/WebGL2 smoke, labels and canonical identity | required | required |
| LUT edit/generate/map workflow | required | required |
| Field painting, undo/redo, emitter edit, deterministic transport | required | required |
| FW-016 pan/zoom geometry-cache regression | required | required |
| Timeline replay/seek/editor | required | required |
| Mutation siblings/comparison | required | required |
| Canonical export and provenance | required | required |
| Infinite Plate regional evaluation/cache/export | required | required |
| FW-014 preset adoption, diagnostics boundary, normalized accessibility roles | required | required |
| Keyboard canvas paint stamp with focused canvas + Enter | required | required |

For a manual desktop sanity pass, repeat the four-preset load sequence, Space/run and exact-step controls, a keyboard paint stamp, Save/Load recipe, mutation comparison, Frame current view, and a canonical export in both browser families. Any browser-specific workaround must remain noncanonical and be added to this matrix.

## Accessibility audit

`docs/ACCESSIBILITY.md` contains the detailed audit. The release fixes the two serious semantic problems found during the pass: the interactive canvas no longer claims the ARIA `application` role, and field-layer buttons are exposed as ordinary pressed buttons inside a labelled group rather than buttons whose native semantics were overwritten by `role=option`. The focused canvas supports an Enter-key paint/erase stamp at the view centre, so a core authored field change no longer requires a pointer. Native buttons/selects/inputs remain keyboard reachable, focus-visible styling remains explicit, the skip link remains first in the document, and browser smoke rejects unlabeled controls.

There are no essential CSS animations in 0.11.0; the existing reduced-motion media query disables smooth scrolling. Preview simulation movement is artwork evolution rather than decorative UI animation and is controlled by deterministic run/pause transport.

## Error/failure paths

Release behaviour is fail-explicit rather than silently substituting another semantic path:

- malformed recipe JSON and invalid references reject transactionally without partially mutating live work;
- unknown recipe schema versions reject unless a registered explicit migration exists;
- malformed LUT/preset recipes reject before adoption; every built-in preset is reconstructed and hash-checked in tests;
- WebGL2 creation failure leaves canonical/editor state intact and shows an actionable unavailable message; canonical export remains a CPU path;
- canonical export refuses deposition exhaustion and over-large full-image assembly rather than taking pixels from the WebGL framebuffer;
- Infinite Plate rejects excessive work estimates, excessive requested chunks and excessive interactive assembled pixels; foreground evaluation is cancellable and never publishes a partial canonical result;
- timeline checkpoints/cache misses affect cost only; backward seeks restore and replay forward;
- mutation invalid children are rejected instead of partially adopting a sibling.

## Troubleshooting

If launch helpers close immediately, run `npm ci` and `npm run verify` in a terminal first; Node must be 22 or 24. If the page is blank under `file://`, use `0Play.cmd`, `0Play.sh`, `npm start`, or `npm run serve` because ES modules are served from `127.0.0.1` by design. If WebGL2 is unavailable, inspect Diagnostics for the browser renderer/failure message; do not treat a screenshot or framebuffer as canonical output. If a preset or recipe is rejected, preserve the error text and the input file because import is transactional. If an Infinite Plate request exceeds safeguards, reduce crop size/scale, target tick, or session capacity rather than raising limits without understanding the resulting memory/work envelope.

For canonical-result disagreements, record the recipe hash, target tick, state hash, deposition hash, raw RGBA hash, Node/browser version, and whether the operation was ordinary export or Infinite Plate. Canonical disagreements are correctness bugs; wall-clock/FPS differences alone are not.
