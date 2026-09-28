import { AnimationMixer, LoopOnce, LoopRepeat } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

/** An instance owns its bones and mixer; geometry, textures and materials stay shared. */
export function createChampionInstance(source, clips) {
  const root = clone(source);
  const mixer = new AnimationMixer(root);
  const available = new Map(clips.map(clip => [clip.name, clip]));
  let action = null;
  let disposed = false;
  return {
    root,
    mixer,
    play(name, { once = false, fade = .2 } = {}) {
      if (disposed) throw new Error('Character instance is disposed');
      const clip = available.get(name);
      if (!clip) throw new Error(`Missing character clip: ${name}`);
      const next = mixer.clipAction(clip);
      if (next === action) return;
      const previous = action;
      next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
      next.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
      next.clampWhenFinished = once;
      next.play();
      if (previous) previous.crossFadeTo(next, fade, false);
      action = next;
    },
    restart() {
      if (disposed) throw new Error('Character instance is disposed');
      action?.reset().play();
    },
    update(delta) {
      if (!disposed) mixer.update(Math.min(Math.max(delta, 0), .1));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      const skeletons = new Set();
      root.traverse(object => {
        if (object.isSkinnedMesh) skeletons.add(object.skeleton);
      });
      for (const skeleton of skeletons) skeleton.dispose();
      root.removeFromParent();
    },
  };
}
