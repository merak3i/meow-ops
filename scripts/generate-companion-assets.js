#!/usr/bin/env node
/**
 * generate-companion-assets.js
 *
 * Batch generates all Companion visual assets using the Replicate API
 * (black-forest-labs/flux-1.1-pro). Idempotent — skips files that already exist.
 *
 * Usage:
 *   REPLICATE_API_TOKEN=r8_xxx npm run gen:assets          # everything
 *   REPLICATE_API_TOKEN=r8_xxx npm run gen:cats            # 20 breed portraits
 *   REPLICATE_API_TOKEN=r8_xxx npm run gen:rooms           # 6 room backgrounds
 *   REPLICATE_API_TOKEN=r8_xxx npm run gen:accessories     # 13 accessory renders
 *   REPLICATE_API_TOKEN=r8_xxx npm run gen:foods           # 10 food item renders
 *
 * Outputs:
 *   public/companion/breeds/{breed}.png      512×512
 *   public/companion/rooms/{room}.jpg        1920×1080
 *   public/companion/accessories/{key}.png   512×512
 *   public/companion/foods/{key}.png         512×512
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TOKEN = process.env.REPLICATE_API_TOKEN;
if (!TOKEN) {
  console.error('❌  Set REPLICATE_API_TOKEN before running this script.');
  console.error('    REPLICATE_API_TOKEN=r8_xxx npm run gen:cats');
  process.exit(1);
}

const FLUX_MODEL = 'black-forest-labs/flux-1.1-pro';
const STYLE_PREAMBLE =
  'masterpiece, concept art, digital painting, dark fantasy aesthetic, ' +
  'dramatic cinematic lighting, richly detailed, Game of Thrones atmosphere, ' +
  'deep blacks, jewel-tone accents, painterly brushwork, highly detailed';

// ─── Breed definitions (inline so script has no build step) ────────────────

const BREEDS = {
  persian:        { label: 'Persian', desc: 'fluffy cream long-haired cat, amber eyes, flat face, regal posture, full body sitting' },
  siamese:        { label: 'Siamese', desc: 'sleek tan cat with dark point markings on face ears and paws, brilliant sapphire blue eyes, full body' },
  tabby:          { label: 'Tabby', desc: 'orange tabby cat with bold dark stripes, green eyes, curious alert expression, full body' },
  blackShorthair: { label: 'Black Shorthair', desc: 'jet black sleek short-haired cat, vivid green eyes, mysterious gaze, full body' },
  whiteShorthair: { label: 'White Shorthair', desc: 'pure snow-white cat, ice blue eyes, serene expression, full body' },
  calico:         { label: 'Calico', desc: 'tri-color cat with patches of white orange and black, green eyes, full body' },
  tuxedo:         { label: 'Tuxedo', desc: 'black and white tuxedo cat, golden eyes, distinguished formal appearance, full body sitting' },
  tortoiseshell:  { label: 'Tortoiseshell', desc: 'marbled brown black and orange tortoiseshell cat, amber eyes, intense gaze, full body' },
  russianBlue:    { label: 'Russian Blue', desc: 'grey-blue sleek cat with silver-tipped fur, vivid emerald eyes, regal elegant posture, full body' },
  bengal:         { label: 'Bengal', desc: 'leopard-spotted golden Bengal cat, wild markings, green eyes, athletic build, full body' },
  maineCoon:      { label: 'Maine Coon', desc: 'enormous fluffy brown tabby Maine Coon, tufted ears, golden eyes, majestic presence, full body' },
  britishShorthair: { label: 'British Shorthair', desc: 'round-faced silver British Shorthair cat, copper eyes, dense plush coat, dignified expression, full body' },
  scottishFold:   { label: 'Scottish Fold', desc: 'dove grey Scottish Fold cat with folded ears, blue eyes, gentle rounded face, full body' },
  ragdoll:        { label: 'Ragdoll', desc: 'colorpoint cream Ragdoll cat, deep sapphire blue eyes, silky long fur, relaxed gentle pose, full body' },
  norwegianForest:{ label: 'Norwegian Forest', desc: 'massive wild Norwegian Forest cat with thick layered fur, green eyes, fierce and majestic, full body' },
  savannah:       { label: 'Savannah', desc: 'tall exotic Savannah cat with leopard spots, golden eyes, long athletic legs, wild look, full body' },
  egyptianMau:    { label: 'Egyptian Mau', desc: 'spotted silver Egyptian Mau cat, green eyes, ancient regal bearing, natural spots not stripes, full body' },
  sphynx:         { label: 'Sphynx', desc: 'hairless wrinkled Sphynx cat, red eyes, alien otherworldly appearance, prominent ears, full body' },
  korat:          { label: 'Korat', desc: 'silver-tipped slate blue Korat cat, luminous green eyes, sacred revered expression, full body' },
  turkishVan:     { label: 'Turkish Van', desc: 'white body with auburn cap and tail Turkish Van cat, gold eyes, full body' },
};

const ROOMS = {
  corner_mat:     { label: 'Corner mat', desc: 'dim wooden corner of a medieval room, burlap mat on rough plank floor, single shaft of warm candlelight, shadows and texture' },
  cushion_bed:    { label: 'Cushion bed', desc: 'stone alcove with a rich purple velvet cushion, hanging tapestry with a lion motif, flickering torch sconce, warm moody atmosphere' },
  wooden_cottage: { label: 'Wooden cottage', desc: 'warm wooden cottage interior, fireplace hearth, frost on window panes with snowfall beyond, rustic timber beams, cozy and intimate' },
  enchanted_tree: { label: 'Enchanted tree', desc: 'hollow of an ancient glowing tree, bioluminescent fungi, fireflies, vines draping, mystical green and blue light, magical forest interior' },
  castle_keep:    { label: 'Castle keep', desc: 'grand stone castle hall, house banner hanging from rafters, torch sconces on pillars, dramatic shadows, gothic arched ceilings' },
  throne_room:    { label: 'Throne room', desc: 'imposing throne room, iron throne made of swords, black marble floor, smoldering ember light from braziers, smoke wisps, dark and powerful' },
};

const ACCESSORIES = {
  scarlet_sigil:       { label: 'Scarlet Sigil Collar', desc: 'ruby-studded leather cat collar, ornate medieval craftsmanship, deep red gems, gold settings, dark background' },
  sapphire_band:       { label: 'Sapphire Oath Band', desc: 'sapphire blue cat collar band, oval blue gemstones set in silver, engraved oath runes, clean isolated' },
  emerald_vow:         { label: 'Emerald Vow Collar', desc: 'mossy green cat collar, emerald stones, woven forest vines motif, nature-themed ornate detail' },
  ebony_cravat:        { label: 'Ebony Cravat', desc: 'elegant black silk cat cravat necktie, perfectly tied, formal and distinguished, midnight black fabric with subtle sheen' },
  silverbell:          { label: 'Silverbell of Summoning', desc: 'small ornate silver bell on a delicate chain, engravings of runes, magical shimmer, single bell' },
  arcanist_cap:        { label: "Arcanist's Pointed Cap", desc: 'dark purple pointed wizard hat for a cat, crescent moon and star embroidery, magical scholar aesthetic, ornate trim' },
  crown_of_embers:     { label: 'Crown of Nine Embers', desc: 'miniature golden crown with nine ruby gemstones glowing with inner fire, regal ornate detail, warm ember light' },
  crimson_mantle:      { label: 'Crimson Mantle', desc: 'deep crimson red velvet cloak cape, fur-trimmed edges, dramatic flowing fabric, medieval noble aesthetic' },
  ironwolf_helm:       { label: 'Ironwolf War Helm', desc: 'small wolf-shaped iron helm for a cat, Stark direwolf design, hammered metal, battle-worn, fierce' },
  ravens_pauldron:     { label: "Raven's Pauldron", desc: 'single black metal shoulder pauldron with a perched raven decoration, dark iron, Night's Watch aesthetic' },
  halo_of_the_first_sun: { label: 'Halo of the First Sun', desc: 'glowing golden halo ring, carved with ancient god runes, warm divine light emanating, floating ethereal' },
  gilded_wings:        { label: 'Gilded Wings of Valyria', desc: 'ornate golden wings, hammered Valyrian gold, large feathered spread, ancient dragonlord craftsmanship' },
  dragon_wings:        { label: 'Wings of Balerion', desc: 'massive black leathery dragon wings, Balerion the Black Dread scale, dark and imposing, membrane with red veins' },
};

const FOODS = {
  kibble:          { label: 'Kibble', desc: 'small bowl of dry cat kibble pellets, rustic wooden bowl, warm simple food' },
  tuna_can:        { label: 'Tuna Can', desc: 'opened tin can of tuna fish, glistening chunks, ocean fresh' },
  wet_food_bowl:   { label: 'Wet Food Bowl', desc: 'bowl of premium wet cat food, rich gravy, aromatic steam' },
  chicken_broth:   { label: 'Chicken Broth', desc: 'steaming golden chicken broth in a small bowl, rich and warming, herbs floating' },
  gourmet_salmon:  { label: 'Gourmet Salmon', desc: 'perfectly seared salmon fillet with herb garnish, restaurant quality, vibrant pink and orange' },
  roast_chicken:   { label: 'Roast Chicken', desc: 'roasted chicken leg quarter, golden brown crispy skin, medieval feast style' },
  golden_fish:     { label: 'Golden Fish', desc: 'magical golden glowing fish, ornate scales, shimmering light, fantasy treasure' },
  catnip_leaf:     { label: 'Catnip Leaf', desc: 'fresh bright green catnip sprig with leaves, dew drops, vibrant and fragrant' },
  stardust_salmon: { label: 'Stardust Salmon', desc: 'mystical glowing salmon encrusted with star-like sparkles, purple and gold magical aura, legendary food' },
  phoenix_feather: { label: 'Phoenix Feather', desc: 'single glowing phoenix feather, fiery orange and gold, magical warmth radiating, legendary healing item' },
};

// ─── Replicate API helpers ─────────────────────────────────────────────────

async function replicatePredict(prompt, { width, height, outputFormat = 'png' }) {
  const body = {
    version: null,
    input: {
      prompt,
      width,
      height,
      output_format: outputFormat,
      output_quality: 95,
      safety_tolerance: 2,
      prompt_upsampling: true,
    },
  };

  const res = await fetch(`https://api.replicate.com/v1/models/${FLUX_MODEL}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Replicate API error ${res.status}: ${err}`);
  }

  const prediction = await res.json();

  // Prefer: wait should resolve immediately — poll if not
  if (prediction.status === 'succeeded') {
    return prediction.output?.[0] || prediction.output;
  }

  // Poll
  const pollUrl = prediction.urls?.get;
  if (!pollUrl) throw new Error('No poll URL returned from Replicate');

  for (let i = 0; i < 120; i++) {
    await sleep(2000);
    const poll = await fetch(pollUrl, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const p = await poll.json();
    if (p.status === 'succeeded') return p.output?.[0] || p.output;
    if (p.status === 'failed') throw new Error(`Prediction failed: ${p.error}`);
  }
  throw new Error('Timed out waiting for prediction');
}

async function downloadFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(buf));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Generators ───────────────────────────────────────────────────────────

async function generateCats() {
  console.log('\n🐱  Generating cat breed portraits…');
  const outDir = path.join(ROOT, 'public/companion/breeds');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [key, breed] of Object.entries(BREEDS)) {
    const outPath = path.join(outDir, `${key}.png`);
    if (fs.existsSync(outPath)) {
      console.log(`  ⏭  ${breed.label} — already exists, skipping`);
      continue;
    }
    const prompt = `${STYLE_PREAMBLE}, ${breed.desc}, isolated on pure black background, no props, centered composition, portrait orientation, ultra detailed fur and eyes, expressive face, full body visible`;
    console.log(`  ⏳  ${breed.label}…`);
    try {
      const url = await replicatePredict(prompt, { width: 512, height: 512 });
      await downloadFile(url, outPath);
      console.log(`  ✅  ${breed.label} → breeds/${key}.png`);
    } catch (e) {
      console.error(`  ❌  ${breed.label}: ${e.message}`);
    }
  }
}

async function generateRooms() {
  console.log('\n🏰  Generating room backgrounds…');
  const outDir = path.join(ROOT, 'public/companion/rooms');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [key, room] of Object.entries(ROOMS)) {
    const outPath = path.join(outDir, `${key}.jpg`);
    if (fs.existsSync(outPath)) {
      console.log(`  ⏭  ${room.label} — already exists, skipping`);
      continue;
    }
    const prompt = `${STYLE_PREAMBLE}, ${room.desc}, no people, no cats, empty interior scene, wide establishing shot, cinematic composition, depth of field`;
    console.log(`  ⏳  ${room.label}…`);
    try {
      const url = await replicatePredict(prompt, { width: 1024, height: 576, outputFormat: 'jpg' });
      await downloadFile(url, outPath);
      console.log(`  ✅  ${room.label} → rooms/${key}.jpg`);
    } catch (e) {
      console.error(`  ❌  ${room.label}: ${e.message}`);
    }
  }
}

async function generateAccessories() {
  console.log('\n⚔️   Generating accessory renders…');
  const outDir = path.join(ROOT, 'public/companion/accessories');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [key, acc] of Object.entries(ACCESSORIES)) {
    const outPath = path.join(outDir, `${key}.png`);
    if (fs.existsSync(outPath)) {
      console.log(`  ⏭  ${acc.label} — already exists, skipping`);
      continue;
    }
    const prompt = `${STYLE_PREAMBLE}, ${acc.desc}, product render, isolated on solid black background, no cat, centered, ultra detailed, dramatic studio lighting`;
    console.log(`  ⏳  ${acc.label}…`);
    try {
      const url = await replicatePredict(prompt, { width: 512, height: 512 });
      await downloadFile(url, outPath);
      console.log(`  ✅  ${acc.label} → accessories/${key}.png`);
    } catch (e) {
      console.error(`  ❌  ${acc.label}: ${e.message}`);
    }
  }
}

async function generateFoods() {
  console.log('\n🍗  Generating food item renders…');
  const outDir = path.join(ROOT, 'public/companion/foods');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [key, food] of Object.entries(FOODS)) {
    const outPath = path.join(outDir, `${key}.png`);
    if (fs.existsSync(outPath)) {
      console.log(`  ⏭  ${food.label} — already exists, skipping`);
      continue;
    }
    const prompt = `${STYLE_PREAMBLE}, ${food.desc}, isolated on dark background, centered, professional food photography style, vibrant rich colors, highly detailed`;
    console.log(`  ⏳  ${food.label}…`);
    try {
      const url = await replicatePredict(prompt, { width: 512, height: 512 });
      await downloadFile(url, outPath);
      console.log(`  ✅  ${food.label} → foods/${key}.png`);
    } catch (e) {
      console.error(`  ❌  ${food.label}: ${e.message}`);
    }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const all = args.length === 0;
const doCats        = all || args.includes('--cats');
const doRooms       = all || args.includes('--rooms');
const doAccessories = all || args.includes('--accessories');
const doFoods       = all || args.includes('--foods');

console.log('🐾  Meow Ops — Companion Asset Generator');
console.log('   Model: flux-1.1-pro via Replicate');
const total =
  (doCats ? Object.keys(BREEDS).length : 0) +
  (doRooms ? Object.keys(ROOMS).length : 0) +
  (doAccessories ? Object.keys(ACCESSORIES).length : 0) +
  (doFoods ? Object.keys(FOODS).length : 0);
console.log(`   Queued: up to ${total} images (skips existing files)`);

if (doCats)        await generateCats();
if (doRooms)       await generateRooms();
if (doAccessories) await generateAccessories();
if (doFoods)       await generateFoods();

console.log('\n✨  Done. Drop the public/ folder in Vercel deploy as-is — assets are served statically.');
