// 20 cat breeds for the Companion. Each entry defines:
// - palette: body / accent / belly / eyes / nose colors used by CompanionCat.jsx
// - silhouette: ear shape, fur length, body shape, tail length, pattern type
// - traits: short string for the BreedPicker UI
//
// Patterns are rendered as SVG overlays in CompanionCat:
//   solid     — flat body color
//   stripes   — horizontal darker stripes
//   spots     — small darker dots
//   patches   — random tri-color blobs
//   colorpoint — darker face/ears/paws/tail
//   tuxedo    — white chest + paws on dark body

export const COMPANION_BREEDS = {
  persian: {
    label: 'Persian',
    traits: 'Plush, regal, slow to warm',
    palette: { body: '#f1e8d8', accent: '#d9c8aa', belly: '#fbf6ec', eyes: '#d18a3b', nose: '#c98b7a' },
    silhouette: { ear: 'pointed', fur: 'long', body: 'plush', tail: 'long', pattern: 'solid' },
  },
  siamese: {
    label: 'Siamese',
    traits: 'Sleek, vocal, sapphire-eyed',
    palette: { body: '#ead8b8', accent: '#5b4327', belly: '#f3e6ce', eyes: '#3f7fc8', nose: '#3a2a1a' },
    silhouette: { ear: 'pointed', fur: 'short', body: 'sleek', tail: 'long', pattern: 'colorpoint' },
  },
  tabby: {
    label: 'Tabby',
    traits: 'Classic, curious, never still',
    palette: { body: '#d7892f', accent: '#7a4513', belly: '#f1d29c', eyes: '#5ca35a', nose: '#a85a3a' },
    silhouette: { ear: 'pointed', fur: 'short', body: 'normal', tail: 'medium', pattern: 'stripes' },
  },
  blackShorthair: {
    label: 'Black Shorthair',
    traits: 'Mysterious, midnight-eyed',
    palette: { body: '#1c1c1c', accent: '#0a0a0a', belly: '#2a2a2a', eyes: '#7ac74f', nose: '#1a1a1a' },
    silhouette: { ear: 'pointed', fur: 'short', body: 'sleek', tail: 'medium', pattern: 'solid' },
  },
  whiteShorthair: {
    label: 'White Shorthair',
    traits: 'Snowdrift, ice-eyed, calm',
    palette: { body: '#f8f8f8', accent: '#dadada', belly: '#ffffff', eyes: '#7fcfe5', nose: '#e7a8a0' },
    silhouette: { ear: 'pointed', fur: 'short', body: 'normal', tail: 'medium', pattern: 'solid' },
  },
  calico: {
    label: 'Calico',
    traits: 'Tri-colour, opinionated',
    palette: { body: '#f4ead4', accent: '#c45a1c', belly: '#fffaee', eyes: '#5ca35a', nose: '#b87770' },
    silhouette: { ear: 'pointed', fur: 'medium', body: 'normal', tail: 'medium', pattern: 'patches' },
  },
  tuxedo: {
    label: 'Tuxedo',
    traits: 'Dressed for dinner, every day',
    palette: { body: '#1a1a1a', accent: '#0a0a0a', belly: '#f6f6f6', eyes: '#e8c840', nose: '#1a1a1a' },
    silhouette: { ear: 'pointed', fur: 'short', body: 'normal', tail: 'long', pattern: 'tuxedo' },
  },
  tortoiseshell: {
    label: 'Tortoiseshell',
    traits: 'Marbled, fierce, unrepeatable',
    palette: { body: '#5a3010', accent: '#c46818', belly: '#3a1f0a', eyes: '#c9a31f', nose: '#1a0a04' },
    silhouette: { ear: 'pointed', fur: 'medium', body: 'normal', tail: 'medium', pattern: 'patches' },
  },
  russianBlue: {
    label: 'Russian Blue',
    traits: 'Silvered ghost, emerald-eyed',
    palette: { body: '#7a8a96', accent: '#525e6a', belly: '#9aa9b4', eyes: '#3fa470', nose: '#3a4450' },
    silhouette: { ear: 'pointed', fur: 'short', body: 'sleek', tail: 'medium', pattern: 'solid' },
  },
  bengal: {
    label: 'Bengal',
    traits: 'Wild blood, leopard heart',
    palette: { body: '#dca35a', accent: '#5a3010', belly: '#f3e0b8', eyes: '#7ac74f', nose: '#7a4010' },
    silhouette: { ear: 'pointed', fur: 'short', body: 'sleek', tail: 'long', pattern: 'spots' },
  },
  maineCoon: {
    label: 'Maine Coon',
    traits: 'Mountain cat, tufted, vast',
    palette: { body: '#7a5230', accent: '#3a2410', belly: '#c4965a', eyes: '#c9a31f', nose: '#2a1a0a' },
    silhouette: { ear: 'tufted', fur: 'long', body: 'plush', tail: 'long', pattern: 'stripes' },
  },
  britishShorthair: {
    label: 'British Shorthair',
    traits: 'Round, dignified, copper-eyed',
    palette: { body: '#a3aab2', accent: '#6a727a', belly: '#c4cad2', eyes: '#d18a3b', nose: '#5a626a' },
    silhouette: { ear: 'pointed', fur: 'medium', body: 'plush', tail: 'medium', pattern: 'solid' },
  },
  scottishFold: {
    label: 'Scottish Fold',
    traits: 'Folded ears, gentle gaze',
    palette: { body: '#c8b89c', accent: '#9a8870', belly: '#e0d2b8', eyes: '#7b9ec4', nose: '#7a6a54' },
    silhouette: { ear: 'folded', fur: 'medium', body: 'normal', tail: 'medium', pattern: 'solid' },
  },
  ragdoll: {
    label: 'Ragdoll',
    traits: 'Limp in your arms, sapphire eyes',
    palette: { body: '#f3e8d6', accent: '#7a5030', belly: '#fff3e0', eyes: '#3f7fc8', nose: '#c98b7a' },
    silhouette: { ear: 'pointed', fur: 'long', body: 'plush', tail: 'long', pattern: 'colorpoint' },
  },
  norwegianForest: {
    label: 'Norwegian Forest',
    traits: 'Wild fur, viking soul',
    palette: { body: '#8a6a44', accent: '#3a2410', belly: '#c89a6a', eyes: '#5ca35a', nose: '#1a0a04' },
    silhouette: { ear: 'tufted', fur: 'long', body: 'plush', tail: 'long', pattern: 'stripes' },
  },
  savannah: {
    label: 'Savannah',
    traits: 'Long-legged, exotic spots',
    palette: { body: '#e0b070', accent: '#5a3010', belly: '#f5d8a8', eyes: '#c9a31f', nose: '#7a4010' },
    silhouette: { ear: 'pointed', fur: 'short', body: 'sleek', tail: 'long', pattern: 'spots' },
  },
  egyptianMau: {
    label: 'Egyptian Mau',
    traits: 'Spotted silver, ancient',
    palette: { body: '#c5cdd5', accent: '#3a4248', belly: '#dde4ea', eyes: '#7ac74f', nose: '#3a4248' },
    silhouette: { ear: 'pointed', fur: 'short', body: 'sleek', tail: 'long', pattern: 'spots' },
  },
  sphynx: {
    label: 'Sphynx',
    traits: 'Hairless, wrinkled, alien',
    palette: { body: '#e6c5a8', accent: '#a07050', belly: '#f3d8bc', eyes: '#c44040', nose: '#a05040' },
    silhouette: { ear: 'pointed', fur: 'short', body: 'sleek', tail: 'long', pattern: 'solid' },
  },
  korat: {
    label: 'Korat',
    traits: 'Silver-tipped, slate, sacred',
    palette: { body: '#6a7480', accent: '#3a4250', belly: '#8a939e', eyes: '#7ac74f', nose: '#2a323a' },
    silhouette: { ear: 'pointed', fur: 'short', body: 'sleek', tail: 'medium', pattern: 'solid' },
  },
  turkishVan: {
    label: 'Turkish Van',
    traits: 'Auburn cap, swimming cat',
    palette: { body: '#f6f3eb', accent: '#a04020', belly: '#ffffff', eyes: '#c9a31f', nose: '#a04020' },
    silhouette: { ear: 'pointed', fur: 'long', body: 'plush', tail: 'long', pattern: 'colorpoint' },
  },
};

export const BREED_LIST = Object.entries(COMPANION_BREEDS).map(([key, b]) => ({ key, ...b }));

export function getBreed(key) {
  return COMPANION_BREEDS[key] || COMPANION_BREEDS.tabby;
}
