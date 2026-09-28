import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMouthCues, mouthShapeAt, mouthWeightsAt } from '../guide-mouth.mjs';

test('mouth timing follows audio position, including seeking and silence', () => {
  const cues = validateMouthCues({mouthCues:[{start:0,end:.1,value:'X'},{start:.1,end:.4,value:'D'},{start:.4,end:.6,value:'A'}]});
  assert.equal(mouthShapeAt(cues, .2), 'viseme_aa');
  assert.equal(mouthShapeAt(cues, .4), 'viseme_PP');
  assert.equal(mouthShapeAt(cues, .02), 'viseme_sil');
  assert.equal(mouthShapeAt(cues, .6), 'viseme_sil');
  assert.equal(mouthShapeAt(cues, NaN), 'viseme_sil');
});

test('mouth transitions blend continuously and deterministically across seeking and gaps', () => {
  const cues = validateMouthCues({ mouthCues: [{ start: 0, end: .2, value: 'D' }, { start: .2, end: .4, value: 'A' }, { start: .5, end: .52, value: 'F' }] });
  const midpoint = mouthWeightsAt(cues, .22);
  assert.ok(Math.abs(midpoint.viseme_aa - .5) < 1e-10);
  assert.ok(Math.abs(midpoint.viseme_PP - .5) < 1e-10);
  assert.deepEqual(mouthWeightsAt(cues, .2), { viseme_aa: 1, viseme_PP: 0 });
  assert.deepEqual(mouthWeightsAt(cues, .45), { viseme_sil: 1 });
  for (let time = 0; time < .6; time += .001) {
    const weights = Object.values(mouthWeightsAt(cues, time));
    assert.ok(weights.every(weight => weight >= 0 && weight <= 1));
    assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-10);
  }
  mouthWeightsAt(cues, .51);
  assert.deepEqual(mouthWeightsAt(cues, .22), midpoint);
  assert.deepEqual(mouthWeightsAt(cues, NaN), { viseme_sil: 1 });
});
test('silent mouth weights reuse one immutable frame value', () => {
  const first = mouthWeightsAt(null, 0);
  assert.equal(first, mouthWeightsAt(null, 0));
  assert.equal(Object.isFrozen(first), true);
});
test('invalid or overlapping timings cannot drive the face', () => {
  for (const mouthCues of [[], [null], [42], [{start:0,end:1,value:'unknown'}], [{start:0,end:-1,value:'A'}],
    [{start:0,end:1,value:'A'},{start:.5,end:2,value:'B'}], [{start:0,end:Infinity,value:'A'}]]) {
    assert.equal(validateMouthCues({mouthCues}), null);
  }
  const safe = validateMouthCues({metadata:{soundFile:'/private/fixture.wav'},mouthCues:[{start:0,end:1,value:'D',private:'excluded'}]});
  assert.deepEqual(safe, [{start:0,end:1,value:'D'}]);
});
