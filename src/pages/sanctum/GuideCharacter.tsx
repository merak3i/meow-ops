import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mouthWeightsAt } from './guide-mouth.mjs';
import { createGuideSetting } from './guide-setting';
import { disposeGuideResources } from './guide-resources';
import type { MouthCue } from './guide-mouth.mjs';
import modelUrl from './assets/guide-originalized-v92-runtime.glb?url';

export interface GuidePlayback { audio: HTMLAudioElement | null; cues: MouthCue[] | null }
export type GuideMotion = 'idle' | 'listening' | 'explaining_gesture';

export function GuideCharacter({ playback, motion }: { playback: RefObject<GuidePlayback>; motion: GuideMotion }) {
  const container = useRef<HTMLDivElement>(null);
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const [animateBody, setAnimateBody] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const animateRef = useRef(animateBody);
  animateRef.current = animateBody;
  const wakeRenderLoop = useRef<(() => void) | null>(null);
  useEffect(() => { wakeRenderLoop.current?.(); }, [motion, animateBody]);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAnimateBody(!preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  const [loaded, setLoaded] = useState(false);
  const [performanceSample, setPerformanceSample] = useState('');
  const [status, setStatus] = useState('Character construction · loads 9.8 MB on request.');
  useEffect(() => {
    if (!loaded || !container.current) return;
    const host = container.current;
    const controller = new AbortController();
    let disposed = false;
    let model: THREE.Group | undefined;
    let setting: THREE.Group | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    let observer: ResizeObserver | undefined;
    let loopActive = false;
    let wakeLoop: (() => void) | undefined;
    let onVisibilityChange: (() => void) | undefined;
    const contextLost = (event: Event) => {
      event.preventDefault();
      if (disposed) return;
      setStatus('Graphics were interrupted. Reload the character, or continue with text and speech.');
      setLoaded(false);
    };
    const releaseRenderer = () => {
      observer?.disconnect();
      if (!renderer) return;
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.setAnimationLoop(null);
      loopActive = false;
      if (onVisibilityChange) document.removeEventListener('visibilitychange', onVisibilityChange);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      renderer = undefined;
    };
    setStatus('Loading guide character…');
    setPerformanceSample('');
    const loadModel = async () => {
      const deadline = window.setTimeout(() => controller.abort(new DOMException('Guide asset load timed out', 'TimeoutError')), 45_000);
      const onAbort = () => rejectAbort(controller.signal.reason || new DOMException('Guide asset load aborted', 'AbortError'));
      let rejectAbort!: (reason: unknown) => void;
      const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
      controller.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await fetch(modelUrl, { signal: controller.signal });
        if (!response.ok) throw new Error('Guide asset unavailable');
        const bytes = await response.arrayBuffer();
        controller.signal.throwIfAborted();
        const parsing = new GLTFLoader()
          .parseAsync(bytes, new URL('.', new URL(modelUrl, window.location.href)).href)
          .then(gltf => {
            if (disposed || controller.signal.aborted) {
              disposeGuideResources(gltf.scene);
              throw controller.signal.reason || new DOMException('Guide asset load aborted', 'AbortError');
            }
            return gltf;
          });
        return await Promise.race([parsing, aborted]);
      } finally {
        window.clearTimeout(deadline);
        controller.signal.removeEventListener('abort', onAbort);
      }
    };
    void loadModel().then(gltf => {
      if (disposed) { disposeGuideResources(gltf.scene); return; }
      model = gltf.scene;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#172e31');
      setting = createGuideSetting();
      scene.add(model, setting, new THREE.HemisphereLight(0xe4edee, 0x66523c, 1.6));
      const light = new THREE.DirectionalLight(0xffecd1, 3);
      light.position.set(2, 3, 4); scene.add(light);
      const meshes: THREE.Mesh[] = [];
      model.traverse(object => { if (object instanceof THREE.Mesh && object.morphTargetDictionary) meshes.push(object); });
      const faceControls = meshes.flatMap(mesh => {
        const dictionary = mesh.morphTargetDictionary;
        const influences = mesh.morphTargetInfluences;
        if (!dictionary || !influences) return [];
        return [{
          influences,
          visemes: Object.entries(dictionary).filter(([name]) => name.startsWith('viseme_')),
          blinks: [dictionary.eyeBlinkLeft, dictionary.eyeBlinkRight].filter((index): index is number => index !== undefined),
        }];
      });
      const mixer = new THREE.AnimationMixer(model);
      const actions = new Map<GuideMotion, THREE.AnimationAction>();
      for (const name of ['idle', 'listening', 'explaining_gesture'] as const) {
        const clip = gltf.animations.find(item => item.name === name);
        if (!clip) throw new Error('Guide animation missing');
        actions.set(name, mixer.clipAction(clip));
      }
      if (!meshes.some(mesh => mesh.morphTargetDictionary?.viseme_aa !== undefined)) throw new Error('Guide face missing');
      let activeMotion: GuideMotion = 'idle';
      actions.get(activeMotion)?.play();
      const camera = new THREE.PerspectiveCamera(30, 1, .01, 100);
      camera.position.set(0, 1.55, 1.9); camera.lookAt(0, 1.45, 0);
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      host.append(renderer.domElement);
      const resize = () => {
        const { width, height } = host.getBoundingClientRect();
        if (!width || !height) return;
        renderer?.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
      };
      observer = new ResizeObserver(resize); observer.observe(host); resize();
      let lastFrameTime = 0;
      let sampleStart = 0;
      let frames = 0;
      let expressionTime = 0;
      const blinkStarts = [3.6, 8.7, 12.9, 18.9];
      const shouldAnimate = () => {
        const audio = playback.current.audio;
        return animateRef.current || motionRef.current !== 'idle' || Boolean(audio && !audio.paused && !audio.ended);
      };
      const renderFrame = (time: number) => {
        if (disposed || !renderer) return;
        if (document.hidden) {
          renderer.setAnimationLoop(null); loopActive = false;
          lastFrameTime = 0; sampleStart = 0; frames = 0;
          return;
        }
        const delta = lastFrameTime ? Math.min(Math.max((time - lastFrameTime) / 1000, 0), .1) : 0;
        lastFrameTime = time;
        const desiredMotion = animateRef.current ? motionRef.current : 'idle';
        if (activeMotion !== desiredMotion) {
          const previous = actions.get(activeMotion);
          activeMotion = desiredMotion;
          const next = actions.get(activeMotion);
          if (!animateRef.current) mixer.stopAllAction();
          next?.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
          if (animateRef.current && previous && next) next.crossFadeFrom(previous, .25, false);
        }
        mixer.update(animateRef.current ? delta : 0);
        if (animateRef.current) expressionTime += delta;
        // Uneven pauses keep the quiet idle face from staring continuously.
        const blinkTime = expressionTime % 24;
        let blink = 0;
        if (animateRef.current) {
          for (const start of blinkStarts) {
            const phase = (blinkTime - start) / .2;
            if (phase >= 0 && phase <= 1) blink = Math.sin(phase * Math.PI) ** 2;
          }
        }
        const { audio, cues } = playback.current;
        const weights = audio && !audio.paused && !audio.ended ? mouthWeightsAt(cues, audio.currentTime) : mouthWeightsAt(null, 0);
        for (const { influences, visemes, blinks } of faceControls) {
          for (const [name, index] of visemes) influences[index] = (weights[name] || 0) * .65;
          for (const index of blinks) influences[index] = blink;
        }
        renderer.render(scene, camera);
        if (import.meta.env.DEV) {
          if (!sampleStart) sampleStart = time;
          else frames++;
          if (time - sampleStart >= 2000) {
            const { calls, triangles } = renderer.info.render;
            setPerformanceSample(`${(frames * 1000 / (time - sampleStart)).toFixed(1)} FPS · ${calls} draw calls · ${triangles.toLocaleString()} triangles · ${renderer.domElement.width} × ${renderer.domElement.height} drawing buffer`);
            sampleStart = time; frames = 0;
          }
        }
        if (!shouldAnimate() && loopActive) {
          renderer.setAnimationLoop(null);
          loopActive = false;
          lastFrameTime = 0;
        }
      };
      const syncRenderLoop = () => {
        if (disposed || !renderer) return;
        if (document.hidden) {
          renderer.setAnimationLoop(null); loopActive = false;
          lastFrameTime = 0; sampleStart = 0; frames = 0;
        } else if (shouldAnimate()) {
          if (!loopActive) { loopActive = true; renderer.setAnimationLoop(renderFrame); }
        } else if (!loopActive) renderFrame(performance.now());
      };
      wakeLoop = syncRenderLoop;
      wakeRenderLoop.current = syncRenderLoop;
      onVisibilityChange = syncRenderLoop;
      document.addEventListener('visibilitychange', onVisibilityChange);
      syncRenderLoop();
      setStatus('Character study loaded. Local Voicebox speech drives the mouth when alignment is available.');
    }).catch(() => {
      if (!disposed) {
        setStatus(controller.signal.reason?.name === 'TimeoutError'
          ? 'Character load timed out. Retry, or continue with text and speech.'
          : 'Character unavailable. Retry loading, or continue with text and speech.');
        setLoaded(false);
      }
      releaseRenderer();
      if (model) { disposeGuideResources(model); model = undefined; }
      if (setting) { disposeGuideResources(setting); setting = undefined; }
    });
    return () => {
      disposed = true; controller.abort(); releaseRenderer();
      if (wakeRenderLoop.current === wakeLoop) wakeRenderLoop.current = null;
      if (model) disposeGuideResources(model);
      if (setting) disposeGuideResources(setting);
    };
  }, [loaded, playback]);
  return <section aria-label="Guide character">
    {!loaded && <button onClick={() => setLoaded(true)}>Load guide character</button>}
    {loaded && <button onClick={() => { setLoaded(false); setStatus('Character hidden. Text and speech remain available.'); }}>Hide character</button>}
    {loaded && <label><input type="checkbox" checked={animateBody} onChange={event => setAnimateBody(event.target.checked)} />Animate character · speech mouth cues remain available</label>}
    <div className={loaded ? 'guide-character' : undefined} ref={container} />
    <p>{status}</p>
    {import.meta.env.DEV && loaded && performanceSample && <output aria-label="Guide development rendering metrics">Development preview: {performanceSample}</output>}
  </section>;
}
