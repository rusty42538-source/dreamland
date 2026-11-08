// Дикие звери для живого поселения
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// все детали склеиваются в одну сетку с цветами вершин: 1 вызов отрисовки на зверя вместо ~15
export const BAKED = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
export function bakeGroup(g) {
  g.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), parts = [];
  g.traverse(o => { if (!o.isMesh) return; let geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    const c = new THREE.Color(o.material.color), n = geo.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); parts.push(geo); });
  return new THREE.Mesh(mergeGeometries(parts, false), BAKED);
}

const BLOB = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false });
export function animal(kind) {
  const g = new THREE.Group(), m = c => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9 });
  const box = (w, h, d, c, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(c)); b.position.set(x, y, z); g.add(b); return b; };
  if (kind === 'deer') {
    box(1.1, 0.5, 0.42, '#9a6a3c', 0, 1.05, 0); box(0.3, 0.55, 0.28, '#9a6a3c', 0.6, 1.45, 0); box(0.38, 0.26, 0.26, '#8a5a30', 0.82, 1.68, 0);
    for (const sz of [-1, 1]) { for (const sx of [-1, 1]) box(0.1, 0.8, 0.1, '#7a5028', sx * 0.38, 0.4, sz * 0.14);
      const a = box(0.05, 0.45, 0.05, '#e8dcc4', 0.75, 2.0, sz * 0.12); a.rotation.z = sz * 0.3; }
    box(0.12, 0.16, 0.1, '#f2ead8', -0.58, 1.18, 0);
  } else if (kind === 'fox') {
    box(0.7, 0.3, 0.26, '#d9682a', 0, 0.45, 0); box(0.28, 0.24, 0.24, '#d9682a', 0.45, 0.6, 0); box(0.18, 0.1, 0.12, '#f4efe6', 0.62, 0.55, 0);
    for (const sz of [-1, 1]) { box(0.06, 0.14, 0.05, '#3a2418', 0.45, 0.78, sz * 0.08); for (const sx of [-1, 1]) box(0.06, 0.32, 0.06, '#3a2418', sx * 0.24, 0.16, sz * 0.09); }
    const t = box(0.5, 0.16, 0.16, '#d9682a', -0.55, 0.52, 0); t.rotation.z = 0.3; box(0.14, 0.14, 0.14, '#f4efe6', -0.8, 0.62, 0);
  } else if (kind === 'boar') {
    box(1.0, 0.55, 0.5, '#4a3a30', 0, 0.62, 0); box(0.38, 0.38, 0.36, '#3e3028', 0.62, 0.6, 0); box(0.12, 0.14, 0.16, '#d8a090', 0.84, 0.52, 0);
    for (const sz of [-1, 1]) { box(0.04, 0.12, 0.04, '#f2ead8', 0.82, 0.62, sz * 0.12); for (const sx of [-1, 1]) box(0.11, 0.35, 0.11, '#2e241e', sx * 0.32, 0.18, sz * 0.15); }
  } else if (kind === 'wolf') {
    box(0.95, 0.4, 0.36, '#6e6c6a', 0, 0.68, 0); box(0.34, 0.32, 0.3, '#6e6c6a', 0.6, 0.86, 0); box(0.24, 0.14, 0.16, '#5a5856', 0.82, 0.8, 0);
    for (const sz of [-1, 1]) { box(0.06, 0.18, 0.06, '#4e4c4a', 0.6, 1.1, sz * 0.1); for (const sx of [-1, 1]) box(0.1, 0.48, 0.1, '#5e5c5a', sx * 0.32, 0.24, sz * 0.12); }
    const t = box(0.5, 0.12, 0.12, '#5a5856', -0.65, 0.66, 0); t.rotation.z = 0.5;
  } else { // заяц
    box(0.42, 0.3, 0.26, '#a89a88', 0, 0.3, 0); box(0.2, 0.2, 0.18, '#a89a88', 0.24, 0.48, 0);
    for (const sz of [-1, 1]) box(0.05, 0.3, 0.06, '#a89a88', 0.22, 0.72, sz * 0.05);
    box(0.1, 0.1, 0.1, '#f4f0ea', -0.24, 0.36, 0);
  }
  const body = bakeGroup(g); body.castShadow = false; g.clear(); g.add(body);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(kind === 'deer' || kind === 'boar' ? 0.75 : 0.45, 12), BLOB);
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; g.add(blob);
  return g;
}
