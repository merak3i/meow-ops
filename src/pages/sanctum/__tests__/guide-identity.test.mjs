import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../guide-identity.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace("'three'", JSON.stringify(import.meta.resolve('three')));
const { applyOriginalizedGuideIdentity } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('guide keeps charcoal workwear, archive fittings, and the authored Archive Seal', () => {
  const model = new THREE.Group();
  const skinTexture = new THREE.Texture({ width: 64, height: 32 });
  const skin = new THREE.MeshStandardMaterial({ color: '#462418', map: skinTexture });
  skin.name = 'Guide.Body.body.001';
  const coat = new THREE.MeshStandardMaterial({ color: '#28292a' });
  coat.name = 'Guide | original archive coat charcoal v50';
  const trousers = new THREE.MeshStandardMaterial({ color: '#242526' });
  trousers.name = 'Guide | original archive trousers charcoal v50';
  const yokeMesh = new THREE.Mesh(new THREE.BoxGeometry(), coat);
  yokeMesh.name = 'GuideAsymmetric_archive_shoulder_yoke_v102';
  const tabs = new THREE.MeshStandardMaterial({ color: '#53746e' });
  tabs.name = 'Guide | archive stitch teal v50';
  const tabsMesh = new THREE.Mesh(new THREE.BoxGeometry(), tabs);
  tabsMesh.name = 'GuideThree_archive_page-corner_tabs_v102';
  const archiveSealGeometry = new THREE.PlaneGeometry(0.06, 0.06);
  const archiveSealMesh = new THREE.Mesh(archiveSealGeometry, new THREE.MeshStandardMaterial());
  archiveSealMesh.name = 'Guide.Archive Seal v33';
  model.add(new THREE.Mesh(new THREE.BoxGeometry(), skin), new THREE.Mesh(new THREE.BoxGeometry(), coat),
    new THREE.Mesh(new THREE.BoxGeometry(), trousers), yokeMesh, tabsMesh, archiveSealMesh);

  applyOriginalizedGuideIdentity(model);

  assert.equal(skin.color.getHexString(), '462418');
  assert.equal(skin.map, skinTexture);
  assert.equal(coat.color.getHexString(), '28292a');
  assert.equal(trousers.color.getHexString(), '242526');
  assert.notEqual(yokeMesh.material, coat);
  assert.equal(yokeMesh.material.color.getHexString(), '9a744d');
  assert.notEqual(tabsMesh.material, tabs);
  assert.equal(tabsMesh.material.color.getHexString(), 'bd8750');
  archiveSealMesh.geometry.computeBoundingBox();
  assert.ok(Math.abs(archiveSealMesh.geometry.boundingBox.max.x - archiveSealMesh.geometry.boundingBox.min.x - 0.099) < 0.0001);
  archiveSealGeometry.computeBoundingBox();
  assert.ok(Math.abs(archiveSealGeometry.boundingBox.max.x - archiveSealGeometry.boundingBox.min.x - 0.06) < 0.0001);
  const names = [];
  model.traverse(object => names.push(object.name.toLowerCase()));
  assert.ok(names.every(name => !/krishna|flute|peacock|tilak|saffron/.test(name)));
});

test('guide identity fails clearly when an archive element or garment material is missing', () => {
  const model = new THREE.Group();
  assert.throws(() => applyOriginalizedGuideIdentity(model), /originalized archive elements missing/);
});
