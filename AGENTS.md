# FIELDWEAVER autonomous agent contract

This file applies to the entire repository.

## Authority order

When implementing a GitHub issue, use this order of authority:

1. The issue being implemented, including later clarifying comments from the maintainer.
2. `AGENTS.md`.
3. `RAG.md` and other repository documentation on current `main`.
4. Already-merged prerequisite issue implementations and their tests.
5. Existing code conventions.

If two sources conflict, preserve the higher-authority contract and document the reconciliation in the PR.

## Mandatory working method

For every implementation issue:

- Read the complete issue, `AGENTS.md`, `RAG.md`, and all files materially touched by the change before editing.
- Check that every declared prerequisite issue is merged. Do not emulate missing prerequisites with throwaway scaffolding.
- Work from current `main` on a dedicated branch.
- Keep the implementation scoped to the issue, but fix directly exposed correctness defects when required to satisfy the issue contract.
- Add or update automated tests for every deterministic or serializable behaviour introduced.
- Run the repository's full required local checks before opening a PR.
- Open a PR that links the issue and explains architecture, tests, deterministic implications, and any deliberate deviations.
- Repair failures caused by the branch. Do not weaken tests, determinism checks, lint/static checks, or CI simply to make a PR green.
- After all required automated checks pass, merge the PR using an allowed repository merge method. The maintainer explicitly authorizes autonomous merge for these issues after checks pass.
- Verify the merge commit is present on `main` and the required checks are green for the merged state where available.
- Close the issue only when its acceptance criteria are genuinely satisfied. If blocked by a repository/permission/external-service limitation, leave the issue open and record the exact blocker.

## Product invariants

The following are not optional unless the maintainer explicitly changes them:

- FIELDWEAVER is local-first and must remain usable without network services.
- The canonical simulation is fixed-step and deterministic from explicit inputs.
- No hidden/global randomness, wall-clock time, frame rate, GPU floating point, DOM timing, or iteration-order accident may affect canonical state.
- Canonical state uses explicit integer/fixed-point arithmetic and a model-owned seeded PRNG.
- Rendering is a view of model state, not the source of simulation truth.
- WebGL2 is the initial live renderer. GPU acceleration may not redefine canonical results unless equivalence is proven by tests.
- Recipe and timeline formats are versioned and validated. Unknown incompatible versions fail loudly rather than changing meaning silently.
- User work must survive save/load without semantic drift.
- Any lossy/noncanonical preview path must be visibly and programmatically distinguishable from canonical execution/export.
- Avoid heavyweight frameworks and unnecessary runtime dependencies. A new dependency needs a concrete justification in the PR.
- Accessibility and keyboard operation are product requirements, not cleanup work.

## Determinism testing

Deterministic features require fixtures or golden hashes that prove repeatability across repeated runs and, where feasible in CI, across supported JavaScript runtimes/platforms. Prefer hashes of canonical logical state and raw decoded RGBA pixels over hashes of compressed files.

Never use a flaky visual screenshot as the sole oracle for canonical behaviour.

## Documentation discipline

If code changes a contract described in `RAG.md`, update the documentation in the same PR. Do not leave implementation and architecture documents knowingly inconsistent.

Issue IDs use the `FW-###` prefix. Preserve those IDs in branch names, commit/PR titles where practical, and documentation references.