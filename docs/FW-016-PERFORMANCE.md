# FW-016 preview interaction regression

FW-016 was opened from real desktop evidence rather than synthetic profiling alone.

Observed on Firefox / ANGLE / NVIDIA GeForce GTX 980-class hardware with 63,726 retained preview depositions and 101,532 artwork vertices:

- renderer preparation: 483–551 ms per interaction frame;
- WebGL submission: 1–2 ms;
- prepared vertex data: about 2.7 MiB;
- repeated drag input made the UI progressively less responsive.

Inspection identified five compounding main-thread costs: full preview-ring snapshot, full record validation/coordinate reprojection, full artwork GPU upload, synchronous render per pointer event, and a full canonical result hash after every render outside the renderer timing measurement.

The accepted FW-016 design makes stable artwork preparation dependent on deposition-window revision instead of camera state. Pan/zoom/resize are affine shader-uniform updates. Input rendering is requestAnimationFrame-coalesced. The static demo computes canonical result identity once and supplies a frozen preview-reference array rather than canonically rehashing tens of thousands of records on every camera event.

Correctness is structural rather than based on a machine-specific millisecond threshold:

- unit tests require cached artwork identity to survive pan/zoom/resize;
- changing preview content must invalidate/rebuild the cache;
- Chrome and Firefox acceptance tests send 48 pointer moves plus 12 wheel events and require unchanged geometry rebuild count, cache-reuse diagnostics, stable canonical identity, and no more than two render executions in the acceptance window;
- the 63,726-deposition benchmark requires exactly one geometry rebuild across 120 view-transform rounds.

Timing output remains diagnostic because host CPU/browser/GPU performance is not a canonical contract.
