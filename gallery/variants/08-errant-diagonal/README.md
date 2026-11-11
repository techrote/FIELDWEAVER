# The Errant Diagonal — FIELDWEAVER variant study 08

A deterministic two-stage descendant atlas from the **accepted** built-in **Operator Atlas**, not a hand-authored replacement for the parent and not a mutation of another worker's unmerged artwork.

## Artistic proposal

What happens when an initially legible four-material flow loses agreement between its five governing fields and the positions of its material sources? The intended focus is shearing and separated motion, not alternative colouring of the same silhouette. Spatially displaced emission is deliberately applied as a second generation, preserving the first generation's history and making its causal break inspectable.

**Curatorial observation (actual Node 24 FW-012 pixel outputs):** I inspected the original five-panel contact sheet and full-size candidate #03, #04 and #15. Candidate #03 keeps a deliberate arched cyan span which descends into an abruptly horizontal mauve terminal at the right; a separate acid-green/magenta diagonal breaches the lower-left edge. This makes a coherent, asymmetric sense of movement and interrupted connection. The numerically highest-scoring #15 moves farther from the parent but reads as a more isolated narrow wave; #04 is attractive but nearly evacuated. Accordingly the chosen sibling is **03**, not the automatic rank-1. The work remains sparse with substantial dark ground and its full-scale Firefox recipe import is untested. The contact sheet is actual CPU pixel material, not an artistic proxy. No claim is made that a geometric metric establishes aesthetic quality.

## Reproduce

From repository root, with Node 22 or 24:

    node gallery/variants/08-errant-diagonal/build.mjs
    npm run verify

The generator imports the accepted FW-011 mutation and FW-012 canonical software exporter without changing either. The generated normalized selected.recipe.json loads through the ordinary editor **Load recipe** control. selected.png and parent.png are direct FW-012 CPU exports. contact-sheet.png merely assembles their canonical pixels into an explicitly **noncanonical presentation** with labels. An exact provenance sidecar accompanies the selected CPU output.

- Immutable parent: accepted operator-atlas preset; its exact recipe hash appears in manifest.json.
- Stage 1: seed 0x4fa2197d, all scope, bold, six operators per sibling.
- Stage 2: seed 0x8154c30a, emitter-only bold operation per sibling; the bridge is an immutable recorded lineage parent.
- 20 independent two-stage candidate siblings, indices 0–19; four structurally separated finalists. Selected child: sibling 03, following actual canonical visual inspection rather than automatic first-place ranking.
- Shared canonical replay tick 136; 224×168 crop; world centre (128,128); 0.75 world units/pixel; 4096 agents; 250000 depositions cap.
- Morphology: background-separated binary occupied-mask symmetric difference and spatial grid occupancy; colour-only changes cannot pass geometric filtering.
- Complete candidate identities, selection, mutation parameters, crop and raw output identities in manifest.json.

## Admission rules

The checked-in PNGs must be the generator's exact CPU-export bytes. The regression reconstructs the complete family, checks pixel uniqueness and morphologically separated finalists, validates normalized child lineage, performs alternate tile replay, decodes selected PNG and byte-compares archived evidence. Full npm run verify is required; physical Firefox recipe import and independent artistic acceptance remain separate.

This directory only owns this artwork and evidence. No accepted preset, existing artwork, shared catalog, mutation core or UI code is modified. Integration owns merge decisions.
