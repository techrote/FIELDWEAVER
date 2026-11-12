# Nocturne in Countercurrent — admission review

**Status: DRAFT / HOLD for owner aesthetic decision. Not an accepted preset.**
The original seven artwork files and their Git blobs are preserved unchanged.

## Verified offline comparison (current repository)

From this PR checkout, with Node 22 or 24:

```sh
npm run verify
node gallery/originals/01-nocturne-in-countercurrent/review.mjs
```

Open the printed local `file:` URL directly in Firefox. The generated
standalone exhibition compares Nocturne against the **accepted** Operator Atlas
and Timeline Pulse CPU proofs. It regenerates the candidate with FIELDWEAVER's
canonical CPU exporter, checks the archived PNG's **decoded full RGBA8 bytes**,
canonical hashes and provenance, and embeds source-exact PNG, provenance and
downloadable recipe in a network-independent review page. It will fail rather
than silently display a mismatched or missing archive.

**Source identity:** `fw-recipe-v1` / `fw-agents-v1`;
seed `0x77d5e2a1` (2010505889); tick **156**; crop **512×320**,
world centre (160,128), 0.625 units/pixel. Recipe FNV64
`ee1696765f96ef0c`, decoded RGBA8 FNV64 `1427da2094a6b26a`.
All archived canonical bytes remain unchanged.

## Curatorial comparison at native resolution

The image has two widely separated, free-flowing cyan-to-blue bands,
a lower oxidised-red/ochre current, an isolated ochre crest at upper
right, and magenta near-orthogonal tracery across the top. The central
ribbon is a distinct angular hinge. Broad black space separates these
elements and keeps the picture legible at native scale.

Against **Registry of Vacant Rooms #57**, the silhouette is curved and
horizontally dynamic instead of upright and architectural. Against
**Interval Engine #41**, Nocturne is far sparser: its smooth bands do
not repeat the dense broken-strata motif. Against **Luminous Ledger #37**,
Nocturne lacks the repeated vertical hanging register; its central
negative space carries more of the composition.

**Limitations:** the isolated amber upper-right arc and top magenta
scaffolding appear structurally detached; the right-hand cyan tail and
large empty middle may read as separate gestures rather than an
integrated work. These are curatorial concerns, not export defects.
Adding more tiny filaments would not resolve them.

**Recommendation:** hold as a secondary Draft, not an automatic admit.
The owner should examine the actual PNG at 100% and the full compare,
then import the downloadable normalized recipe via `0Play.cmd`,
reproduce tick 156 at 512×320, and choose **ADMIT / REVISE FORM /
REJECT**. Integration alone owns admission. Browser CI is not a physical
owner Firefox evaluation.

The artwork-local regression also checks offline download identities and
recipe import/roundtrip; no engine, editor, or shared exhibition files
are changed by this update.
