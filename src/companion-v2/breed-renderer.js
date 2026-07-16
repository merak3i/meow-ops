// Pure breed-to-pixel composition helpers. Kept independent from React/canvas
// so every saved breed can be verified without a browser runtime.

const BASE_PALETTE = [
  'transparent',
  '#1a0d05',
  '#d88846',
  '#8a4d22',
  '#f0c890',
  '#faecd0',
  '#f59999',
  '#bce070',
  '#0a0500',
  '#888888',
  '#62a8e8',
];

function mixWithWhite(hex, amount = 0.32) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) return hex;
  const channel = (value) => Math.round(Number.parseInt(value, 16) * (1 - amount) + 255 * amount)
    .toString(16)
    .padStart(2, '0');
  return `#${channel(match[1])}${channel(match[2])}${channel(match[3])}`;
}

/** Map the authored sprite's semantic palette slots to one saved breed. */
export function buildBreedPalette(breed) {
  if (!breed?.palette) return BASE_PALETTE;
  const { body, accent, belly, eyes, nose } = breed.palette;
  return [
    'transparent',
    BASE_PALETTE[1],
    body,
    accent,
    mixWithWhite(body),
    belly,
    nose,
    eyes,
    BASE_PALETTE[8],
    BASE_PALETTE[9],
    BASE_PALETTE[10],
  ];
}

function patternedPixel(pattern, x, y, width, height) {
  switch (pattern) {
    case 'stripes':
      return y % 4 === 1 && x % 3 !== 0 ? 'D' : 'F';
    case 'spots':
      return (x * 3 + y * 5) % 11 < 2 ? 'D' : 'F';
    case 'patches': {
      const patch = (Math.floor(x / 4) + Math.floor(y / 3) * 2) % 7;
      return patch === 0 ? 'D' : patch === 4 ? 'L' : 'F';
    }
    case 'colorpoint': {
      const edge = x < width * 0.18 || x > width * 0.82;
      const face = y < height * 0.44 && x > width * 0.28 && x < width * 0.72;
      const paws = y > height * 0.84;
      return edge || face || paws ? 'D' : 'F';
    }
    case 'tuxedo': {
      const chest = y > height * 0.42 && x > width * 0.31 && x < width * 0.69;
      const paws = y > height * 0.86;
      return chest || paws ? 'C' : 'F';
    }
    default:
      return 'F';
  }
}

/** Apply a deterministic pattern mask without changing sprite dimensions. */
export function applyBreedPattern(sprite, breed) {
  const pattern = breed?.silhouette?.pattern ?? 'solid';
  if (pattern === 'solid') return sprite;
  const height = sprite.length;
  return sprite.map((row, y) => {
    const width = row.length;
    return Array.from(row, (pixel, x) => (
      pixel === 'F' ? patternedPixel(pattern, x, y, width, height) : pixel
    )).join('');
  });
}
