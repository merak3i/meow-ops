# Sanctum visual identity

The Sanctum is an original civic archive atrium for reviewing local session activity. Its Archive Warden, Session Index Dial, and session roster share one recurring mark: the Archive Seal.

## Archive Seal

Keep the authored design consistent: four long teal rays alternate with four short copper rays inside a broken octagonal track, around a copper diamond with a teal center. Reuse the same geometry on the Warden, the Index Dial, and the session characters. The mobile session index uses the same mark so it remains recognizable at roster size.

The vector is defined in `src/pages/sanctum/archive-seal-mark.ts`. `src/pages/sanctum/ArchiveSeal.tsx` renders it on the Warden, Index Dial, and roster rows. The standard seven-role cutouts use `src/pages/sanctum/roster-art.ts`, which overlays the same vector on each role image in `src/pages/sanctum/assets/roster/`. The Canvas sprite path in `src/pages/sanctum/textures.ts` also uses the shared vector. Generated character references may approximate the Seal. Finished assets should use the authored geometry so the arrangement and colors stay consistent.

## Provenance and comparison

The dated Archive Warden direction prompt (`2026-09-27T01:47:25Z`; SHA-256 `5b8463c202d10b56d061606b4c83ee334e42264e2c51a1c0ed3f8a20474d7bf6`) asks for a blank chest plate and leaves the Seal out of generated art. The prompt, original cutouts, modeling studies, and review renders remain in the local Sanctum archive, which is excluded from public Git and deployment packages because it also contains retired reference work and large editable sources. The Seal is applied separately by authored code.

The canonical vector and Canvas drawing source is `src/pages/sanctum/archive-seal-mark.ts` (SHA-256 `9e326dca35afdcf53b55cff652d9bd79bad7e7f3473bbaef736c39ef37697717`). `src/pages/sanctum/ArchiveSeal.tsx` applies the same geometry to the 3D Warden, Index Dial, and roster-row mark (SHA-256 `f0b44f1f0aba7f549459b10ed94ab8030f3d68cd370446043b7858b42050c7f9`). Production cutout placement and vector overlay are recorded in `src/pages/sanctum/roster-art.ts` (SHA-256 `ad6dcb3717058c98e99506c487d6d49bcacbfa6c3558e3430116654ceb1904bc`); the older Canvas sprite path in `src/pages/sanctum/textures.ts` also uses the shared vector. The public repository tracks the exact mark and the code that applies it; the local archive retains the dated source material. Together they support comparison if the work is copied, but neither prevents copying, proves plagiarism, or establishes rights. The archive guide has no religious mark; its chest Seal is the recurring comparison feature.
