# Sanctum texture notes

The live archive atrium uses locally generated textures and geometry. It does
not fetch city, stained-glass, PBR, or HDRI assets at runtime.

## Current generated textures

- `getMarbleTexture()` creates a deterministic graphite-green archive floor
  with a quiet hex pattern in `src/pages/sanctum/textures.ts`.
- `getShadowTexture()` creates the soft radial shadow below each champion.
- `buildClassTexture(catType)` creates four pixel-art frames for each
  session class, including original palette and profession-prop variations.
  `SessionChampionNode` still renders these frames as sprites. The separate
  Rivetwren Blender model is not loaded by the app.

The Archive Warden, stepped archive stacks, Index Spindle, Session Index Dial,
and Archive Seal are authored in `src/pages/sanctum/ArchiveWarden.tsx`,
`src/pages/ScryingSanctum.tsx`, and `src/pages/sanctum/ArchiveSeal.tsx`.
The Archive Seal is repeated on the Warden, the dial, and the local Rivetwren
study as the shared Meow Ops visual signature.

## Adding future assets

Keep runtime assets local to the app. Before adding an externally sourced
texture or model, verify its license, record its source and attribution, and
review that it fits the original archive direction. Do not add runtime
requests to third-party asset hosts. See
`docs/sanctum-visual-identity.md` for the visual direction and provenance
limits.
