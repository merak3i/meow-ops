# Companion breed portrait prompts

The Companion page automatically uses any PNG file at:

```
public/companion/breeds/{breed_key}.png
```

If a file exists for a given breed, it replaces the SVG fallback. Recommended:
512×768 portrait, transparent background, the cat centred.

These prompts are tuned for **Imagen 3 / Google Nano Banana Pro 3.1** but
work equally well in **Flux**, **Midjourney**, or **Stable Diffusion XL**.

## Style preamble (paste at the start of every prompt)

> Premium digital painting, Pixar-meets-Studio-Ghibli style, hand-painted
> texture, large expressive anime eyes with three highlights, soft fur
> rendering, dramatic rim lighting, transparent background, full-body cat
> portrait centred, sitting upright facing camera, 4K, ultra-detailed,
> cinematic atmosphere, no text, no watermark.

## Per-breed prompts

| key | prompt addition |
|---|---|
| `persian` | Persian kitten with long fluffy cream fur, flat round face, huge round amber eyes, plush body, regal posture |
| `siamese` | Siamese kitten with sleek tan body and dark seal-point face, ears, paws, and tail, deep sapphire-blue almond eyes, slender elegant body |
| `tabby` | Orange tabby kitten with classic dark stripes across body and tail, bright green eyes, alert curious expression, short fur |
| `blackShorthair` | Pure jet black shorthair kitten with luminous bright lime-green eyes, sleek glossy fur, mysterious mood, dim warm rim light |
| `whiteShorthair` | Pure snow white shorthair kitten with ice-blue heterochromatic eyes, soft pink nose and ears, calm gentle expression |
| `calico` | Calico kitten with tri-color patches of cream, orange, and dark brown, big green eyes, playful tilted head |
| `tuxedo` | Tuxedo kitten with formal black body and crisp white chest, white paws, white muzzle, big golden-yellow eyes, dignified posture |
| `tortoiseshell` | Tortoiseshell kitten with marbled brown, black, and orange swirling fur, intense amber eyes, fierce expression |
| `russianBlue` | Russian Blue kitten with silvered slate-blue plush coat, brilliant emerald-green eyes, serene wise expression, soft moonlight |
| `bengal` | Bengal kitten with leopard-spotted golden coat, dark rosette spots, bright lime eyes, athletic wild heart, jungle background blur |
| `maineCoon` | Maine Coon kitten huge plush brown tabby with tufted lynx-point ears, fluffy cheek ruff, copper-gold eyes, mountain-cat majesty |
| `britishShorthair` | British Shorthair kitten with round chubby silver-grey face, dense plush coat, large copper-orange eyes, dignified expression |
| `scottishFold` | Scottish Fold kitten with characteristic folded-down ears, dove-grey fur, soft blue eyes, gentle round face |
| `ragdoll` | Ragdoll kitten with cream long fur and dark seal-point face, deep sapphire-blue eyes, relaxed limp posture, soft halo light |
| `norwegianForest` | Norwegian Forest kitten with thick wild brown tabby fur, tufted ears, viking-cat majesty, bright green eyes, snowy pine-forest background blur |
| `savannah` | Savannah kitten with tall lean body, large round dark spots on golden coat, huge ears, striking amber eyes, exotic posture |
| `egyptianMau` | Egyptian Mau kitten with silver coat covered in dark spots, large gooseberry-green almond eyes, ancient dignified expression |
| `sphynx` | Sphynx kitten with hairless wrinkled tan skin, very large pointed ears, intense red-amber eyes, alien sweetness |
| `korat` | Korat kitten with silver-tipped slate blue plush coat, peridot-green eyes, sacred gentle expression |
| `turkishVan` | Turkish Van kitten with pure white body and warm auburn cap and tail, amber eyes, swimming-cat playfulness |

## Generation tips

1. **Always use transparent background** — the room background renders behind
   the cat. PNG with alpha channel.
2. **Centre the cat** — leave even padding on all sides. The cat sits at
   bottom-centre of the frame in the room.
3. **Aim for kitten proportions** — large head, short body. The Companion
   stage system scales the same image; bigger life stages will scale up the
   sprite.
4. **Match eye colour to breed** — eye colour is the strongest character
   read.
5. **Save filename exactly** — `public/companion/breeds/{key}.png`. Keys must
   match the breed-key column above.
6. **Optimise for ~80–200 KB each** — these are fetched lazily on breed
   change but kept in module cache.

## Generating with Flux locally

```bash
# Example with the diffusers CLI + Flux schnell
diffusers-cli generate \
  --model "black-forest-labs/FLUX.1-schnell" \
  --prompt "$STYLE_PREAMBLE Persian kitten with long fluffy cream fur..." \
  --width 512 --height 768 \
  --transparent \
  --output public/companion/breeds/persian.png
```

## Generating with Imagen 3 via Vertex AI

```python
from google.cloud import aiplatform
imagen = aiplatform.Imagen3()
result = imagen.generate(
    prompt=f"{STYLE_PREAMBLE} Persian kitten with long fluffy cream fur...",
    aspect_ratio="3:4",
    number_of_images=1,
)
result.images[0].save("public/companion/breeds/persian.png")
```
