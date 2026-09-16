# Development and local runtime

FIELDWEAVER intentionally has no runtime or development dependencies beyond Node.js. FW-001 established the local browser/tooling substrate; FW-002 adds a DOM-free deterministic canonical kernel without changing that dependency policy.

## Supported runtime

- Node.js 22 or 24 for local tooling and CI.
- Current desktop Chromium or Firefox for the browser application.

The browser application itself is native HTML/CSS/ES modules. It does not require a framework, package CDN, cloud API, telemetry endpoint, or other external service.

## Commands

From the repository root:

```text
npm run check   # syntax/static policy checks
npm test        # Node built-in test runner
npm run verify  # check + test
npm run serve   # http://127.0.0.1:4173 without opening a browser
npm start       # serve and attempt to open the browser
```

There are currently no package dependencies, but `npm ci` is safe and is what CI runs so the lockfile remains authoritative if tooling dependencies are ever justified later.

## Launch helpers

- Windows: double-click or run `0Play.cmd`.
- POSIX: run `sh ./0Play.sh` (or mark it executable locally and run `./0Play.sh`).

Both launch helpers start the Node standard-library static server and attempt to open the local URL. They do not disable browser security and do not use `file://` module loading.

## Browser smoke check

Before merging browser-facing changes:

1. Start with `npm run serve`.
2. Open the printed localhost URL in a current Chromium browser and Firefox.
3. Confirm the FIELDWEAVER header, workspace placeholder, subsystem status, and diagnostics appear.
4. Confirm the runtime foundation and canonical simulation kernel are reported ready while field authoring and WebGL rendering remain planned.
5. Open developer tools and confirm there are no console errors or failed external network requests.
6. Toggle browser offline mode after the initial local page load. The app shell should continue to operate because it has no external service dependency. Reloading still requires the local static server because native ES modules are served over localhost by design.
7. Activate **Refresh diagnostics** with keyboard focus and confirm the status updates without mutating canonical model state.

## Deterministic core checks

`npm test` executes the FW-002 numeric, coordinate, PRNG, stable-order, serialization, reset, scheduling and long-run golden-hash fixtures under Node with no DOM/GPU APIs. `fixtures/fw-002-golden.json` is compatibility evidence, not a value to update casually. See `docs/CANONICAL.md` before changing any numeric/PRNG/tick/hash semantics.

## Subsystem boundary

`src/core/` is DOM-free and importable by Node tests. Browser/DOM work lives outside it. Future simulation/field/material issues must preserve that boundary.

The shell reports the FW-002 canonical kernel as ready but continues to label field authoring and WebGL rendering as planned rather than presenting placeholder behaviour as implemented functionality.
