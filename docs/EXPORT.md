# Canonical software export (`fw-canonical-export-v1`)

FW-012 establishes FIELDWEAVER's canonical image path. The WebGL2 preview remains a noncanonical view; decoded RGBA8 produced by the software rasterizer is the image oracle.

## Compatibility identities

Current export contracts:

- export package: `fw-canonical-export-v1`
- software raster: `fw-canonical-raster-v1`
- provenance: `fw-export-provenance-v1`
- PNG package: `fw-png-rgba8-v1`

A change to any pixel-affecting rule requires an explicit compatibility/version decision and golden-fixture update. PNG file bytes are packaging; the `rawRgbaHash` of decoded RGBA8 is the canonical image identity.

## Export input and replay

`createCanonicalExport(recipe, options)` normalizes and validates the recipe, then performs ordinary deterministic recipe replay from the recipe initial state to the requested integer `targetTick`. Export does not read the live WebGL framebuffer, preview accumulation, camera, DOM state, GPU state, or renderer timing.

The export replay uses explicit `agentCapacity` and `maxDepositions` bounds. The current browser panel supplies the active editor's configured bounds. If canonical deposition capacity is exhausted, export fails explicitly; it never substitutes a framebuffer capture or silently truncates the canonical image.

The normalized crop contains:

- `widthPx`, `heightPx`;
- chunk-aware world `center`;
- positive Q16.16 `unitsPerPixelQ16`.

Crop framing is independent of the live viewport.

## World-to-pixel mapping

Rasterization uses integer/BigInt calculations for pixel-affecting decisions. Pixel coverage is evaluated at each pixel centre.

For a crop of width `W`, height `H`, world centre `(cx, cy)`, and Q16.16 pixel scale `u`, pixel `(x, y)` samples:

```text
worldX = cx + (2*x + 1 - W) * u / 2
worldY = cy + (H - (2*y + 1)) * u / 2
```

The implementation carries doubled Q16 coordinates, so half-pixel centres do not require floating point. World +Y maps upward; raster row indices increase downward.

Chunk/local coordinates are normalized before conversion to absolute world Q16 coordinates, so crossing chunk boundaries does not change pixel meaning.

## Deposition ordering and primitives

Deposition records are validated and sorted by canonical numeric `sequence`. Duplicate sequence values are rejected. Input array order therefore cannot override canonical compositing order.

Supported primitives:

- `point`: rasterized as a disc centred at the record's `to` position;
- `disc`: same disc coverage rule, centred at `to`;
- `segment`: a closed capsule from `from` to `to`, including round end caps.

Disc coverage uses integer squared-distance comparison. Segment coverage uses integer projection and cross-product tests against the capsule radius. Boundary equality counts as covered.

The canonical radius is the deposition record's Q16.16 `radiusQ16`. No antialiasing, subpixel coverage weighting, GPU sampling, or browser canvas rasterization participates in the oracle.

## Colour, strength, and compositing

If a deposition contains LUT-resolved `colorRgba8`, that exact RGBA8 colour is used. Otherwise the canonical material fallback colour table is:

| Material | RGBA8 |
|---|---|
| Ink | `[245, 110, 46, 184]` |
| Filament | `[92, 232, 250, 219]` |
| Dust | `[235, 214, 112, 148]` |
| Shard | `[204, 122, 255, 230]` |

The default background is opaque `[9, 11, 8, 255]`. Canonical export currently requires an opaque background.

Effective source alpha is the deposition colour alpha multiplied by `strengthQ16`, rounded at Q16 half-up, then clamped to `[0,255]`. Each covered pixel is composited in deposition-sequence order with integer source-over onto the opaque destination:

```text
outRGB = floor((srcRGB * alpha + dstRGB * (255-alpha) + 127) / 255)
outA   = 255
```

An effective alpha of 0 has no effect; 255 replaces RGB directly.

## Tiling and memory bounds

`rasterizeDepositions()` performs a single assembled raster for supported sizes. `rasterizeDepositionsTiled()` evaluates independent tiles and assembles them into the same output buffer. `iterateRasterTiles()` exposes the bounded-memory tile path without requiring a world-sized framebuffer.

Tile origin or dimensions are not semantic inputs. Every tile evaluates pixel centres in global crop coordinates against the same complete ordered deposition stream, so adjacent tiles have no seam-specific rule. Tests compare awkward tile dimensions, including one-pixel tiles, byte-for-byte against single-pass rasterization.

Current safeguards:

- crop dimensions: at most 100,000 px per axis;
- assembled raster: at most 16,777,216 pixels;
- larger valid crops must use `iterateRasterTiles()` rather than full assembly;
- default tile size: 256×256.

These are memory/work safeguards, not changes to pixel semantics.

## Raw-pixel identity

`rawRgbaHash()` computes FNV-1a-64 directly over the row-major RGBA8 byte buffer and returns a 16-character lowercase hexadecimal value. Repeated identical canonical inputs must produce identical raw bytes and therefore the same hash, independent of WebGL implementation and raster tile dimensions.

## PNG packaging

The dependency-free encoder packages the exact canonical RGBA8 buffer as a standards-compliant, non-interlaced 8-bit RGBA PNG using filter type 0 and zlib stored DEFLATE blocks. CRC-32 and Adler-32 checksums are emitted and validated by the repository decoder.

`decodePngRgba()` is used by tests to prove the packaged PNG decodes to byte-identical canonical RGBA8. The raw-pixel hash remains the compatibility oracle even if a future PNG encoder changes compression strategy without changing decoded pixels.

## Provenance sidecar

The JSON provenance report records:

- export/raster/PNG provenance versions;
- normalized full recipe and recipe hash;
- root seed, recipe schema, and engine version;
- target tick;
- crop centre, dimensions, and Q16.16 units/pixel;
- background RGBA8 and pixel format;
- canonical raw RGBA hash;
- canonical simulation state, deposition, and combined result hashes;
- mutation lineage when present.

This is sufficient to identify and replay the canonical recipe at the exported tick and verify the decoded raw pixels.

## Browser UI and noncanonical preview boundary

The **Canonical export** panel exposes independent crop dimensions, centre, scale, target tick, and raster tile size. **Use recipe framing** copies the saved framing into the controls. **Prepare canonical export** runs recipe replay and software rasterization, then enables separate PNG and provenance downloads only after success.

The panel identifies the path as canonical software rasterization. Invalid dimensions, replay/deposition exhaustion, or packaging errors are surfaced as export failures and leave download controls disabled.

Changing live pan/zoom, WebGL state, or export tile size must not change the raw RGBA hash for otherwise identical inputs. Chrome and Firefox CI exercise that boundary directly.
