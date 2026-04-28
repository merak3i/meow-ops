# Sanctum textures — PBR upgrade runway

The Scrying Sanctum currently uses **canvas-generated procedural textures** for
the marble floor, stained-glass windows, and runic glyphs. They look fine — no
external assets required to ship — but if you want to push the visuals further
toward photoreal Dalaran, drop CC0 PBR texture packs in this directory.

This file documents exactly **which assets to grab**, **where to drop them**,
and **which lines in `src/pages/ScryingSanctum.tsx` to swap** so the upgrade
is a 5-minute mechanical task whenever you have time.

---

## What to download (~10 minutes, all free, all CC0)

All from **[polyhaven.com](https://polyhaven.com)** unless noted. Pick the **2K**
resolution variant for each — the Sanctum is stylized, not photoreal, so 4K is
overkill and 1K is a touch soft.

### 1. Floor — polished marble with veins

- **Recommended:** [Marble 01](https://polyhaven.com/a/marble_01) — black-and-gold
  veined marble. Matches the violet-stone-with-gold-veins palette.
- **Alt:** [Marble 02](https://polyhaven.com/a/marble_02), [Marble 04](https://polyhaven.com/a/marble_04)

Drop these files in `public/textures/floor/`:

```
floor/marble_diff_2k.jpg     → albedo / color
floor/marble_nor_2k.exr      → normal map (or _gl.jpg if EXR isn't loading)
floor/marble_arm_2k.jpg      → AO + roughness + metalness packed
```

### 2. Citadel + spire windows — backlit stained glass

Stained glass is harder to find as PBR. Two options:

- **Easy:** keep the canvas-generated stained-glass texture (already procedural).
  The current look is intentionally stylized.
- **Polish:** [stained_glass_03](https://polyhaven.com/a/stained_glass_window_03)
  or grab a free stained-glass photo from Wikimedia Commons.

Drop in `public/textures/glass/`:

```
glass/stained_diff_2k.jpg
glass/stained_emit_2k.jpg    → emissive (the "backlit" light)
```

### 3. Sky — night HDRI

- **Recommended:** [Moonless Golf](https://polyhaven.com/a/moonless_golf) —
  deep night sky with stars, plays beautifully with the violet ambient.
- **Alt:** [Satara Night](https://polyhaven.com/a/satara_night),
  [Kloppenheim 06](https://polyhaven.com/a/kloppenheim_06_puresky)

Drop in `public/textures/sky/`:

```
sky/night_2k.hdr             → for drei <Environment files=... />
```

### 4. (Optional) Runic font for floor inscriptions

- [Noto Sans Runic](https://fonts.google.com/specimen/Noto+Sans+Runic) on
  Google Fonts — an actual Unicode runic font.
- Already pulling **Cinzel** via `@import` in `src/index.css` for engraved-Roman
  headers; that's enough for v1. Add Noto Sans Runic only if you want true
  runic inscriptions.

---

## How to wire each in (line numbers approximate, search for the comment markers)

After dropping the files, swap these locations in `src/pages/ScryingSanctum.tsx`:

### Floor — replace procedural marble with PBR

Search for: `Dalaran D3: violet marble texture with thin gold veins`

Replace the `<meshBasicMaterial>` with:

```tsx
import { useTexture } from '@react-three/drei';

// ... inside ArcaneFloor:
const floorTextures = useTexture({
  map: '/textures/floor/marble_diff_2k.jpg',
  normalMap: '/textures/floor/marble_nor_2k.jpg',
  aoMap: '/textures/floor/marble_arm_2k.jpg',
});
floorTextures.map.wrapS = floorTextures.map.wrapT = THREE.RepeatWrapping;
floorTextures.map.repeat.set(4, 4);

// ... in the JSX:
<meshStandardMaterial {...floorTextures} color="#9070c0" roughness={0.5} metalness={0.2} />
```

You'll also need ambient + directional lights for the standard material to
respond — easiest is to drop `<ambientLight intensity={0.4} />` and
`<directionalLight position={[10, 15, 5]} intensity={0.8} />` near the top of
the `Scene` component's JSX.

### Sky — drei `<Environment>`

Search for: `Dalaran D1 — violet ambient`

Add inside `<Canvas>`, near the top:

```tsx
import { Environment } from '@react-three/drei';

<Environment files="/textures/sky/night_2k.hdr" background={false} />
```

`background={false}` keeps your violet `<color>` and `<Stars>` — the HDRI is
just used for image-based reflections on `MeshStandardMaterial`s.

### Stained glass — swap citadel + spire windows

Search for: `Dalaran D3 texture gives multi-band gold/violet/indigo panes`

Replace `getStainedGlassTexture()` calls with:

```tsx
const glassTex = useTexture('/textures/glass/stained_diff_2k.jpg');
// ... in the mesh:
<meshBasicMaterial map={glassTex} transparent opacity={0.7}
  blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
```

---

## Attribution + license

Poly Haven assets are **CC0** — no attribution required, no license file
needed in the repo. If you grab something from elsewhere, double-check the
license is at least CC-BY (then add an `ATTRIBUTIONS.md` next to this file).

Google Fonts (Cinzel, Noto Sans Runic) are **Open Font License** — also free
to use, no attribution required, but credit Google Fonts in the footer if you
want to be polite about it.

---

## Why this is the *runway*, not the path-of-least-resistance

The procedural canvas textures already shipped (D3, commit `024ef13`) carry
the violet-stone-with-gold-veins look just fine for a stylized Sanctum. PBR
upgrade gives you:

- Real surface normal detail (the floor catches light correctly)
- HDRI reflections on metallic accents (champion auras, lampposts)
- Photoreal stained-glass refraction (with `MeshPhysicalMaterial`)

But it requires switching ~30 materials from `meshBasicMaterial` to
`meshStandardMaterial` and adding scene lights. Plan **2 hours of work** if
you go all-in, **30 minutes** if you only swap the floor.

The stylized procedural shipping today is intentional, not a placeholder.
Drop assets when you want them; nothing breaks if you never do.
