import assert from 'node:assert/strict';
import test from 'node:test';

import { COMPANION_BREEDS } from '../../lib/companion-breeds.js';
import { applyBreedPattern, buildBreedPalette } from '../breed-renderer.js';

const SAMPLE_SPRITE = [
  '....FFFFFFFF....',
  '....FFFFFFFF....',
  '....FFFFFFFF....',
  '....CCCCCCCC....',
  '....FFFFFFFF....',
  '....FFFFFFFF....',
  '....FFFFFFFF....',
  '....FFFFFFFF....',
];

test('all 20 breeds produce distinct renderer palettes', () => {
  const signatures = Object.values(COMPANION_BREEDS).map((breed) => {
    const palette = buildBreedPalette(breed);
    assert.equal(palette[2], breed.palette.body);
    assert.equal(palette[3], breed.palette.accent);
    assert.equal(palette[5], breed.palette.belly);
    assert.equal(palette[6], breed.palette.nose);
    assert.equal(palette[7], breed.palette.eyes);
    return palette.join('|');
  });

  assert.equal(signatures.length, 20);
  assert.equal(new Set(signatures).size, 20);
});

test('breed pattern masks alter fur while preserving sprite geometry', () => {
  for (const pattern of ['stripes', 'spots', 'patches', 'colorpoint', 'tuxedo']) {
    const breed = { silhouette: { pattern } };
    const patterned = applyBreedPattern(SAMPLE_SPRITE, breed);

    assert.equal(patterned.length, SAMPLE_SPRITE.length, pattern);
    assert.ok(patterned.every((row, index) => row.length === SAMPLE_SPRITE[index].length), pattern);
    assert.notDeepEqual(patterned, SAMPLE_SPRITE, pattern);
  }
});

test('solid breeds keep the authored sprite pixels unchanged', () => {
  const solid = applyBreedPattern(SAMPLE_SPRITE, { silhouette: { pattern: 'solid' } });
  assert.deepEqual(solid, SAMPLE_SPRITE);
});
