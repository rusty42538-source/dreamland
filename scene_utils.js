// Общее для сайта и видео: склейка неподвижных объектов, дешёвые материалы, дневное освещение и небо.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// все неподвижные объекты одного материала склеиваются в одну сетку — меньше обращений к видеокарте
export function mergeStatic(scene) {
  scene.updateMatrixWorld(true);
  const groups = new Map(), victims = [];
  scene.traverse(o => {
    if (!o.isMesh || Array.isArray(o.material) || o.material.transparent) return;
    for (let p = o; p; p = p.parent) if (p.userData.dynamic) return;
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld); if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k) || (k === 'color' && !o.material.vertexColors)) g.deleteAttribute(k);
    g.clearGroups();
    if (!groups.has(o.material.uuid)) groups.set(o.material.uuid, { mat: o.material, list: [], shadow: o.castShadow });
    groups.get(o.material.uuid).list.push(g); victims.push(o);
  });
  victims.forEach(v => v.parent.remove(v));
  for (const { mat, list, shadow } of groups.values()) { const m = new THREE.Mesh(mergeGeometries(list, false), mat); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); }
}

// Standard → Lambert: на телефонах вдвое дешевле считать свет (цвет общий, анимированные материалы не трогаем)
export function cheapMaterials(root) {
  const cache = new Map();
  root.traverse(o => { if (!o.isMesh) return; const swap = m => { if (!m || !m.isMeshStandardMaterial || (m.emissive && m.emissive.getHex() !== 0)) return m; if (cache.has(m)) return cache.get(m);
      const n = new THREE.MeshLambertMaterial({ color: m.color, vertexColors: m.vertexColors, flatShading: m.flatShading, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity,
        transparent: m.transparent, opacity: m.opacity, map: m.map, side: m.side, depthWrite: m.depthWrite }); n.color = m.color; cache.set(m, n); return n; };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material); });
}

export function skyTex(top, mid, bot) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(0.6, mid); gr.addColorStop(1, bot); x.fillStyle = gr; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// вечный день: ночи в государстве нет — свет, небо и туман задаются один раз
export function applyDayLook(world) {
  const { sun, hemi, scene } = world;
  sun.intensity = 2.65; sun.color.set('#ffd9a0'); hemi.intensity = 1.2; hemi.color.set('#ffeacc'); hemi.groundColor.set('#5d7a3a');
  scene.background = skyTex('#7fb8e6', '#cfe3ef', '#f7dcb0'); scene.fog.color.set('#efdcb9');
}
