import * as THREE from 'three';

export function measureGuideAnimationBounds(model, clips) {
  const mixer = new THREE.AnimationMixer(model);
  const bounds = new THREE.Box3();
  for (const clip of clips) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const keyTimes = new Set([0, clip.duration]);
    for (const track of clip.tracks) {
      for (const time of track.times) keyTimes.add(time);
    }
    const orderedKeyTimes = [...keyTimes].sort((left, right) => left - right);
    const sampleTimes = new Set(orderedKeyTimes);
    for (let index = 1; index < orderedKeyTimes.length; index++) {
      sampleTimes.add((orderedKeyTimes[index - 1] + orderedKeyTimes[index]) / 2);
    }
    for (const time of [...sampleTimes].sort((left, right) => left - right)) {
      mixer.setTime(time);
      model.updateMatrixWorld(true);
      bounds.union(new THREE.Box3().setFromObject(model, true));
    }
    action.stop();
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(model);
  if (bounds.isEmpty()) throw new Error('Guide animation bounds unavailable');
  const margin = Math.max(bounds.getSize(new THREE.Vector3()).length() * 0.01, 0.005);
  return bounds.expandByScalar(margin);
}
