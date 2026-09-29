import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../guide-identity.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace("'three'", JSON.stringify(import.meta.resolve('three')));
const { applyKrishnaGuideIdentity } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('guide runtime gets a blue-gray skin tint and rig-bound Krishna-inspired accents', () => {
  const model = new THREE.Group();
  const head = new THREE.Bone();
  head.name = 'head';
  const hand = new THREE.Bone();
  hand.name = 'hand_r';
  const pelvis = new THREE.Bone();
  pelvis.name = 'pelvis';
  const skin = new THREE.MeshStandardMaterial({ color: '#462418' });
  skin.name = 'Guide.Body.body.001';
  const coat = new THREE.MeshStandardMaterial({ color: '#111111' });
  coat.name = 'Guide | original archive coat charcoal v50';
  const trousers = new THREE.MeshStandardMaterial({ color: '#111111' });
  trousers.name = 'Guide | original archive trousers charcoal v50';
  const yokeMesh = new THREE.Mesh(new THREE.BoxGeometry(), coat);
  yokeMesh.name = 'GuideAsymmetric_archive_shoulder_yoke_v102';
  const tabs = new THREE.MeshStandardMaterial({ color: '#111111' });
  tabs.name = 'Guide | archive stitch teal v50';
  const tabsMesh = new THREE.Mesh(new THREE.BoxGeometry(), tabs);
  tabsMesh.name = 'GuideThree_archive_page-corner_tabs_v102';
  const archiveSealMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), new THREE.MeshStandardMaterial());
  archiveSealMesh.name = 'Guide.Archive Seal v33';
  const body = new THREE.Mesh(new THREE.BoxGeometry(), skin);
  model.add(head, hand, pelvis, body, new THREE.Mesh(new THREE.BoxGeometry(), coat),
    new THREE.Mesh(new THREE.BoxGeometry(), trousers), yokeMesh, tabsMesh, archiveSealMesh);

  applyKrishnaGuideIdentity(model);

  assert.equal(skin.color.getHexString(), '6b99c4');
  assert.equal(coat.color.getHexString(), '4e6898');
  assert.notEqual(yokeMesh.material, coat);
  assert.equal(trousers.color.getHexString(), '344b70');
  assert.equal(yokeMesh.material.color.getHexString(), '9a744d');
  assert.equal(tabsMesh.material.color.getHexString(), 'bd8750');
  archiveSealMesh.geometry.computeBoundingBox();
  assert.ok(Math.abs(archiveSealMesh.geometry.boundingBox.max.x - archiveSealMesh.geometry.boundingBox.min.x - 0.099) < 0.0001);
  assert.equal(head.getObjectByName('Guide.Krishna-inspired peacock feather')?.children.length, 6);
  const flute = hand.getObjectByName('Guide.Krishna-inspired bamboo page pointer');
  assert.ok(flute);
  assert.equal(flute.children.filter(child => child.name === 'Guide.Bamboo flute finger hole').length, 6);
  assert.equal(flute.children.filter(child => child.name === 'Guide.Bamboo flute copper binding').length, 2);
  assert.equal(pelvis.getObjectByName('Guide.Krishna-inspired asymmetric archive coat tails')?.children.length, 3);
});

test('guide identity fails clearly when the runtime rig or skin material is incomplete', () => {
  const model = new THREE.Group();
  const head = new THREE.Bone();
  head.name = 'head';
  const hand = new THREE.Bone();
  hand.name = 'hand_r';
  const pelvis = new THREE.Bone();
  pelvis.name = 'pelvis';
  model.add(head, hand, pelvis);
  assert.throws(() => applyKrishnaGuideIdentity(model), /identity materials missing/);
});

test('skin texture keeps its luminance and is hue-tinted blue-gray', t => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const operations = [];
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (...args) => operations.push(['drawImage', ...args]),
        fillRect: (...args) => operations.push(['fillRect', ...args]),
        globalCompositeOperation: 'source-over',
        fillStyle: '',
      }),
    }),
  };
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });

  const model = new THREE.Group();
  const head = new THREE.Bone(); head.name = 'head';
  const hand = new THREE.Bone(); hand.name = 'hand_r';
  const pelvis = new THREE.Bone(); pelvis.name = 'pelvis';
  const skin = new THREE.MeshStandardMaterial({ map: new THREE.Texture({ width: 64, height: 32 }) });
  skin.name = 'Guide.Body.body.001';
  const coat = new THREE.MeshStandardMaterial(); coat.name = 'Guide | original archive coat charcoal v50';
  const trousers = new THREE.MeshStandardMaterial(); trousers.name = 'Guide | original archive trousers charcoal v50';
  const yokeMesh = new THREE.Mesh(new THREE.BoxGeometry(), coat); yokeMesh.name = 'GuideAsymmetric_archive_shoulder_yoke_v102';
  const tabs = new THREE.MeshStandardMaterial(); tabs.name = 'Guide | archive stitch teal v50';
  const tabsMesh = new THREE.Mesh(new THREE.BoxGeometry(), tabs); tabsMesh.name = 'GuideThree_archive_page-corner_tabs_v102';
  const archiveSealMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), new THREE.MeshStandardMaterial());
  archiveSealMesh.name = 'Guide.Archive Seal v33';
  model.add(head, hand, pelvis, new THREE.Mesh(new THREE.BoxGeometry(), skin),
    new THREE.Mesh(new THREE.BoxGeometry(), coat), new THREE.Mesh(new THREE.BoxGeometry(), trousers), yokeMesh, tabsMesh, archiveSealMesh);
  applyKrishnaGuideIdentity(model);

  assert.equal(operations.filter(([name]) => name === 'drawImage').length, 1);
  assert.equal(operations.filter(([name]) => name === 'fillRect').length, 2);
  assert.equal(skin.color.getHexString(), 'ffffff');
  assert.deepEqual([skin.map.image.width, skin.map.image.height], [64, 32]);
});
