// Живое поселение, версия 2.
// • Маршруты: сетка проходимости + поиск пути A* — жители обходят постройки целиком и не застревают.
// • Руки двигаются: ходьба, замах топором, молоток, бревно на плече, удочка, работа в поле.
// • Развитие: лесорубы заготавливают брёвна, из них по очереди строятся собственные дома жителей.
//   Всё считается от даты основания и реального московского времени — у всех зрителей одинаково.
// • Распорядок дня как у людей: подъём, завтрак, работа, обед, работа, ужин у костра, сон.
// • У каждого жителя есть профессия, опыт, дом, мечта и мысли.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { animal, bakeGroup } from './sim_animals.js';
import { FOUND_DAY, workFracAt, createLife, logsUntil, levelOf, multOf, titleOf, talentOf, RANKS, PLACE, BREAD, MEALS, BIZ, BUILD, buildCost, LOG_PRICE, ladder, wageOf, personName, PAYDAY, TRAITS, traitsOf, traitName, traitFx, setTraitOverrides, setGoals, goalOf, MAX_SHOPS, RESERVE } from './sim_life.js';

const MAX_SHOWN = 700;
const LUNCH_FROM = 13, LUNCH_TO = 13.7;
const HOUSE_COST = 16;                                                // дом — 16 брёвен; брёвен в день тем больше, чем опытнее лесорубы
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function seeded(seed) { let s = seed % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };

// фигурка без рук → одна геометрия с цветами вершин
function bake(group, skipArms) {
  group.updateMatrixWorld(true);
  const parts = [];
  group.traverse(o => {
    if (!o.isMesh) return;
    if (skipArms) for (let p = o; p; p = p.parent) if (p.userData.arm) return;
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld); if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const c = new THREE.Color(Array.isArray(o.material) ? o.material[0].color : o.material.color), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); parts.push(g);
  });
  return mergeGeometries(parts, false);
}

// ---------------- сетка проходимости и A* ----------------
class Nav {
  constructor(x0, z0, x1, z1, cell = 0.5) { this.x0 = x0; this.z0 = z0; this.c = cell; this.w = Math.ceil((x1 - x0) / cell); this.h = Math.ceil((z1 - z0) / cell); this.g = new Uint8Array(this.w * this.h); }
  idx(x, z) { const i = Math.floor((x - this.x0) / this.c), j = Math.floor((z - this.z0) / this.c); return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i; }
  center(k) { return [this.x0 + (k % this.w + 0.5) * this.c, this.z0 + (Math.floor(k / this.w) + 0.5) * this.c]; }
  pass(k, farm) { if (k < 0) return false; const v = this.g[k]; return v === 0 || (v === 2 && farm); }
  passAt(x, z, farm) { return this.pass(this.idx(x, z), farm); }
  flood() {   // находим самую большую связную область — это и есть поселение
    const W = this.w, N = this.g.length, lab = new Int32Array(N), sizes = [0]; let cur = 0;
    const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let s0 = 0; s0 < N; s0++) { if (lab[s0] || !this.pass(s0, true)) continue; cur++; let size = 0; const st = [s0]; lab[s0] = cur;
      while (st.length) { const k = st.pop(), i = k % W, j = (k - i) / W; size++;
        for (const [di, dj] of D8) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
          const nk = nj * W + ni; if (lab[nk] || !this.pass(nk, true)) continue; if (di && dj && (!this.pass(j * W + ni, true) || !this.pass(nj * W + i, true))) continue; lab[nk] = cur; st.push(nk); } }
      sizes.push(size); }
    let big = 1; for (let c = 1; c < sizes.length; c++) if (sizes[c] > sizes[big]) big = c;
    this.reach = new Uint8Array(N); for (let k = 0; k < N; k++) this.reach[k] = lab[k] === big ? 1 : 0; this.parts = sizes.length - 1; }
  ok(k, farm) { return this.pass(k, farm) && (!this.reach || this.reach[k]); }
  nearestFree(x, z, farm) {
    const k0 = this.idx(x, z); if (this.ok(k0, farm)) return k0;
    const ci = Math.floor((x - this.x0) / this.c), cj = Math.floor((z - this.z0) / this.c);
    for (let r = 1; r < 16; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue; const k = j * this.w + i; if (this.ok(k, farm)) return k; }
    return -1;
  }
  los(ax, az, bx, bz, farm) {   // прямая видимость с учётом ширины человека
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (this.c * 0.25)); if (d < 1e-6) return true;
    const px = -(bz - az) / d * 0.22, pz = (bx - ax) / d * 0.22;
    for (let s = 1; s < n; s++) { const t = s / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (!this.passAt(x, z, farm) || !this.passAt(x + px, z + pz, farm) || !this.passAt(x - px, z - pz, farm)) return false; } return true; }
  find(sx, sz, tx, tz, farm) {
    const s = this.nearestFree(sx, sz, farm), t = this.nearestFree(tx, tz, farm); if (s < 0 || t < 0) return null;
    if (s === t) return [[tx, tz]];
    const W = this.w, N = this.g.length, gS = this.gS ||= new Float32Array(N), from = this.from ||= new Int32Array(N), seen = this.seen ||= new Uint32Array(N);
    this.stamp = (this.stamp || 0) + 1; const st = this.stamp;
    const [tcx, tcz] = this.center(t), heur = k => { const [x, z] = this.center(k), dx = Math.abs(x - tcx), dz = Math.abs(z - tcz); return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)) / this.c; };
    const heap = [], push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    seen[s] = st; gS[s] = 0; from[s] = -1; push(s, heur(s));
    const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let found = false, iter = 0, best = s, bestH = heur(s);
    while (heap.length && iter++ < 80000) {
      const [, k] = pop(); if (k === t) { found = true; break; }
      const hk = heur(k); if (hk < bestH) { bestH = hk; best = k; }
      const i = k % W, j = (k - i) / W;
      for (const [di, dj, c] of D8) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const nk = nj * W + ni; if (!this.pass(nk, farm)) continue;
        if (di && dj && (!this.pass(j * W + ni, farm) || !this.pass(nj * W + i, farm))) continue;   // не срезаем углы
        const ng = gS[k] + c; if (seen[nk] === st && gS[nk] <= ng) continue;
        seen[nk] = st; gS[nk] = ng; from[nk] = k; push(nk, ng + heur(nk));
      }
    }
    if (!found && best === s) return null;
    const end = found ? t : best;   // цель недоступна — идём к ближайшей доступной точке
    const cells = []; for (let k = end; k !== -1; k = from[k]) cells.push(this.center(k)); cells.reverse(); if (found && this.passAt(tx, tz, farm)) cells[cells.length - 1] = [tx, tz];
    // сглаживаем: идём к самой дальней видимой точке
    const out = []; let cur = [sx, sz], i = 0;
    while (i < cells.length) { let j = cells.length - 1; while (j > i && !this.los(cur[0], cur[1], cells[j][0], cells[j][1], farm)) j--; out.push(cells[j]); cur = cells[j]; i = j + 1; }
    return out;
  }
}

// ---------------- дом жителя: от фундамента до крыши ----------------
const HM = {
  stone: new THREE.MeshStandardMaterial({ color: '#8f8a80', flatShading: true }), log: new THREE.MeshStandardMaterial({ color: '#9a6a3c', flatShading: true }),
  logDark: new THREE.MeshStandardMaterial({ color: '#7d5530', flatShading: true }), roof: new THREE.MeshStandardMaterial({ color: '#8a4a2a', flatShading: true }),
  door: new THREE.MeshStandardMaterial({ color: '#3a2618', flatShading: true }), win: new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffb24a', emissiveIntensity: 0, flatShading: true }),
  pole: new THREE.MeshStandardMaterial({ color: '#b08a58', flatShading: true }),
};
function houseModel(p) {               // p: 0..1 — готовность
  const g = new THREE.Group(), W = 3.0, L = 2.4;
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(W + 0.3, 0.25, L + 0.3), HM.stone, 0, 0.12, 0);
  const levels = Math.floor(clamp((p - 0.12) / 0.55, 0, 1) * 7);
  for (let k = 0; k < levels; k++) { const y = 0.38 + k * 0.27, m = k % 2 ? HM.logDark : HM.log;
    for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.14, 0.14, W + 0.25, 6), m, 0, y, sz * L / 2, 0, 0, Math.PI / 2);
    for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.14, 0.14, L + 0.25, 6), m, sx * W / 2, y + 0.13, 0, Math.PI / 2, 0, 0); }
  const top = 0.38 + 7 * 0.27;
  if (levels >= 3) { add(new THREE.BoxGeometry(0.62, 1.0, 0.06), HM.door, 0, 0.75, L / 2 + 0.12);
    if (levels >= 5) for (const sx of [-1, 1]) g.userData.win = add(new THREE.BoxGeometry(0.42, 0.36, 0.06), HM.win, sx * 0.95, 1.25, L / 2 + 0.12); }
  if (p >= 0.72) { const rp = clamp((p - 0.72) / 0.25, 0, 1);
    const sh = new THREE.Shape(); sh.moveTo(-W / 2 - 0.25, 0); sh.lineTo(W / 2 + 0.25, 0); sh.lineTo(0, 1.3 * rp + 0.05); sh.closePath();
    const gable = add(new THREE.ExtrudeGeometry(sh, { depth: L + 0.2, bevelEnabled: false }), HM.logDark, 0, top - 0.05, -(L + 0.2) / 2);
    if (rp > 0.4) for (const sx of [-1, 1]) add(new THREE.BoxGeometry(W / 2 + 0.55, 0.12, L + 0.6), HM.roof, sx * (W / 4 + 0.05), top + 0.62 * rp, 0, 0, 0, -sx * Math.atan2(1.3, W / 2 + 0.25));
    if (p >= 0.97) add(new THREE.BoxGeometry(0.38, 1.0, 0.38), HM.stone, W * 0.28, top + 1.0, -0.4); }
  if (p < 1) {                         // строительные леса и запас брёвен
    for (const [x, z] of [[-W / 2 - 0.45, L / 2 + 0.45], [W / 2 + 0.45, L / 2 + 0.45], [-W / 2 - 0.45, -L / 2 - 0.45], [W / 2 + 0.45, -L / 2 - 0.45]]) add(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 4), HM.pole, x, 1.4, z);
    for (let k = 0; k < 3; k++) add(new THREE.CylinderGeometry(0.13, 0.13, 2.2, 6), HM.log, -W / 2 - 1.1, 0.14 + k * 0.05, -0.4 + k * 0.28, Math.PI / 2, 0, 0);
  }
  return g;
}

let doneGeo = null;
const doneMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
function doneHouse() {
  if (!doneGeo) { const g = houseModel(1); g.traverse(o => { if (o.isMesh && o.material === HM.win) o.userData.skip = true; });
    g.updateMatrixWorld(true); const parts = [];
    g.traverse(o => { if (!o.isMesh || o.userData.skip) return; let ge = o.geometry.clone().applyMatrix4(o.matrixWorld); if (ge.index) ge = ge.toNonIndexed();
      for (const k of Object.keys(ge.attributes)) if (k !== 'position' && k !== 'normal') ge.deleteAttribute(k);
      const c = o.material.color, n = ge.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      ge.setAttribute('color', new THREE.BufferAttribute(col, 3)); parts.push(ge); });
    doneGeo = mergeGeometries(parts, false); }
  const g = new THREE.Group(), m = new THREE.Mesh(doneGeo, doneMat); m.castShadow = true; m.receiveShadow = true; g.add(m);
  for (const sx of [-1, 1]) { const w = new THREE.Mesh(WIN_GEO, HM.win); w.position.set(sx * 0.95, 1.25, 2.4 / 2 + 0.12); g.add(w); }
  return g;
}
const WIN_GEO = new THREE.BoxGeometry(0.42, 0.36, 0.06);   // одна геометрия окна на все дома

export const HUT_CAPACITY = 20;
export const taxRateOf = D => { const l = (D.laws || []).find(x => x.policy === 'tax10' && !x.veto); return l ? 0.1 : 0; };
export function housesDoneAt(hour, rate = 0) {
  const day = Math.floor((Date.now() + 3 * 3600e3) / 864e5) - FOUND_DAY;
  return day < 0 ? 0 : Math.min(40, Math.floor(logsUntil(day, hour) * (1 - rate) / HOUSE_COST));
}
export const hutsNeeded = (pop, own) => Math.max(1, Math.ceil(Math.max(0, pop - own) / HUT_CAPACITY));

export function createSim(world, D) {
  const { scene, groundH, CAMP, riverX, person, CHARS, huts, pen } = world;
  const TAX = taxRateOf(D), TAX_FAIL = TAX > 0 && TAX < 0.1;
  const pop = D.population, shown = Math.min(Math.max(8, Math.round(pop * 0.5)), MAX_SHOWN);
  const R = clamp(9 + Math.sqrt(pop) * 0.6, 12, 34);
  const okLand = (x, z) => x < riverX(z) - 4.2;
  // здание с радиусом r целиком на суше: ни одна точка по контуру не заходит на берег и в воду (река — справа, её берег извивается)
  const landClear = (x, z, r) => okLand(x, z) && [0, 1, 2, 3, 4, 5, 6, 7].every(k => { const a = k * Math.PI / 4, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; return px < riverX(pz) - 4.4; });
  const today = () => Math.floor((Date.now() + 3 * 3600e3) / 864e5);

  // ---------- препятствия ----------
  const OBS = [];
  for (const [x, z, r] of world.blocked || []) {
    if (Math.hypot(x - CAMP.x, z - CAMP.y) > R + 20 || r < 0.85) continue;
    const isPen = Math.hypot(x - pen.x, z - pen.y) < 0.1;
    OBS.push({ x, z, r: isPen ? 3.5 : r === 1.4 ? 1.35 : r === 0.9 ? 0.55 : r === 1.5 ? 1.6 : r });
  }
  const freeOf = (x, z, m, list = OBS) => list.every(o => Math.hypot(x - o.x, z - o.z) >= o.r + m);

  // ---------- поле ----------
  const farm = (() => {
    let fx = CAMP.x + R * 0.35, fz = CAMP.y - R * 0.8, bestD = 1e9;
    for (let d = 10; d < R + 14; d += 0.8) for (let k = 0; k < 36; k++) { const ang = -Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.17, x = CAMP.x + Math.cos(ang) * d, z = CAMP.y + Math.sin(ang) * d;
      if (okLand(x + 4.6, z - 3) && okLand(x + 4.6, z + 3) && [[0, 0], [4, 2.8], [-4, 2.8], [4, -2.8], [-4, -2.8], [0, 2.8], [0, -2.8], [4, 0], [-4, 0]].every(([ox, oz]) => freeOf(x + ox, z + oz, 1.0)) && d < bestD) { bestD = d; fx = x; fz = z; } }
    const W = 8, L = 5.5, g = new THREE.Group(); g.position.set(fx, groundH(fx, fz), fz);
    const M = c => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 1 });
    const soil = new THREE.Mesh(new THREE.BoxGeometry(W, 0.14, L), M('#6e4e2e')); soil.position.y = 0.07; soil.receiveShadow = true; g.add(soil);
    for (let r = 0; r < 7; r++) { const ridge = new THREE.Mesh(new THREE.BoxGeometry(W - 0.6, 0.1, 0.3), M('#5c3f24')); ridge.position.set(0, 0.17, -L / 2 + 0.55 + r * 0.73); g.add(ridge); }
    const wheatM = new THREE.MeshStandardMaterial({ color: '#8fbf4a', flatShading: true }), vegM = M('#3f8f3a'), pumpM = M('#e0802a'), cabM = M('#9fd06a'), crops = [];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 11; c++) {
      const x = -W / 2 + 0.6 + c * 0.68, z = -L / 2 + 0.55 + r * 0.73;
      const m = r < 4 ? new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.7, 4), wheatM) : r === 4 ? new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), cabM)
        : r === 5 ? new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), c % 3 ? vegM : pumpM) : new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 5), vegM);
      m.position.set(x, 0.2, z); m.castShadow = true; m.userData.h = r < 4 ? 0.35 : 0.18; g.add(m); crops.push(m); }
    for (const [x, z] of [[-W / 2, -L / 2], [W / 2, -L / 2], [-W / 2, L / 2], [W / 2, L / 2], [0, -L / 2], [0, L / 2]]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), M('#6b4a2b')); post.position.set(x, 0.35, z); g.add(post); }
    const sc = new THREE.Group(); [[new THREE.BoxGeometry(0.1, 1.8, 0.1), '#6b4a2b', 0.9], [new THREE.BoxGeometry(1.2, 0.08, 0.08), '#6b4a2b', 1.35], [new THREE.BoxGeometry(0.5, 0.6, 0.25), '#a05050', 1.2],
      [new THREE.IcosahedronGeometry(0.2, 0), '#e1bf5b', 1.75], [new THREE.ConeGeometry(0.32, 0.3, 8), '#c9a24e', 1.98]].forEach(([geo, c, y]) => { const m = new THREE.Mesh(geo, M(c)); m.position.y = y; sc.add(m); });
    sc.position.set(W / 2 + 0.6, 0, 0); g.add(sc); scene.add(g);
    return { fx, fz, W, L, crops, wheatM, spot: () => [fx - W / 2 + 0.8 + Math.random() * (W - 1.6), fz - L / 2 + 0.6 + Math.random() * (L - 1.2)] };
  })();
  // поле: всё неподвижное — одна сетка, грядки — по одной «пачке» на вид овощей (вместо ~100 отдельных вызовов отрисовки)
  (() => { const g = farm.crops[0].parent, still = g.children.filter(o => !farm.crops.includes(o)), sg = new THREE.Group(); still.forEach(o => sg.add(o.clone()));
    const flat = bakeGroup(sg); flat.receiveShadow = true; still.forEach(o => g.remove(o)); g.add(flat);
    const packs = new Map(); farm.crops.forEach(c => { const k = c.material.uuid + JSON.stringify(c.geometry.parameters); if (!packs.has(k)) packs.set(k, []); packs.get(k).push(c); });
    const list = []; for (const cs of packs.values()) { const im = new THREE.InstancedMesh(cs[0].geometry, cs[0].material, cs.length); im.castShadow = true; im.frustumCulled = false;
      cs.forEach((c, j) => { g.remove(c); list.push({ im, j, x: c.position.x, z: c.position.z, h: c.userData.h, ry: c.rotation.y }); }); g.add(im); }
    farm.crops = list; })();
  OBS.push({ x: farm.fx + farm.W / 2 + 0.6, z: farm.fz, r: 0.6 });      // пугало
  const inFarm = (x, z, m = 0) => Math.abs(x - farm.fx) < farm.W / 2 + m && Math.abs(z - farm.fz) < farm.L / 2 + m;

  // ---------- поленница у костра (4 бревна) ----------
  const pile = (() => { let best = [CAMP.x + 3.9, CAMP.y, 0], bestD = -1;
    for (let i = 0; i < 24; i++) { const a = i / 24 * 6.283, x = CAMP.x + Math.cos(a) * 3.9, z = CAMP.y + Math.sin(a) * 3.9; if (!okLand(x, z)) continue;
      const d = Math.min(...OBS.filter(o => o.r > 1.2 && o.r < 3).map(o => Math.hypot(o.x - x, o.z - z) - o.r), 99); if (d > bestD) { bestD = d; best = [x, z, a]; } }
    const [x, z, a] = best, g = new THREE.Group(); g.position.set(x, groundH(x, z), z); g.rotation.y = -a;
    [[-0.17, 0.16], [0.17, 0.16], [0.51, 0.16], [0.17, 0.45]].forEach(([dx, y]) => { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.5, 7), HM.log); l.rotation.x = Math.PI / 2; l.position.set(dx, y, 0); l.castShadow = true; g.add(l); });
    scene.add(g); return { x, z }; })();
  OBS.push({ x: pile.x, z: pile.z, r: 1.1 });

  // ---------- ярмарочная площадь: места под здания предпринимателей (резервируются заранее, по одному зданию на дело) ----------
  const market = (() => {     // решётка 5×5 с шагом 5: берём ближайшие 16 свободных мест у первого подходящего центра
    const lattice = []; for (let ix = -2; ix <= 2; ix++) for (let iz = -2; iz <= 2; iz++) lattice.push([ix * 5, iz * 5]);
    let best = { x: CAMP.x - R * 0.8, z: CAMP.y + R * 0.6, pts: [] };
    for (let d = R * 0.55; d < R + 18; d += 0.9) for (let k = 0; k < 48; k++) { const a = k / 48 * 6.283, x = CAMP.x + Math.cos(a) * d, z = CAMP.y + Math.sin(a) * d * 0.9;
      const pts = lattice.filter(([ox, oz]) => landClear(x + ox, z + oz, 2.6) && freeOf(x + ox, z + oz, 2.1) && !inFarm(x + ox, z + oz, 3) && Math.hypot(x + ox - pile.x, z + oz - pile.z) > 3.5)
        .sort((p, q) => Math.hypot(...p) - Math.hypot(...q)).slice(0, MAX_SHOPS);
      if (pts.length > best.pts.length) best = { x, z, pts }; if (pts.length >= MAX_SHOPS) return best; }
    return best; })();
  const shopSlots = market.pts.map(([ox, oz]) => ({ x: market.x + ox, z: market.z + oz }));

  // ---------- участки под дома (заранее, по кругу за шалашами) ----------
  const plots = [];
  { const r = seeded(9001);
    for (let i = 0; i < 9000 && plots.length < 40; i++) {
      const a = r() * 6.283, d = 9 + Math.sqrt(r()) * (R + 16 - 9), x = CAMP.x + Math.cos(a) * d, z = CAMP.y + Math.sin(a) * d * 0.9;
      if (!landClear(x, z, 2.7) || !freeOf(x, z, 2.4) || inFarm(x, z, 3.5) || plots.some(p => Math.hypot(p.x - x, p.z - z) < 4.3) || shopSlots.some(p => Math.hypot(p.x - x, p.z - z) < 4.9)) continue;
      plots.push({ x, z, rot: Math.atan2(CAMP.x - x, CAMP.y - z) });
    }
    plots.sort((p, q) => Math.hypot(p.x - CAMP.x, p.z - CAMP.y) - Math.hypot(q.x - CAMP.x, q.z - CAMP.y)); }

  // ---------- жители ----------
  const pal = ['#b84a3a', '#3f6fa5', '#7a8a3a', '#a0763f', '#8a5aa0', '#d8c79f', '#4f7a5a', '#c08a3a', '#5a6f8a', '#a05050'];
  const hairs = ['#3a2618', '#6b4226', '#c9a25a', '#2a2a2a'];
  const tplDefs = [];
  for (let i = 0; i < 12; i++) { const f = i % 2 === 1;
    tplDefs.push({ height: 0.92 + hash(i) * 0.12, girth: 0.88 + hash(i + 9) * 0.25, shirt: pal[i % pal.length], pants: '#4b3a2a', skirt: f ? pal[(i + 4) % pal.length] : null,
      hat: f ? (i % 4 === 1 ? 'kerchief' : null) : (i % 3 === 0 ? 'straw' : null), hatColor: pal[(i + 6) % pal.length], hair: { color: hairs[i % 4], style: 'short' },
      beard: !f && i % 4 === 2 ? { color: '#5a3d2a', size: 0.7 } : null, female: f }); }
  tplDefs.push(CHARS.grisha, CHARS.pakhom, CHARS.timosha, CHARS.marfa, CHARS.arkadiy, CHARS.nyura);
  const NAMED = { grisha: 12, pakhom: 13, timosha: 14, marfa: 15, arkadiy: 16, nyura: 17 };
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  const tplGeo = tplDefs.map(p => bake(person(p), true));
  const tplArm = tplDefs.map(p => { const s = p.girth || 1, k = (p.height || 1) * (p.young ? 0.95 : 1); return { s, k, sx: 0.33 * s + 0.04, sy: 1.36, color: new THREE.Color(p.coat || p.shirt) }; });

  const gens = { grisha: 'Гриши', pakhom: 'Старосты Пахома', timosha: 'Тимоши', marfa: 'Марфы', arkadiy: 'Аркадия', nyura: 'Бабы Нюры' };
  const names = { grisha: 'Гриша', pakhom: 'Староста Пахом', timosha: 'Тимоша', marfa: 'Марфа', arkadiy: 'Аркадий', nyura: 'Баба Нюра' };
  const accs = { marfa: 'Марфу', nyura: 'Бабу Нюру' };
  const nFish = clamp(Math.round(shown * 0.08), 2, 16), nFarm = clamp(Math.round(shown * 0.12), 2, 40);
  // жители, созданные подписчиками, занимают свободные места на карте (кроме именных, второго лесоруба и двух плотников) — по порядку присяги
  const builderAt = new Set([7 + nFish + nFarm, 8 + nFish + nFarm]), slots = [];
  for (let i = 7; i < shown; i++) if (!builderAt.has(i)) slots.push(i);
  let resBySlot = new Map();
  const mapResidents = list => {      // раздаёт жителей-подписчиков по местам, их характеры и желаемые профессии
    resBySlot = new Map(); (list || []).forEach((r, k) => { if (k < slots.length) resBySlot.set(slots[k], r); });
    setTraitOverrides(Object.fromEntries([...resBySlot].filter(([, r]) => r.traits?.length).map(([i, r]) => [i, r.traits])));   // характеры, которые подписчики выбрали сами
    setGoals(Object.fromEntries([...resBySlot].filter(([, r]) => r.wish).map(([i, r]) => [i, r.wish])));                         // желаемые профессии
  };
  mapResidents(D.residents);
  const agents = [];
  for (let i = 0; i < shown; i++) {
    let tpl = Math.floor(hash(i + 1) * 12), role = 'walk', named = null;
    if (i < 6) { named = Object.keys(NAMED)[i]; tpl = NAMED[named]; }
    if (named === 'grisha') role = 'herd'; else if (named === 'pakhom') role = 'elder'; else if (named === 'timosha') role = 'wood';
    else if (named === 'marfa') role = 'cook'; else if (named === 'nyura') role = 'herbal';
    else if (i === 6) role = 'wood'; else if (i < 7 + nFish) role = 'fish'; else if (i < 7 + nFish + nFarm) role = 'farm';
    const res = resBySlot.get(i), baseRole = role;
    if (goalOf(i)?.kind === 'job') role = goalOf(i).key;       // мечтает быть рыбаком или земледельцем — работает им сразу
    const fem = tplDefs[tpl].female || named === 'marfa' || named === 'nyura';
    agents.push({ i, tpl, role, named, name: named ? names[named] : res ? '@' + res.nick : personName(i, fem).name, gen: named ? gens[named] : res ? '@' + res.nick : personName(i, fem).gen, acc: named ? (accs[named] || gens[named]) : res ? '@' + res.nick : personName(i, fem).acc, x: 0, z: 0, tx: 0, tz: 0, path: null, pk: '', speed: 1.1 + hash(i + 3) * 0.45,
      swing: hash(i + 21) * 7, workLen: 3.5 + hash(i + 7) * 2.5, restOff: hash(i + 8) * 7, phase: hash(i + 5) * 6.28, female: tplDefs[tpl].female || named === 'marfa' || named === 'nyura',
      act: 'walk', wait: 0, stuck: 0 });
    agents.at(-1).baseRole = baseRole; agents.at(-1).workLen0 = agents.at(-1).workLen;
  }

  // очередь на собственный дом: сначала именные жители, потом остальные по номеру
  const queue = ['grisha', 'marfa', 'arkadiy', 'timosha', 'nyura'].map(n => agents.find(a => a.named === n)).filter(Boolean)
    .concat(agents.filter(a => !a.named));
  const builders = [...builderAt].map(i => agents[i]).filter(Boolean);       // двое плотников — места известны заранее
  builders.forEach(a => a.role = 'build');

  // ---------- жизнь: опыт, должности, деньги (sim_life.js) ----------
  const hist = (D.popHistory || []).map(e => ({ d: Math.floor(Date.parse(e.date + 'T12:00:00Z') / 864e5) - FOUND_DAY, shown: Math.max(8, Math.round(e.pop * 0.5)) })).sort((p, q) => p.d - q.d);
  const joinOf = i => { const rs = resBySlot.get(i); if (rs?.joined) return Math.max(0, Math.floor(Date.parse(rs.joined + 'T00:00:00Z') / 864e5) - FOUND_DAY);   // жизнь созданного жителя начинается в день присяги
    if (!hist.length) return 0; const e = hist.find(x => x.shown > i); return e ? Math.max(0, e.d) : Math.max(0, today() - FOUND_DAY); };
  agents.forEach(a => { a.role0 = a.role; a.join = joinOf(a.i); a.talent = talentOf(a.i); a.traits = traitsOf(a.i); a.trait = a.traits[0]; a.traitName = traitName(a.i, a.female); a.workLen = Math.max(2, a.workLen + traitFx(a.i).work); });
  // лечебница: её строит государство (закон «Лекарня»); до тех пор лекарь лечит жителей дома и здания не имеет
  const clinic = world.clinic || null;
  const clinicFrom = clinic ? (D.world?.clinicSince ? Math.floor(Date.parse(D.world.clinicSince + 'T00:00:00Z') / 864e5) - FOUND_DAY : 0) : Infinity;
  let life, sickList = [], lifeKey = '', lifeCur = null, rolesChanged = false, bizList = [];
  const buildLife = () => { life = createLife(agents.map(a => ({ i: a.i, role: a.role0, join: a.join, wish: goalOf(a.i)?.wish })), TAX, HOUSE_COST, clinicFrom); lifeKey = ''; };
  buildLife();
  function lifeNow(day, hour) {
    const k = day + ':' + hour.toFixed(2); if (k === lifeKey) return lifeCur;
    lifeKey = k; lifeCur = life(day, hour);
    agents.forEach((a, j) => { const r = lifeCur.role[j]; if (r !== a.role) { a.role = r; a.pk = ''; rolesChanged = true; } a.L = levelOf(lifeCur.xp[j]); a.mult = multOf(a.L); a.coins = lifeCur.coins[j]; a.hungry = !!lifeCur.hungry[j]; a.hiredDay = lifeCur.hiredDay[j]; a.pay = lifeCur.pay[j]; a.bld = lifeCur.bk[j]; a.sick = lifeCur.sick[j]; });
    sickList = agents.filter(a => a.sick);
    bizList = lifeCur.biz.map(b => ({ ...b, owner: agents[b.k] }));
    return lifeCur;
  }
  // ---------- дневник поселения: события из жизни жителей ----------
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const dateOf = d => { const t = new Date((FOUND_DAY + d) * 864e5); return t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()]; };
  const hm = h => String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0');
  const ending = a => a.female ? 'а' : '';
  const who = a => a.name, whoT = a => `${TRAITS[a.traits[0]][a.female ? 'f' : 'm']} ${a.name}`, whom = a => a.acc;
  const firstPromo = e => { const L = lifeCur?.log || []; return L.find(x => x.t === 'promo' && x.role === e.role && x.rank === e.rank) === e; };
  function diaryText(e) {
    const a = agents[e.k];
    switch (e.t) {
      case 'hire': return `${who(a)} устроил${a.female ? 'ась' : 'ся'} на работу ${PLACE[e.r]}: монеты кончились, а хлеб платный`;
      case 'promo': { const fp = firstPromo(e), tail = a.traits.includes('hard') ? 'Трудолюбие окупается!' : a.traits.includes('lazy') ? 'Хоть и не спешил' + ending(a) + '…' : '';
        return `${whoT(a)} получил${ending(a)} повышение — теперь ${ladder(e.role)[e.rank]}${fp ? ' — перв' + (a.female ? 'ая' : 'ый') + ' в государстве!' : ''}${tail ? (fp ? ' ' : '. ') + tail : ''}`; }
      case 'oath': return `${who(a)} присягнул${ending(a)} государству и мечтает стать: ${(goalOf(a.i)?.wish || '').toLowerCase()}`;
      case 'mats': return `${a.traits.includes('dreamer') ? whoT(a) : who(a)} купил${ending(a)} ${e.n} ${plural(e.n, 'бревно', 'бревна', 'брёвен')} у лесорубов за ${coinsW(e.price)} и начал${ending(a)} строить ${BUILD[e.key].what}`;
      case 'heal': { const b = agents[e.to]; return `Баба Нюра вылечила ${whom(b)}: заболел${b.female ? 'а' : ''} ${e.clinic ? '— принята в лечебнице' : '— лекарь пришла на дом, лечебницы пока нет'}`; }
      case 'biz': return `Построена ${BIZ[e.key].shop.toLowerCase()}! ${a.traits.includes('dreamer') ? whoT(a) : who(a)} открыл${ending(a)} своё дело: ${BIZ[e.key].why}`;
      case 'gift': { const b = agents[e.to]; return `${whoT(a)} угостил${ending(a)} хлебом ${whom(b)}: ${b.female ? 'ей' : 'ему'} не хватило монет на ужин`; }
      case 'sly': return `${whoT(a)} снова утаил${ending(a)} половину налога. Казна недосчиталась монет`;
      case 'harvest': return `Собран урожай! В амбарах уже ${e.grain} мер зерна`;
      case 'house': { const o = queue[e.n - 1]; return o ? `Достроен дом ${o.gen}! Новоселье — и место в шалаше освободилось` : `Достроен ещё один дом`; }
    }
    return '';
  }
  // общий дневник — только заметное: первый мастер в профессии и повышения с 3-й должности; личный — всё о жителе
  function diary(limit = 40, k = null) {
    const L = lifeCur?.log || [], out = [], firsts = new Set(), seen = new Set();
    for (const e of L) if (e.t === 'promo') { const key = e.role + ':' + e.rank; if (!seen.has(key)) { seen.add(key); firsts.add(e); } }
    for (let j = L.length - 1; j >= 0 && out.length < limit * 3; j--) { const e = L[j];
      if (k != null ? e.k !== k && e.to !== k : e.t === 'promo' && e.rank < 2 && !firsts.has(e)) continue; if (e.k != null && !agents[e.k]) continue; out.push(e); }
    return out.sort((p, q) => q.d - p.d || q.h - p.h).slice(0, limit).map(e => ({ d: e.d, date: dateOf(e.d), time: hm(e.h), text: diaryText(e), t: e.t, k: e.k, ts: (FOUND_DAY + e.d) * 864e5 + (e.h - 3) * 3600e3 }));   // ts — момент события (мс)
  }
  { const d0 = new Date(Date.now() + 3 * 3600e3); lifeNow(today() - FOUND_DAY, d0.getUTCHours() + d0.getUTCMinutes() / 60); rolesChanged = false; }

  // ---------- экономика: брёвна → дома (детерминированно от времени) ----------
  const economy = (hour) => {
    const day = today() - FOUND_DAY, workFrac = workFracAt(hour);
    const L = lifeNow(day, hour);
    const logsAll = L.logs, logs = logsAll * (1 - TAX) - L.shopLogs, done = Math.min(queue.length, plots.length, Math.floor(logs / HOUSE_COST));
    const prog = done < Math.min(queue.length, plots.length) ? (logs % HOUSE_COST) / HOUSE_COST : 0;
    const fish = Math.round(L.fish), harvests = Math.max(0, Math.floor((day + 1) / 6));
    return { day, logs: Math.floor(logsAll), done, prog, fish, harvests, grain: Math.round(L.grain), workFrac, tax: TAX, treasury: Math.round(L.treasury), shopLogs: L.shopLogs, sickToday: L.sickToday, healedToday: L.healedToday,
      reserve: { logs: Math.floor(logsAll * TAX), fish: Math.floor(fish * TAX) } };
  };

  // ---------- дома на карте ----------
  const houseObjs = [];       // { k, owner, plot, stage, obj }
  let housesKey = '', housesCount = '';       // что на карте сейчас: стадия стройки и число домов (по отдельности — чтобы не перестраивать дома каждый кадр)
  const houseObs = [];
  // ---------- здания предпринимателей: каждое подходит своему делу; пока строится — леса, брёвна и доски ----------
  const shopObs = [], shops = [], meshCache = new Map();
  const WALL = { potter: '#c98a5e', tailor: '#e6d6b0', smith: '#8a8378', mill: '#e8dcc0', smoke: '#8a5a3a', joiner: '#b5834a', cobbler: '#b09070', trader: '#d8b878', kvass: '#a87c4a' };
  function build3(fn) {           // собирает группу и склеивает в одну сетку (одно обращение к видеокарте на здание)
    const g = new THREE.Group(), M = col => new THREE.MeshStandardMaterial({ color: col }), add = (geo, col, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, M(col)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
    fn(add, M, g); const m = bakeGroup(g); m.castShadow = true; m.receiveShadow = true; return m;
  }
  const BX = (w, h, d) => new THREE.BoxGeometry(w, h, d), CY = (r1, r2, h, n = 8) => new THREE.CylinderGeometry(r1, r2, h, n);
  const logPile = (add, x, z, k = 1) => { for (let i = 0; i < Math.round(4 * k); i++) add(CY(0.15, 0.15, 1.4, 6), '#a0763f', x + (i % 2) * 0.3 - 0.15, 0.15 + Math.floor(i / 2) * 0.28, z, 0, 0, Math.PI / 2); };
  function siteMesh(stage) {        // 0 — разметка и брёвна, 1 — стойки, 2 — стены, 3 — стропила
    const key = 'site' + stage; if (!meshCache.has(key)) meshCache.set(key, build3(add => {
      const cs = [[-1.5, -1.2], [1.5, -1.2], [-1.5, 1.2], [1.5, 1.2]], H = [0.5, 1.5, 1.6, 1.7][stage];
      add(BX(3.2, 0.08, 2.6), '#8a6a42', 0, 0.04, 0);
      cs.forEach(([x, z]) => add(BX(0.14, H, 0.14), '#7a5a32', x, H / 2, z));
      if (stage >= 1) { add(BX(3.0, 0.1, 0.1), '#7a5a32', 0, H, 1.2); add(BX(3.0, 0.1, 0.1), '#7a5a32', 0, H, -1.2); }
      if (stage >= 2) { add(BX(3.0, 1.1, 0.08), '#b5834a', 0, 0.6, -1.2); add(BX(0.08, 1.1, 2.4), '#b5834a', -1.5, 0.6, 0); add(BX(0.08, 1.1, 2.4), '#b5834a', 1.5, 0.6, 0); }
      if (stage >= 3) { for (let i = -2; i <= 2; i++) add(BX(0.08, 0.08, 2.9), '#6f4a28', i * 0.7, 1.95, 0, 0.45 * Math.sign(i || 1) * 0, 0, 0); add(BX(3.2, 0.1, 0.1), '#6f4a28', 0, 2.25, 0); }
      logPile(add, 2.4, 1.6, stage >= 2 ? 0.5 : 1); add(BX(1.2, 0.12, 0.5), '#c9a06a', -2.3, 0.1, 1.5); add(BX(1.1, 0.12, 0.5), '#c9a06a', -2.3, 0.22, 1.5);
    })); return meshCache.get(key).clone();
  }
  function shopMesh(key) {
    if (!meshCache.has(key)) meshCache.set(key, build3((add, M, g) => {
      const c = BIZ[key].color, W = 3.0, D = 2.4;
      add(BX(W, 1.5, D), WALL[key], 0, 0.75, 0);                                          // стены
      const sh = new THREE.Shape(); sh.moveTo(-1.5, 0); sh.lineTo(1.5, 0); sh.lineTo(0, 1.0); sh.closePath();   // двускатная крыша цвета дела
      const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 3.6, bevelEnabled: false }), M(c)); roof.geometry.translate(0, 0, -1.8); roof.rotation.y = Math.PI / 2; roof.position.y = 1.5; g.add(roof);
      add(BX(0.7, 1.15, 0.1), '#4a2f1a', 0.7, 0.58, D / 2 + 0.03);                        // дверь
      add(BX(0.6, 0.5, 0.1), '#f4e3b0', -0.8, 0.95, D / 2 + 0.03);                        // окно
      add(BX(2.1, 0.75, 0.55), '#8a5f36', -0.3, 0.38, D / 2 + 0.6); add(BX(2.2, 0.07, 0.65), '#a8794a', -0.3, 0.78, D / 2 + 0.6);   // прилавок
      add(BX(2.4, 0.06, 0.9), c, -0.3, 1.45, D / 2 + 0.6, 0.35);                          // навес над прилавком цвета дела
      for (const sx of [-1.35, 0.75]) add(BX(0.07, 1.4, 0.07), '#6b4a2b', sx, 0.7, D / 2 + 1.0);
      add(BX(1.3, 0.4, 0.06), c, 0.7, 2.0, D / 2 + 0.2); add(BX(1.0, 0.1, 0.07), '#fff4d6', 0.7, 2.0, D / 2 + 0.24);   // вывеска
      const gy = 0.84, gz = D / 2 + 0.6, good = {
        potter: () => { [-0.9, -0.3, 0.3].forEach(x => add(CY(0.12, 0.17, 0.3, 7), '#c0704a', x, gy + 0.15, gz)); add(CY(0.55, 0.65, 0.8, 9), '#7a4a3a', -2.1, 0.4, 0); add(new THREE.SphereGeometry(0.55, 9, 6), '#8a5040', -2.1, 0.85, 0); add(CY(0.12, 0.14, 1.0, 6), '#555', -2.1, 1.6, 0); },
        tailor: () => { [-0.9, -0.3, 0.3].forEach((x, i) => add(BX(0.4, 0.08, 0.35), ['#8a5fb0', '#3f6fa5', '#d06050'][i], x, gy + 0.05, gz)); add(BX(0.06, 1.8, 0.06), '#6b4a2b', 2.0, 0.9, 0.8); add(BX(0.6, 1.0, 0.04), '#d06050', 2.3, 1.2, 0.8); },
        smith: () => { add(BX(0.5, 0.25, 0.25), '#3a3a3a', -0.3, gy + 0.12, gz); add(BX(0.15, 0.15, 0.6), '#5a5a5a', -0.9, gy + 0.07, gz); add(BX(0.5, 1.7, 0.5), '#6a645c', -0.9, 2.1, -0.4); add(BX(0.7, 0.4, 0.5), '#3a3a3a', 2.0, 0.2, 0.6); add(BX(0.6, 0.18, 0.4), '#d24a2a', 2.0, 0.45, 0.6); },
        mill: () => { [-0.9, -0.3].forEach(x => add(CY(0.2, 0.25, 0.45, 7), '#f2e6c6', x, gy + 0.22, gz)); add(BX(0.18, 3.6, 0.06), '#6b4a2b', 0, 2.5, D / 2 + 0.55); add(BX(3.6, 0.18, 0.06), '#6b4a2b', 0, 2.5, D / 2 + 0.55);
          for (const [x, y, w, h] of [[0.9, 3.2, 1.2, 0.7], [-0.9, 1.8, 1.2, 0.7], [1.5, 1.6, 0.7, 1.2], [-1.5, 3.4, 0.7, 1.2]]) add(BX(w, h, 0.04), '#f2e6c6', x, y, D / 2 + 0.52); },
        smoke: () => { [-0.9, -0.5, -0.1, 0.3].forEach(x => add(BX(0.25, 0.08, 0.12), '#c08a4a', x, gy + 0.05, gz)); add(BX(0.55, 2.6, 0.55), '#7a4a2a', -1.0, 1.9, -0.5); add(BX(0.7, 0.12, 0.7), '#5a3a22', -1.0, 3.25, -0.5); add(BX(0.1, 1.2, 1.2), '#6b4a2b', 2.0, 0.6, 0.6); },
        joiner: () => { add(BX(0.5, 0.35, 0.4), '#a0703a', -0.9, gy + 0.17, gz); add(BX(0.4, 0.05, 0.35), '#c08a4a', -0.1, gy + 0.03, gz); for (let i = 0; i < 5; i++) add(BX(1.6, 0.08, 0.5), '#c9a06a', 2.1, 0.1 + i * 0.1, 0.4); add(BX(0.8, 0.5, 0.1), '#8a5f36', 2.1, 0.55, 1.3); },
        cobbler: () => { [-0.9, -0.55, -0.2, 0.15].forEach(x => add(BX(0.18, 0.12, 0.32), '#6a4a3a', x, gy + 0.06, gz)); add(BX(0.9, 0.6, 0.12), '#7a5a3a', 2.0, 0.5, 0.5); [0, 1, 2].forEach(i => add(BX(0.2, 0.12, 0.34), '#4a3224', 1.75 + i * 0.25, 0.6, 0.6)); },
        trader: () => { add(BX(0.35, 0.3, 0.3), '#c49a5a', -0.9, gy + 0.15, gz); add(new THREE.SphereGeometry(0.15, 6, 4), '#d24a3a', -0.35, gy + 0.15, gz); add(new THREE.SphereGeometry(0.15, 6, 4), '#e2b23a', 0.05, gy + 0.15, gz); for (let i = 0; i < 4; i++) add(BX(0.6, 0.5, 0.6), '#c49a5a', 2.0, 0.25 + (i > 1 ? 0.5 : 0), 0.4 + (i % 2) * 0.1); },
        kvass: () => { add(CY(0.28, 0.28, 0.55, 9), '#8a5a2a', -0.6, gy + 0.28, gz, 0, 0, Math.PI / 2); [0, 1, 2].forEach(i => add(CY(0.4, 0.4, 0.8, 9), '#8a5a2a', 2.0, 0.4, -0.5 + i * 0.85)); add(BX(0.7, 0.4, 0.06), '#6b4a2b', 2.0, 1.2, 0.9); },
      }; good[key]?.();
    })); return meshCache.get(key).clone();
  }
  // по одному зданию на каждое дело: сначала стройка (стадии по ходу работы), потом готовое здание
  function syncShops() {
    let ret = false;
    bizList.forEach((b, j) => { const sl = shopSlots[j]; if (!sl) return;
      const stage = b.state === 'open' ? 9 : Math.min(3, Math.floor(b.p * 4)); let st = shops[j];
      if (!st) { const rot = Math.atan2(CAMP.x - sl.x, CAMP.y - sl.z); st = shops[j] = { key: b.key, x: sl.x, z: sl.z, rot, m: null, stage: -1, front: null }; shopObs.push({ x: sl.x, z: sl.z, r: 2.1 }); ret = 'new'; }
      if (st.stage !== stage) { if (st.m) scene.remove(st.m); st.m = stage === 9 ? shopMesh(b.key) : siteMesh(stage); st.m.position.set(sl.x, groundH(sl.x, sl.z), sl.z); st.m.rotation.y = st.rot; scene.add(st.m); st.stage = stage; ret = ret || 'stage'; } });
    return ret;
  }
  function syncHouses(eco) {
    const key = eco.done + ':' + Math.floor(eco.prog * 20);
    if (key === housesKey) return false;
    const countKey = String(eco.done + (eco.prog > 0 ? 1 : 0)), countChanged = countKey !== housesCount; housesKey = key; housesCount = countKey;
    for (const h of houseObjs) { scene.remove(h.obj); if (h.p < 1) h.obj.traverse(o => o.geometry?.dispose()); }   // стройка — у неё свои геометрии, готовый дом использует общую
    houseObjs.length = 0; houseObs.length = 0;
    const count = eco.done + (eco.prog > 0 ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const p = k < eco.done ? 1 : Math.max(0.04, eco.prog), plot = plots[k], obj = p >= 1 ? doneHouse() : houseModel(p);
      obj.position.set(plot.x, groundH(plot.x, plot.z), plot.z); obj.rotation.y = plot.rot; scene.add(obj);
      const owner = queue[k]; houseObjs.push({ k, owner, plot, p, obj }); houseObs.push({ x: plot.x, z: plot.z, r: 1.95 });
      if (owner) { const prev = owner.house; owner.house = { x: plot.x + Math.sin(plot.rot) * 2.35, z: plot.z + Math.cos(plot.rot) * 2.35, done: p >= 1, k, door: prev && prev.k === k ? prev.door : null }; }
    }
    queue.forEach((a, k) => { if (k >= count) a.house = null; });
    return countChanged ? 'count' : 'stage';
  }

  // ---------- деревья лесорубов ----------
  const woodcutters = agents.filter(a => a.role === 'wood');
  const treeMat = { trunk: new THREE.MeshStandardMaterial({ color: '#6b4a2b', flatShading: true }), leaf: new THREE.MeshStandardMaterial({ color: '#2f6b3a', flatShading: true }), cut: new THREE.MeshStandardMaterial({ color: '#d9b57a', flatShading: true }) };
  const blobMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false });
  const tree = (() => { const t = new THREE.Group(), pivot = new THREE.Group(); t.add(pivot);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 1.4, 6), treeMat.trunk); trunk.position.y = 0.7; pivot.add(trunk);
    for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(1.35 - i * 0.3, 1.6, 7), treeMat.leaf); c.position.y = 1.7 + i * 0.9; pivot.add(c); }
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.3, 6), treeMat.trunk); stump.position.y = 0.15; t.add(stump);
    const blob = new THREE.Mesh(new THREE.CircleGeometry(1.3, 14), blobMat); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; t.add(blob);
    scene.add(t); return { t, pivot, blob, x: 0, z: 0 }; })();
  const treeSpot = dayN => { const r = seeded(dayN * 97 + 7);
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < 120; i++) {
      const a = Math.PI * (0.35 + r() * 1.3), d = R - 3 + pass * 2 + r() * 3, x = CAMP.x + Math.cos(a) * d, z = CAMP.y + Math.sin(a) * d * 0.85;
      if (okLand(x, z) && freeOf(x, z, 1.5) && !inFarm(x, z, 3) && plots.slice(0, 12).every(p => Math.hypot(p.x - x, p.z - z) > 4)) return [x, z]; }
    return [CAMP.x - R - 2, CAMP.y]; };
  const stumps = [];
  for (let back = 1; back <= 6; back++) { const [x, z] = treeSpot(today() - back);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.3, 6), treeMat.trunk); s.position.set(x, groundH(x, z) + 0.15, z); scene.add(s); stumps.push(s); }
  const treeOb = { x: 0, z: 0, r: 0.55 };

  // ---------- сетка проходимости ----------
  const nav = new Nav(CAMP.x - R - 18, CAMP.y - R - 18, CAMP.x + R + 18, CAMP.y + R + 18, 0.5);
  function rebuildNav() {
    const all = OBS.concat(houseObs, shopObs, [treeOb]);
    for (let k = 0; k < nav.g.length; k++) {
      const [x, z] = nav.center(k);
      let v = x > riverX(z) - 3.2 ? 1 : 0;
      if (!v) for (const o of all) if (Math.abs(x - o.x) < o.r + 0.45 && Math.abs(z - o.z) < o.r + 0.45 && Math.hypot(x - o.x, z - o.z) < o.r + 0.3) { v = 1; break; }
      if (!v && inFarm(x, z, 0.2)) v = 2;
      nav.g[k] = v;
    }
    nav.flood();
  }
  const randomSpot = (r = R) => { for (let i = 0; i < 50; i++) { const a = Math.random() * 6.283, d = 2.5 + Math.sqrt(Math.random()) * (r - 2.5), x = CAMP.x + Math.cos(a) * d, z = CAMP.y + Math.sin(a) * d * 0.9;
      const k = nav.idx(x, z); if (okLand(x, z) && nav.ok(k, false) && nav.passAt(x + 0.5, z, false) && nav.passAt(x - 0.5, z, false)) return [x, z]; } return freeNear(CAMP.x - 3, CAMP.y + 3); };
  const freeNear = (x, z, farm = false) => { const k = nav.nearestFree(x, z, farm); return k < 0 ? [x, z] : k === nav.idx(x, z) ? [x, z] : nav.center(k); };

  // места: двери шалашей, места у костра, у поленницы, рыбацкие места
  const hutDoor = h => { const d = Math.hypot(CAMP.x - h.x, CAMP.y - h.z) || 1; return [h.x + (CAMP.x - h.x) / d * 2.0, h.z + (CAMP.y - h.z) / d * 2.0]; };
  const rodMat = new THREE.MeshBasicMaterial({ color: '#3a2a1a' }), rodGeo = new THREE.CylinderGeometry(0.015, 0.025, 2.2, 4);
  function assignFish() {          // рыбаки стоят вдоль реки; новые рыбаки (устроились на работу) получают место и удочку
    const fishers = agents.filter(a => a.role === 'fish');
    fishers.forEach((a, k) => { const z = CAMP.y - R * 0.8 + (k / Math.max(1, fishers.length - 1)) * R * 1.6; a.spot = freeNear(riverX(z) - 3.45, z);
      if (!a.rod) { a.rod = new THREE.Mesh(rodGeo, rodMat); a.rod.visible = false; scene.add(a.rod); } });
  }

  function placeFixedSpots() {
    const owners = agents.filter(a => a.house && a.house.done), lodgers = agents.filter(a => !(a.house && a.house.done));
    const inHuts = Math.max(0, pop - lastEco.done);                         // жители без своего дома
    hutOcc = huts.map((_, h) => clamp(inHuts - h * HUT_CAPACITY, 0, HUT_CAPACITY));
    const filled = hutOcc.filter(v => v > 0).length || 1;
    lodgers.forEach((a, k) => { const h = Math.min(filled - 1, Math.floor(k * filled / Math.max(1, lodgers.length))); a.hutNo = h;
      const hh = huts[h] || { x: CAMP.x + 3, z: CAMP.y }; a.hut = freeNear(...hutDoor(hh)); });
    owners.forEach(a => { a.hutNo = null; a.hut = freeNear(...hutDoor(huts[0] || { x: CAMP.x + 3, z: CAMP.y })); });
    agents.forEach(a => { if (a.house) a.house.door = freeNear(a.house.x, a.house.z); });
    woodcutters.forEach((a, k) => a.pileSpot = freeNear(pile.x + Math.sin(k * 2.4) * 1.5, pile.z + Math.cos(k * 2.4) * 1.5));
    assignFish();
    if (clinic) { const dir = Math.atan2(CAMP.x - clinic.x, CAMP.y - clinic.z);       // места перед лечебницей: у входа — лекарь, по дуге — больные
      clinic.heal = freeNear(clinic.x + Math.sin(dir) * 2.6, clinic.z + Math.cos(dir) * 2.6);
      clinic.spots = Array.from({ length: 14 }, (_, k) => { const a = dir + (k / 13 - 0.5) * 2.2; return freeNear(clinic.x + Math.sin(a) * 3.9, clinic.z + Math.cos(a) * 3.9); }); }
    shops.forEach(st => { st.front = freeNear(st.x + Math.sin(st.rot) * 2.4, st.z + Math.cos(st.rot) * 2.4); });
    agents.forEach(a => { const ang = hash(a.i + 31) * 6.283, r = 4.6 + hash(a.i + 33) * 3.2; a.dinner = freeNear(CAMP.x + Math.cos(ang) * r, CAMP.y + Math.sin(ang) * r * 0.9); });
  }

  // ---------- инстансы: тела, руки, кисти, тени, брёвна ----------
  const byTpl = tplGeo.map(() => []); agents.forEach(a => { a.slot = byTpl[a.tpl].length; byTpl[a.tpl].push(a); });
  const bodies = tplGeo.map((g, k) => { if (!byTpl[k].length) return null; const m = new THREE.InstancedMesh(g, bodyMat, byTpl[k].length);
    m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.userData.tpl = k; scene.add(m); return m; });
  const sleeveGeo = new THREE.CylinderGeometry(0.078, 0.07, 0.6, 6).translate(0, -0.3, 0), handGeo = new THREE.IcosahedronGeometry(0.09, 0).translate(0, -0.64, 0);
  const sleeves = new THREE.InstancedMesh(sleeveGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.85 }), agents.length * 2);
  const hands = new THREE.InstancedMesh(handGeo, new THREE.MeshStandardMaterial({ color: '#e9b58f', flatShading: true }), agents.length * 2);
  const tmpC = new THREE.Color();
  agents.forEach(a => { tmpC.copy(tplArm[a.tpl].color).multiplyScalar(0.88); sleeves.setColorAt(a.i * 2, tmpC); sleeves.setColorAt(a.i * 2 + 1, tmpC); });
  [sleeves, hands].forEach(m => { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); });
  const blobs = new THREE.InstancedMesh(new THREE.CircleGeometry(0.45, 12).rotateX(-Math.PI / 2), blobMat, agents.length); blobs.frustumCulled = false; scene.add(blobs);
  const logGeo = new THREE.CylinderGeometry(0.11, 0.11, 1.1, 6);
  const carryLogs = new THREE.InstancedMesh(logGeo, HM.log, Math.max(1, woodcutters.length)); carryLogs.frustumCulled = false; scene.add(carryLogs);
  const tools = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.06, 0.5).translate(0, 0, 0.2), new THREE.MeshStandardMaterial({ color: '#6b4a2b', flatShading: true }), agents.length);
  tools.frustumCulled = false; scene.add(tools);

  // ---------- звери ----------
  const kinds = ['deer', 'deer', 'deer', 'deer', 'fox', 'fox', 'fox', 'boar', 'boar', 'boar', 'hare', 'hare', 'hare', 'hare', 'wolf'];
  const animals = kinds.map((k, i) => { const g = animal(k); g.scale.setScalar(k === 'deer' ? 0.85 : 0.9); g.visible = false; scene.add(g);
    return { g, kind: k, x: 0, z: 0, tx: 0, tz: 0, vis: i % 5 !== 4, placed: false, timer: i % 5 !== 4 ? 60 + Math.random() * 240 : 10 + Math.random() * 30, speed: k === 'hare' ? 2.2 : k === 'fox' || k === 'wolf' ? 1.6 : 1.0 }; });
  // ---------- коровы в загоне: пасутся, жуют траву, иногда ложатся отдохнуть ----------
  const cows = [];
  scene.traverse(o => { if (o.userData.cow) cows.push(o); });
  cows.forEach((g, i) => { const head = g.children.find(o => o.userData.cowHead); g.remove(head);
    const body = bakeGroup(g); body.castShadow = true; g.clear(); g.add(body);
    const hm = bakeGroup(head); const hp = new THREE.Group(); hp.position.copy(head.position); hp.add(hm); hm.castShadow = true; g.add(hp);
    g.userData.st = { head: hp, x: g.position.x, z: g.position.z, tx: g.position.x, tz: g.position.z, rot: g.rotation.y, mode: 'graze', timer: 2 + i * 3, ph: i * 1.7, nod: 0 }; });
  const penSpot = () => { for (let i = 0; i < 20; i++) { const [x, z] = penSpot0(); if (cows.every(o => Math.hypot(o.userData.st.tx - x, o.userData.st.tz - z) > 1.4)) return [x, z]; } return penSpot0(); };
  const penSpot0 = () => { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()); return [pen.x + Math.cos(a) * r * 2.2, pen.y + Math.sin(a) * r * 1.4]; };
  function cowsUpdate(dt, t) {
    for (const g of cows) { const c = g.userData.st;
      c.timer -= dt;
      if (c.timer <= 0) {
        if (c.mode !== 'lie' && Math.random() < 0.12) { c.mode = 'lie'; c.timer = 25 + Math.random() * 30; }
        else if (c.mode === 'walk' || c.mode === 'lie' || Math.random() < 0.5) { c.mode = Math.random() < 0.75 ? 'graze' : 'look'; c.timer = c.mode === 'graze' ? 8 + Math.random() * 12 : 3 + Math.random() * 3; }
        else { c.mode = 'walk'; [c.tx, c.tz] = penSpot(); c.timer = 12; } }
      if (c.mode === 'walk') { const dx = c.tx - c.x, dz = c.tz - c.z, d = Math.hypot(dx, dz);
        if (d < 0.1) { c.mode = 'graze'; c.timer = 8 + Math.random() * 10; }
        else { const want = Math.atan2(-dz, dx); let dr = want - c.rot; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); c.rot += dr * Math.min(1, dt * 2.5);
          if (Math.abs(dr) < 0.6) { const st = Math.min(d, 0.35 * dt); c.x += dx / d * st; c.z += dz / d * st; } } }
      for (const o of cows) { if (o === g) continue; const q = o.userData.st, dx = c.x - q.x, dz = c.z - q.z, d = Math.hypot(dx, dz);   // не залезают друг в друга
        if (d < 1.15 && d > 1e-3) { const k = (1.15 - d) * Math.min(1, dt * 3); c.x += dx / d * k; c.z += dz / d * k; } }
      { const ex = (c.x - pen.x) / 2.3, ez = (c.z - pen.y) / 1.5, e = Math.hypot(ex, ez); if (e > 1) { c.x = pen.x + ex / e * 2.3; c.z = pen.y + ez / e * 1.5; } }
      // голова: пасётся — опущена к траве и жуёт; смотрит — поднята; лежит — дремлет
      const want = c.mode === 'graze' ? -0.85 : c.mode === 'walk' ? -0.15 : c.mode === 'lie' ? -0.25 : 0.12;
      c.nod += (want - c.nod) * Math.min(1, dt * 3);
      const chew = c.mode === 'graze' ? Math.sin(t * 9 + c.ph) * 0.05 + (Math.sin(t * 0.8 + c.ph) > 0.7 ? Math.sin(t * 3) * 0.08 : 0) : c.mode === 'lie' ? Math.sin(t * 1.2 + c.ph) * 0.02 : Math.sin(t * 6 + c.ph) * 0.02;
      c.head.rotation.z = c.nod + chew; c.head.rotation.y = c.mode === 'look' ? Math.sin(t * 0.9 + c.ph) * 0.5 : 0;
      const bob = c.mode === 'walk' ? Math.abs(Math.sin(t * 5 + c.ph)) * 0.03 : 0;
      c.lieK = (c.lieK || 0) + ((c.mode === 'lie' ? 1 : 0) - (c.lieK || 0)) * Math.min(1, dt * 1.5);
      g.position.set(c.x, groundH(c.x, c.z) + bob - c.lieK * 0.17, c.z); g.rotation.set(0, c.rot, c.lieK * 0.04); }
  }
  // список жителей-подписчиков изменился (пришла новая присяга): имена, характеры, мечты и жизнь пересчитываются на ходу, без перезагрузки
  function setResidents(list) {
    mapResidents(list);
    for (const a of agents) { if (a.named) continue; const res = resBySlot.get(a.i), p = res ? null : personName(a.i, a.female);
      a.name = res ? '@' + res.nick : p.name; a.gen = res ? '@' + res.nick : p.gen; a.acc = res ? '@' + res.nick : p.acc;
      a.role0 = goalOf(a.i)?.kind === 'job' ? goalOf(a.i).key : a.baseRole; if (builders.includes(a)) a.role0 = 'build';
      a.join = joinOf(a.i); a.talent = talentOf(a.i); a.traits = traitsOf(a.i); a.trait = a.traits[0]; a.traitName = traitName(a.i, a.female); a.workLen = Math.max(2, a.workLen0 + traitFx(a.i).work); a.pk = ''; }
    buildLife(); rolesChanged = true;
    shops.forEach(st => { if (st.m) scene.remove(st.m); }); shops.length = 0; shopObs.length = 0;      // здания дел пересоздаются под новое состояние
    housesChanged = true;
  }
  const forestSpot = () => { for (let i = 0; i < 60; i++) { const x = -48 + Math.random() * 36, z = -55 + Math.random() * 70;
      if (x < riverX(z) - 6 && Math.hypot(x - CAMP.x, z - CAMP.y) > R + 8 && Math.hypot(x - tree.x, z - tree.z) > 10 && !inFarm(x, z, 8)) return [x, z]; } return [-40, -30]; };

  // ---------- усталость: работает 3,5–6 часов, потом час отдыха (у всех зрителей одинаково) ----------
  function fatigue(a, h) {
    const cyc = a.workLen + 1, pos = ((h + a.restOff) % cyc + cyc) % cyc, rest = pos >= a.workLen;
    return { rest, energy: Math.round(rest ? 25 + 75 * (pos - a.workLen) : 100 - 75 * pos / a.workLen), left: rest ? Math.round((cyc - pos) * 60) : 0 };
  }
  const sickSpot = a => clinic && clinic.spots ? clinic.spots[a.i % clinic.spots.length] : (a.house && a.house.done && a.house.door ? a.house.door : a.hut);
  // ---------- распорядок дня ----------
  function plan(a, h, eco) {
    // ночи нет: работают весь день, а устав — берут перерыв на 1 час
    const lunch = h >= LUNCH_FROM && h < LUNCH_TO, breakfast = h >= 7 && h < 7.45, dinner = h >= 19 && h < 20.2;
    const home = a.house && a.house.done && a.house.door ? a.house.door : a.hut;
    if (breakfast) return { act: 'eat', goal: home, what: 'Завтракаю у дома' };
    if (lunch) return { act: 'eat', goal: home, what: 'Обед! Купил хлеб у Марфы' };
    if (dinner) return { act: 'eat', goal: a.dinner, what: 'Ужинаем все вместе у костра' };
    if (fatigue(a, h).rest) return { act: 'rest', goal: home };
    const work = !lunch;
    const building = houseObjs.find(o => o.p < 1);
    if (work && building && (a.role === 'build' || building.owner === a)) {
      const side = a.role === 'build' ? (builders[0] === a ? 1 : -1) : 0, pl = building.plot;
      const off = side === 0 ? [Math.sin(pl.rot) * 2.3, Math.cos(pl.rot) * 2.3] : [Math.cos(pl.rot) * 2.2 * side, -Math.sin(pl.rot) * 2.2 * side];
      return { act: 'build', goal: freeNear(pl.x + off[0], pl.z + off[1]), face: [pl.x, pl.z] };
    }
    if (a.role === 'wood' && eco.workFrac < 0.985) {
      if (a.carry) { const b = houseObjs.find(o => o.p < 1); const g2 = b ? freeNear(b.plot.x - Math.cos(b.plot.rot) * 2.6, b.plot.z + Math.sin(b.plot.rot) * 2.6) : a.pileSpot; return { act: 'carry', goal: g2, to: b ? b.owner : null }; }
      const side = woodcutters[0] === a ? 1 : -1; return { act: 'chop', goal: freeNear(tree.x + side * 0.8, tree.z + 0.85), face: [tree.x, tree.z] };
    }
    if (a.sick === 1 || (a.sick === 2 && h < 13)) return { act: 'sick', goal: sickSpot(a) };         // заболел: лежит дома (или в лечебнице) — до обеда, если лекарь успел, иначе весь день
    if (a.bld) { const st = shops[bizList.findIndex(b => b.owner === a)]; if (st && st.front) return { act: 'shopbuild', goal: st.front, face: [st.x, st.z] }; }   // строит своё здание
    if (BIZ[a.role]) { const j = bizList.findIndex(b => b.owner === a && b.state === 'open'), st = shops[j];
      if (st && st.front) return { act: 'craft', goal: st.front, face: [st.x, st.z] }; }
    if (a.role === 'fish') return { act: 'fish', goal: a.spot };
    if (a.role === 'farm') { if (!a.farmGoal || a.farmDone) { a.farmGoal = freeNear(...farm.spot(), true); a.farmDone = false; a.dwell = 4 + Math.random() * 8; } return { act: 'farm', goal: a.farmGoal, farm: true }; }
    if (a.role === 'herd') { if (!a.herdGoal || a.herdDone) { a.herdGoal = freeNear(pen.x - 4.6 - Math.random() * 1.3, pen.y - 2 + Math.random() * 4); a.herdDone = false; a.dwell = 3 + Math.random() * 5; } return { act: 'herd', goal: a.herdGoal }; }
    if (a.role === 'cook') return { act: 'cook', goal: freeNear(pile.x + 1.4, pile.z - 1.2), face: [CAMP.x, CAMP.y] };
    if (a.role === 'herbal' && clinic && clinic.heal) return { act: 'heal', goal: clinic.heal, face: [clinic.x, clinic.z] };   // лечебница есть — принимает там
    if (a.role === 'herbal' && sickList.length) {                                                                    // лечебницы нет — ходит по домам к больным
      if (!a.healGoal || a.healDone) { a.healIdx = (a.healIdx || 0) + 1; const pt = sickList[a.healIdx % sickList.length], sp = sickSpot(pt); a.healTo = pt; a.healGoal = freeNear(sp[0] + 0.9, sp[1]); a.healDone = false; a.dwell = 6 + Math.random() * 4; }
      return { act: 'heal', goal: a.healGoal, face: a.healTo ? sickSpot(a.healTo) : null }; }
    if (a.role === 'herbal') { if (!a.herbGoal || a.herbDone) { a.herbGoal = randomSpot(R + 2); a.herbDone = false; a.dwell = 5 + Math.random() * 6; } return { act: 'herb', goal: a.herbGoal }; }
    if (!a.walkGoal || a.walkDone) { a.walkGoal = randomSpot(); a.walkDone = false; a.dwell = 2 + Math.random() * 8; }
    return { act: 'walk', goal: a.walkGoal };
  }

  // мысли жителя — по его делам, дому и состоянию поселения
  // фирменная мысль характера (бунтарь возмущается налогом, хитрец ищет лазейку и т.д.)
  function charThought(a) {
    const T = { grump: TAX ? 'Опять этот налог… Ворчу, но работаю честно' : 'Всё не так, всё не эдак! Но работать надо',
      rebel: TAX ? 'Долой налог! Напишу в Думу свой закон' : 'Никто мне не указ! Сам решаю, как жить',
      merry: 'Слыхали, как Гришина корова Марфу обогнала? Ха-ха!', dreamer: BIZ[a.role] ? 'Моя мастерская — только начало. Мечтаю о целом заводе!' : `Мечтаю о своём деле. Коплю на брёвна для здания`,
      lazy: 'Эх, поскорее бы перерыв…', hard: 'Работа не волк — а я её люблю!', sly: TAX ? 'Если никто не видит — налог можно заплатить и поменьше…' : 'Где бы урвать выгоду?',
      kind: 'Если кто-то голоден — поделюсь хлебом', generous: 'Вечером зайду в мастерские — люблю красивые вещи', stingy: 'Каждая монета на счету. Коплю!' };
    return T[a.traits[(Math.floor(Date.now() / 18000) + a.i) % a.traits.length]];   // два характера — мысли чередуются
  }
  function thought(a) {
    const e = lastEco, b = houseObjs.find(o => o.p < 1), q = queue.indexOf(a), act = a.act;
    const own = a.house, nextOwner = b && b.owner ? b.owner.gen : null;
    const coins = Math.floor(a.coins ?? 0), L = a.L, alt = (Math.floor(Date.now() / 7000) + a.i) % 3 === 0, ranks = ladder(a.role);
    if (act === 'sick') return clinic ? (a.sick === 2 ? 'Заболел. В лечебнице уже занимаются мной — к обеду встану' : 'Заболел. В лечебнице очередь, лекарь не успевает…') : (a.sick === 2 ? 'Заболел. Баба Нюра придёт на дом — к обеду встану' : 'Слёг с простудой. Лекарь одна, а больных много…');
    if (act === 'heal') return clinic ? 'Принимаю больных в лечебнице: теперь успеваю больше' : `Лечебницы нет — хожу по домам${a.healTo ? ', сейчас у меня на очереди: ' + a.healTo.name : ''}. Здание строить не нужно, лечу так`;
    if (act === 'shopbuild') { const m = bizList.find(b => b.owner === a); return m ? `Строю ${BUILD[m.key].what}: готово на ${Math.round(m.p * 100)}%. Брёвна купил на свои деньги (${coinsW(m.paid)})` : 'Строю своё дело'; }
    // деньги и карьера
    // характер
    if (act !== 'rest' && act !== 'eat' && (Math.floor(Date.now() / 9000) + a.i) % 4 === 0) return charThought(a);
    if (act !== 'rest') {
      const dr = alt && dreamOf(a); if (dr && dr.thought) return dr.thought;
      if (a.hungry && coins < BREAD) return ranks ? 'Монет не хватило на хлеб… Работаю — к вечеру будут деньги' : 'Денег нет даже на хлеб. Пора искать работу!';
      if (!ranks && coins < 14) return `Осталось ${coinsW(coins)} — скоро пойду устраиваться на работу`;
      if (!ranks && alt) return `Пока без работы. Живу на сбережения: ${coinsW(coins)}`;
      const own = BIZ[a.role] && bizList.find(b => b.owner === a && b.state === 'open');
      if (own && own.ready === lastEco.day) return `Открыл${a.female ? 'а' : ''} своё дело — ${BIZ[a.role].shop.toLowerCase()}! Спрос есть: ${BIZ[a.role].why}`;
      if (own && alt && lastHour >= PAYDAY) return `Сегодня продал${a.female ? 'а' : ''} ${own.sold || 0} товаров — выручка ${coinsW(Math.round(a.pay || 0))}`;
      if (own && alt) return `Я ${BIZ[a.role].name}, своё дело. Чем лучше товар — тем больше покупателей`;
      if (ranks && !own && lastHour >= PAYDAY && lastHour < PAYDAY + 1.5 && a.pay > 0) return `Получил${a.female ? 'а' : ''} зарплату — ${coinsW(Math.round(a.pay))}!`;
      if (ranks && a.hiredDay === lastEco.day && alt) return `Сегодня устроился ${PLACE[a.role]}! Теперь будут деньги на хлеб`;
      if (ranks && L && alt && !L.top && L.lvl === 10) return `Ещё немного — и меня повысят до «${ranks[L.rank + 1]}»!`;
      if (ranks && L && alt && L.top) return 'У меня своё производство! Скоро найму помощников';
      if (ranks && L && alt && L.rank > 0 && (Math.floor(Date.now() / 7000) + a.i) % 2) return `Я уже ${ranks[L.rank]}. Работаю на ${Math.round((a.mult - 1) * 100)}% быстрее новичков`;
      if (ranks && alt && coins >= 60) return `Накопил ${coinsW(coins)}. Коплю на своё дело`;
    }
    switch (act) {
      case 'rest': { const f = fatigue(a, lastHour); return `Устал${a.female ? 'а' : ''} — беру перерыв на час. Ещё ${f.left} мин, и снова за работу`; }
      case 'eat': return a.hungry ? 'Не на что купить хлеб — сижу голодный' : (a.plan.what || 'Ем') + ` · хлеб за ${BREAD} монеты`;
      case 'chop': if (TAX && Math.floor(a.phase * 10) % 3 === 0) return TAX_FAIL ? 'Отдать десятое бревно? Спрячу-ка его за пнём…' : 'Каждое десятое бревно — в общий запас';
        return nextOwner ? `Рублю. Ещё пара брёвен — и дом для ${nextOwner} вырастет` : 'Рублю дерево: брёвна нужны всем';
      case 'carry': return a.plan.to ? `Несу бревно на стройку дома ${a.plan.to.gen}` : 'Несу бревно к костру';
      case 'build': return b && b.owner === a ? `Строю свой дом! Готов на ${Math.round(b.p * 100)}%` : `Помогаю строить дом ${nextOwner || 'соседу'}`;
      case 'fish': if (TAX && Math.floor(a.phase * 10) % 2 === 0) return TAX_FAIL ? 'Десятую рыбу отдавать не буду — спрячу в корзине' : 'Девять рыб себе, одну — государству';
        return `Клюёт! Всего поселение поймало ${e.fish} рыб`;
      case 'farm': { const left = 5 - ((e.day % 6 + 6) % 6); return left > 0 ? `Пшеница созреет через ${left} ${plural(left, 'день', 'дня', 'дней')}` : 'Сегодня собираем урожай!'; }
      case 'herd': return 'Коровы сыты — будет молоко';
      case 'cook': return 'Пеку хлеб на обед для всех';
      case 'herb': return 'Собираю травы — лекарни пока нет';
      case 'craft': return `Работаю в своей мастерской. ${BIZ[a.role].why[0].toUpperCase() + BIZ[a.role].why.slice(1)} — значит, будут покупатели`;
    }
    if (own && own.done) return a.female ? 'Свой дом есть. Теперь мечтаю о корове' : 'Дом построен. Хочу освоить ремесло';
    if (q >= 0) return `Коплю на свой дом. Я ${q + 1}-й в очереди`;
    return 'Гуляю по поселению';
  }

  // ---------- обновление ----------
  const dummy = new THREE.Object3D(), M1 = new THREE.Matrix4(), M2 = new THREE.Matrix4(), M3 = new THREE.Matrix4(), V = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3();
  let hutOcc = [], lastDone = -1, pathCalls = 0, pathTotal = 0, starved = 0;
  let first = true, dayKey = -1, lastEco = economy(12), stats = {}, pathBudget = 0, pathT0 = 0, housesChanged = false;

  function setPath(a, goal, farmOk) {
    const key = goal[0].toFixed(2) + ',' + goal[1].toFixed(2);
    if (a.pk === key && a.path) return true;
    if (pathBudget <= 0 || (pathCalls > 0 && performance.now() - pathT0 > 3)) { starved++; return false; }   // не больше ~3 мс на маршруты за кадр — без подвисаний
    pathBudget--; pathCalls++; pathTotal++; a.pk = key; a.path = nav.find(a.x, a.z, goal[0], goal[1], farmOk); a.pi = 0;
    if (!a.path) { a.path = []; a.walkDone = a.farmDone = a.herdDone = a.herbDone = true; a.unreach = (a.unreach || 0) + 1; }   // туда не пройти — выберем другую цель
    return true;
  }

  function update(dt, hour, t) {
    dt = Math.min(dt, 0.1); pathBudget = first ? 99999 : 12; pathCalls = 0; pathT0 = first ? Infinity : performance.now();
    const dn = today(), eco = economy(hour); lastEco = eco;
    if (rolesChanged) { rolesChanged = false; assignFish(); }
    if (dn !== dayKey) { dayKey = dn; [tree.x, tree.z] = treeSpot(dn); tree.t.position.set(tree.x, groundH(tree.x, tree.z), tree.z); treeOb.x = tree.x; treeOb.z = tree.z; housesKey = housesCount = ''; }
    const hc = syncHouses(eco);
    const sc = syncShops();
    if (hc === 'count' || first || sc === 'new') { rebuildNav(); placeFixedSpots(); agents.forEach(a => { a.pk = ''; }); }
    else if (hc && lastDone !== eco.done) placeFixedSpots();
    lastDone = eco.done;
    if (hc || sc) housesChanged = true;
    const fall = clamp((eco.workFrac - 0.97) / 0.03, 0, 1); tree.pivot.rotation.z = fall * 1.5; tree.pivot.position.y = fall * 0.25; tree.blob.scale.set(1 - fall * 0.5, 1 - fall * 0.5, 1);
    const grow = ((((eco.day % 6) + 6) % 6) + hour / 24) / 6;
    { const s2 = 0.25 + 0.75 * Math.min(1, grow * 1.1); if (farm.s2 !== s2) { farm.s2 = s2; farm.crops.forEach(c => { dummy.position.set(c.x, 0.17 + c.h * s2, c.z); dummy.rotation.set(0, c.ry, 0); dummy.scale.setScalar(s2); dummy.updateMatrix(); c.im.setMatrixAt(c.j, dummy.matrix); c.im.instanceMatrix.needsUpdate = true; }); } };
    farm.wheatM.color.setRGB(0.56 + 0.32 * grow, 0.75 - 0.05 * grow, 0.29 - 0.12 * grow);

    const cnt = { sick: 0, heal: 0, shopbuild: 0, rest: 0, chop: 0, carry: 0, build: 0, fish: 0, farm: 0, herd: 0, eat: 0, walk: 0, cook: 0, herb: 0, craft: 0 };
    for (const a of agents) {
      const pl = plan(a, hour, eco); a.plan = pl; a.act = pl.act;
      const goal = pl.goal || [a.x, a.z];
      if (first) { a.x = goal[0]; a.z = goal[1]; a.path = [goal]; a.pi = 0; a.pk = goal[0].toFixed(2) + ',' + goal[1].toFixed(2); }
      const gk = goal[0].toFixed(2) + ',' + goal[1].toFixed(2);
      let moving = false, arrived = Math.hypot(goal[0] - a.x, goal[1] - a.z) < 0.3 || a.reachedKey === gk + '#done';
      if (!arrived && setPath(a, goal, !!pl.farm || (a.role === 'farm' && inFarm(a.x, a.z, 0.3))) && a.path && a.path.length) {
        const wp = a.path[a.pi] || goal, dx = wp[0] - a.x, dz = wp[1] - a.z, d = Math.hypot(dx, dz);
        if (d < 0.2) a.pi++;
        else { const st = Math.min(d, a.speed * dt), px = a.x, pz = a.z; a.x += dx / d * st; a.z += dz / d * st; a.rot = Math.atan2(dx, dz); moving = true;
          if (Math.hypot(a.x - px, a.z - pz) < st * 0.3) { a.stuck += dt; if (a.stuck > 1.5) { a.stuck = 0; a.pk = ''; } } else a.stuck = 0; }
        if (a.pi >= a.path.length) { const last = a.path[a.path.length - 1]; if (Math.hypot(last[0] - goal[0], last[1] - goal[1]) < 0.6 && nav.passAt(goal[0], goal[1], !!pl.farm)) { a.x = goal[0]; a.z = goal[1]; } arrived = true; a.pk = a.pk + '#done'; a.reachedKey = a.pk; }
      }
      // задержка на месте, потом следующая цель (поле, прогулка, пастбище, травы)
      if (arrived && a.dwell != null) { a.dwell -= dt; if (a.dwell <= 0) { if (a.act === 'farm') a.farmDone = true; else if (a.act === 'herd') a.herdDone = true; else if (a.act === 'herb') a.herbDone = true; else if (a.act === 'heal') a.healDone = true; else if (a.act === 'walk') a.walkDone = true; } }
      // лесоруб: 7 ударов → бревно на плечо → отнёс → снова рубит
      if (a.act === 'chop' && arrived) { a.swing += dt * (a.mult || 1); if (a.swing >= 7) { a.swing = 0; a.carry = true; } }
      if (a.act === 'carry' && arrived) a.carry = false;
      if (a.act !== 'chop' && a.act !== 'carry') a.carry = false;
      cnt[a.act] = (cnt[a.act] || 0) + 1;

      // ----- поза тела и рук -----
      let y = groundH(a.x, a.z), rx = 0, rz = 0, sy = 1, rot = a.rot ?? 0, armL = 0.08, armR = 0.08, tool = false;
      const sitting = arrived && (a.act === 'fish' || a.act === 'rest' || a.act === 'eat' || a.act === 'sick');
      if (pl.face && arrived) rot = Math.atan2(pl.face[0] - a.x, pl.face[1] - a.z);
      if (a.act === 'eat' && arrived && pl.goal === a.dinner) rot = Math.atan2(CAMP.x - a.x, CAMP.y - a.z);
      if (moving) { const w = Math.sin(t * 9 + a.phase); y += Math.abs(w) * 0.06; rz = w * 0.04; armL = w * 0.6; armR = -w * 0.6;
        if (a.act === 'carry') { armL = armR = -2.7; } }
      else if (a.act === 'chop' && arrived) { const ph = (a.swing % 1) / 1; const k = ph < 0.62 ? ph / 0.62 : 1 - (ph - 0.62) / 0.38; armL = armR = -0.5 - 2.4 * k; rx = 0.25 * (1 - k) - 0.08; tool = true; }
      else if (a.act === 'heal' && arrived) { rx = 0.35; armL = -0.9 + Math.sin(t * 1.6 + a.phase) * 0.25; armR = -1.3; }
      else if ((a.act === 'build' || a.act === 'craft' || a.act === 'shopbuild') && arrived) { const k = Math.abs(Math.sin(t * 4.2 + a.phase)); armR = -0.6 - 1.9 * k; armL = -0.9; rx = 0.12; tool = true; }
      else if (a.act === 'farm' && arrived) { rx = 0.55 + Math.sin(t * 2.2 + a.phase) * 0.12; armL = armR = -1.0 + Math.sin(t * 2.2 + a.phase) * 0.35; }
      else if (a.act === 'cook' && arrived) { armL = armR = -1.1 + Math.sin(t * 3 + a.phase) * 0.25; rx = 0.15; }
      else if (a.act === 'herb' && arrived) { rx = 0.7; armL = armR = -1.2; }
      else if (a.act === 'fish' && arrived) { armL = armR = -1.25; }
      else if (sitting) { armL = armR = -0.75 + (a.act === 'eat' ? Math.max(0, Math.sin(t * 2.5 + a.phase)) * -0.9 : 0); }
      else if (a.act === 'herd' || a.act === 'walk') armL = armR = 0.08 + Math.sin(t * 1.3 + a.phase) * 0.05;
      if (sitting) { y -= 0.28; sy = 0.82; }
      if (a.act === 'fish' && arrived) rot = Math.PI / 2;
      a.rotShown = rot; a.yShown = y;

      const sc = a.named ? 0.62 : 0.55;
      V.set(a.x, y, a.z); E.set(rx, rot, rz, 'YXZ'); Q.setFromEuler(E); S.set(sc, sc * sy, sc); M1.compose(V, Q, S);
      bodies[a.tpl].setMatrixAt(a.slot, M1);
      const ta = tplArm[a.tpl];
      for (const [side, ang] of [[-1, armL], [1, armR]]) {
        V.set(side * ta.sx * ta.k, ta.sy * ta.k, 0); E.set(ang, 0, side * 0.14, 'XYZ'); Q.setFromEuler(E); S.set(ta.s * ta.k, ta.k, ta.s * ta.k); M2.compose(V, Q, S);
        M3.multiplyMatrices(M1, M2); const ix = a.i * 2 + (side > 0 ? 1 : 0); sleeves.setMatrixAt(ix, M3); hands.setMatrixAt(ix, M3);
      }
      // инструмент (топор/молоток) в правой руке
      V.set(ta.sx * ta.k, ta.sy * ta.k, 0); E.set(armR, 0, 0.14, 'XYZ'); Q.setFromEuler(E); S.set(1, 1, 1); M2.compose(V, Q, S);
      M3.makeTranslation(0, -0.64 * ta.k, 0); M2.multiply(M3); M3.makeRotationX(Math.PI / 2); M2.multiply(M3); M3.multiplyMatrices(M1, M2);
      if (!tool) M3.makeScale(0, 0, 0); tools.setMatrixAt(a.i, M3);
      dummy.position.set(a.x, groundH(a.x, a.z) + 0.04, a.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(a.named ? 1.1 : 1); dummy.updateMatrix(); blobs.setMatrixAt(a.i, dummy.matrix);
      if (a.role === 'wood') { const k = woodcutters.indexOf(a), show = a.act === 'carry';
        dummy.position.set(a.x, y + 0.82, a.z); dummy.rotation.set(0, rot, Math.PI / 2, 'YXZ'); dummy.scale.setScalar(show ? 1 : 0); dummy.updateMatrix(); carryLogs.setMatrixAt(k, dummy.matrix); }
      if (a.rod) { a.rod.visible = a.act === 'fish' && arrived; if (a.rod.visible) { a.rod.position.set(a.x + 1.0, y + 0.85, a.z); a.rod.rotation.set(0, 0, -1.05 + Math.sin(t * 1.3 + a.phase) * 0.04); } }
    }
    bodies.forEach(m => m && (m.instanceMatrix.needsUpdate = true));
    [sleeves, hands, blobs, carryLogs, tools].forEach(m => m.instanceMatrix.needsUpdate = true);

    cowsUpdate(dt, t);
    // звери
    for (const an of animals) {
      an.timer -= dt;
      if (an.timer <= 0) { an.vis = !an.vis; an.timer = an.vis ? 150 + Math.random() * 200 : 15 + Math.random() * 40; if (an.vis) an.placed = false; }
      if (an.vis && !an.placed) { an.placed = true; [an.x, an.z] = forestSpot(); [an.tx, an.tz] = forestSpot(); }
      an.g.visible = an.vis;
      if (!an.vis) continue;
      let dx = an.tx - an.x, dz = an.tz - an.z, d = Math.hypot(dx, dz);
      if (d < 0.5 || Math.hypot(an.tx - CAMP.x, an.tz - CAMP.y) < R + 8) { [an.tx, an.tz] = forestSpot(); continue; }
      let near = Math.hypot(an.x - CAMP.x, an.z - CAMP.y) < R + 6 || Math.hypot(an.x - tree.x, an.z - tree.z) < 12;
      if (near) { const ax = an.x - CAMP.x, az = an.z - CAMP.y, l = Math.hypot(ax, az) || 1; an.tx = an.x + ax / l * 15; an.tz = an.z + az / l * 15; dx = an.tx - an.x; dz = an.tz - an.z; d = Math.hypot(dx, dz); }
      const step = Math.min(d, an.speed * (near ? 2 : 1) * dt * (Math.sin(t * 0.7 + an.timer) > -0.3 ? 1 : 0));
      an.x += dx / d * step; an.z += dz / d * step;
      an.g.position.set(an.x, groundH(an.x, an.z) + (step > 0 ? Math.abs(Math.sin(t * 10)) * 0.04 : 0), an.z); an.g.rotation.y = Math.atan2(-dz, dx);
    }
    const b = houseObjs.find(o => o.p < 1);
    const workers = agents.filter(a => ladder(a.role)), best = workers.reduce((m, a) => !m || (a.L.rank * 10 + a.L.lvl) > (m.L.rank * 10 + m.L.lvl) ? a : m, null);
    const lifeStats = { biz: bizList.filter(b => b.state === 'open').length, building: bizList.filter(b => b.state === 'build').length, sick: lifeCur.sickToday, healed: lifeCur.healedToday, clinic: !!clinic, masters: workers.filter(a => a.L.rank >= 1).length, jobless: agents.length - workers.length, hungry: agents.filter(a => a.hungry).length,
      avgCoins: Math.round(agents.reduce((x, a) => x + (a.coins || 0), 0) / agents.length), hiredToday: agents.filter(a => a.hiredDay === eco.day).length,
      best: best ? { who: best.name, title: titleOf(best.role, best.L) } : null };
    stats = { huts: huts.length, hutOcc, hutCap: HUT_CAPACITY, ...cnt, life: lifeStats, wood: cnt.chop, animals: animals.filter(an => an.g.visible).length, shown, pop, felled: fall >= 1 ? 1 : 0, trees: 1, prog: eco.workFrac,
      harvestIn: 5 - (((eco.day % 6) + 6) % 6), eco, building: b ? { owner: b.owner?.gen || 'жителя', p: b.p } : null, housesDone: eco.done };
    first = false;
  }

  // ---------- для интерфейса ----------
  const coinsW = n => n + ' ' + plural(n, 'монета', 'монеты', 'монет');
  // путь к мечте: работа → копит монеты на брёвна → ждёт спроса → строит здание → открывает дело
  function dreamOf(a) {
    const g = goalOf(a.i); if (!g) return null;
    if (g.kind === 'job') return { wish: g.wish, kind: 'job', done: false, steps: [{ t: `Работает: ${g.wish.toLowerCase()}`, done: true }, { t: 'Растёт по должностям — каждое повышение ближе к вершине', done: false }],
      text: `Мечта — ${g.wish.toLowerCase()}. Уже работает по профессии и набирается опыта.`, thought: '' };
    const key = g.key, B = BIZ[key], price = buildCost(key), need = price + RESERVE, coins = Math.floor(a.coins || 0), mine = bizList.find(b => b.owner === a), other = !mine && bizList.find(b => b.key === key);
    const opened = mine?.state === 'open', building = mine?.state === 'build', saved = opened || building || coins >= need, demand = opened || building || !!(lifeCur.demand && B.when(lifeCur.demand));
    const steps = [{ t: saved ? 'Накопил на брёвна' : `Копит на брёвна: ${coins} из ${need} монет`, done: saved }, { t: demand ? 'Спрос появился' : `Ждёт спроса: ${B.needs}`, done: demand },
      { t: building ? `Строит ${BUILD[key].what}: ${Math.round(mine.p * 100)}%` : opened ? 'Здание построено' : `Построит ${BUILD[key].what}`, done: opened }, { t: opened ? `Открыл дело — ${B.shop.toLowerCase()}` : 'Откроет своё дело', done: opened }];
    const text = opened ? `Мечта сбылась: ${B.shop.toLowerCase()} открыта.` : building ? `Строит ${BUILD[key].what} — мечта близко.` : other ? `Дело «${B.shop}» уже открыл другой житель — остаётся расти в профессии.`
      : !saved ? `Мечтает стать: ${g.wish.toLowerCase()}. Пока работает и копит монеты.` : !demand ? 'Деньги есть — ждёт, когда появится спрос.' : 'Всё готово: скоро купит брёвна и начнёт стройку.';
    return { wish: g.wish, kind: g.kind, done: opened, steps, text, thought: opened || building ? '' : `Мечтаю стать: ${g.wish.toLowerCase()}. ${saved ? 'Деньги есть — жду подходящего момента' : `Коплю на брёвна: ${coins} из ${need} монет`}` };
  }
  function career(a) {
    const L = a.L || levelOf(0), ranks = ladder(a.role);
    if (!ranks) return { title: 'Без работы', line: 'Ищет работу: без неё нечем платить за хлеб и место в шалаше', frac: 0 };
    const next = L.top ? null : L.lvl < 10 ? `${L.lvl + 1} ур.` : ranks[L.rank + 1];
    const biz = BIZ[a.role], own = biz && bizList.find(b => b.owner === a), paid = lastHour >= PAYDAY, pay = Math.round(a.pay || 0), wage = wageOf(a.role, L, TAX);
    const mine = bizList.find(b => b.owner === a), building = mine && mine.state === 'build', healer = a.role === 'herbal';
    const money = building ? `Строит ${BUILD[mine.key].what}: готово на ${Math.round(mine.p * 100)}%. Купил ${mine.mats} ${plural(mine.mats, 'бревно', 'бревна', 'брёвен')} у лесорубов за ${coinsW(mine.paid)}. Пока строит — не работает и не получает зарплату`
      : biz ? `Своё дело — ${biz.shop.toLowerCase()}, построена на брёвна, купленные за ${coinsW(own?.paid ?? 0)}. Открыл${a.female ? 'а' : ''} на ${((own?.ready ?? 0) + 1)}-й день государства. Доход — от покупателей` + (paid ? `: сегодня ${coinsW(pay)}` : ', выручку считают вечером')
      : healer ? (clinic ? `Лекарь: принимает больных в лечебнице (до 20 в день), берёт 3 монеты за визит. Зарплата ${coinsW(wage)} в день` : `Лекарь без здания: ходит по домам и лечит (до 5 больных в день), берёт 3 монеты за визит. Лечебницу должно построить государство. Зарплата ${coinsW(wage)} в день`)
      : `Зарплата: ${coinsW(wage)} в день, выдаётся в ${PAYDAY}:00` + (TAX ? ' (налог 10% уже вычтен)' : '') + (paid ? ` · сегодня получил${a.female ? 'а' : ''} ${coinsW(pay)}` : '') + (L.top ? '' : ` · на следующей должности — больше`);
    return { title: titleOf(a.role, L), rankNo: L.rank + 1, frac: L.frac, next, speed: Math.round((a.mult - 1) * 100), top: L.top, money, biz: !!biz,
      line: L.top ? 'Вершина карьеры — своё производство!' : `Должность ${L.rank + 1} из 10 · до «${next}» ≈ ${Math.max(1, Math.round(L.dayLeft / a.talent))} ${plural(Math.max(1, Math.round(L.dayLeft / a.talent)), 'рабочий день', 'рабочих дня', 'рабочих дней')}` };
  }
  function info(a) {
    const days = Math.max(1, lastEco.day - (a.join || 0) + 1);
    const h = lastHour, energy = fatigue(a, h).energy;
    const meals = MEALS.filter(m => m <= h), since = h - (meals.at(-1) ?? (h + 24 - 19.5 - 24));
    const satiety = Math.round(clamp((a.hungry ? 55 : 100) - since * 14, 5, 100));
    const q = queue.indexOf(a), own = a.house, c = career(a), coins = Math.floor(a.coins ?? 0);
    const home = own ? (own.done ? 'Свой дом (сруб №' + (own.k + 1) + ')' : `Строит свой дом — готов на ${Math.round((houseObjs.find(o => o.owner === a)?.p || 0) * 100)}%`)
      : `Живёт в шалаше №${(a.hutNo ?? 0) + 1} (${hutOcc[a.hutNo ?? 0] ?? '?'} из ${HUT_CAPACITY} мест занято) · очередь на свой дом: ${q + 1}-й`;
    const dream = c.top ? 'Расширить своё производство и нанять работников' : own && own.done ? (a.female ? 'Завести корову и огород у дома' : 'Открыть свою мастерскую') : 'Построить собственный дом';
    return { title: a.name, prof: c.title, career: c, coins: coinsW(coins), rawCoins: coins, trait: a.traitName, goal: dreamOf(a), traits: a.traits, traitAbout: a.traits.map(k => TRAITS[k].about).join('; '), life: diary(6, a.i),
      spend: `Хлеб ${BREAD} монеты × 3 раза в день, место в шалаше — 1 монета в день` + (bizList.length ? ', покупки в мастерских' : ''), hungry: a.hungry, days, home, thought: thought(a), energy, satiety, dream, named: a.named };
  }
  let lastHour = 12;
  const raycaster = new THREE.Raycaster();
  function pick(ndc, camera) {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(bodies.filter(Boolean), false);
    for (const h of hits) { const a = byTpl[h.object.userData.tpl][h.instanceId]; if (a) return a; }
    // промах по пикселю — берём ближайшего к лучу жителя
    let best = null, bd = 0.9; const o = raycaster.ray.origin, dir = raycaster.ray.direction, p = new THREE.Vector3();
    for (const a of agents) { p.set(a.x, a.yShown + 0.5, a.z); const d = raycaster.ray.distanceToPoint(p); if (d < bd) { bd = d; best = a; } }
    return best;
  }
  // где житель может стоять: проходимая клетка; рыбак — у воды; земледелец — на своём поле (и когда уходит с него)
  const okSpot = a => a.act === 'fish' || nav.passAt(a.x, a.z, false) || (a.role === 'farm' && nav.passAt(a.x, a.z, true));
  const headPos = (a, out) => out.set(a.x, (a.yShown ?? 0) + (a.named ? 1.45 : 1.3), a.z);
  return {
    update: (dt, hour, t) => { lastHour = hour; update(dt, hour, t); },
    stats: () => stats, info, pick, headPos, thought, charThought, agents: () => agents,
    setResidents, plotsCount: () => plots.length, shopSlotsCount: () => shopSlots.length,
    byNick: nick => agents.find(a => a.name && a.name.replace(/^@/, '').toLowerCase() === nick),
    diary, dateOf,
    biz: () => bizList.map((b, j) => ({ key: b.key, state: b.state, p: b.p, shop: BIZ[b.key].shop, why: BIZ[b.key].why, what: BUILD[b.key].what, mats: b.mats, paid: b.paid, owner: b.owner.name, ownerGen: b.owner.gen, title: titleOf(b.key, b.owner.L || levelOf(0)), day: b.d, ready: b.ready, x: shops[j]?.x, z: shops[j]?.z, agent: b.owner })),
    housesChanged: () => { const c = housesChanged; housesChanged = false; return c; },
    houses: () => houseObjs.map(o => ({ x: o.plot.x, z: o.plot.z, p: o.p, owner: o.owner ? o.owner.gen : '' })),
    farm: [farm.fx, farm.fz], trees: () => [[tree.x, tree.z]], pile: [pile.x, pile.z],
    agentPath: i => { const a = agents[i]; return { x: +a.x.toFixed(2), z: +a.z.toFixed(2), act: a.act, pi: a.pi, path: a.path && a.path.map(p => p.map(v => +v.toFixed(2))), pk: a.pk, rk: a.reachedKey, wait: a.wait, stuck: a.stuck }; },
    pathStats: () => ({ pathTotal, starved }),
    unreach: () => agents.reduce((s, a) => s + (a.unreach || 0), 0),
    debugSpots: () => ({ parts: nav.parts, reachCells: nav.reach.reduce((a, v) => a + v, 0), hutsBad: agents.filter(a => !nav.passAt(a.hut[0], a.hut[1], false)).length, seatsBad: agents.filter(a => a.seat && !nav.passAt(a.seat[0], a.seat[1], false)).length, dinnerBad: agents.filter(a => !nav.passAt(a.dinner[0], a.dinner[1], false)).length, blockedCells: nav.g.reduce((s, v) => s + (v === 1), 0), cells: nav.g.length }),
    debugBad: () => agents.filter(a => !okSpot(a)).map(a => ({ i: a.i, act: a.act, role: a.role, x: +a.x.toFixed(2), z: +a.z.toFixed(2), goal: a.plan?.goal?.map(v => +v.toFixed(2)), cell: nav.g[nav.idx(a.x, a.z)] })),
    violations: () => agents.filter(a => !okSpot(a)).length,
    agentsDbg: () => agents.map(a => { const g = a.plan?.goal || [a.x, a.z]; return { i: a.i, role: a.role, act: a.act, x: +a.x.toFixed(2), z: +a.z.toFixed(2), tx: +g[0].toFixed(2), tz: +g[1].toFixed(2), hidden: a.hidden, waiting: false, pl: a.path ? a.path.length : -1, pi: a.pi, rk: a.reachedKey === (g[0].toFixed(2) + ',' + g[1].toFixed(2) + '#done'), dwell: a.dwell != null ? +a.dwell.toFixed(1) : null, wd: a.walkDone, unreach: a.unreach || 0 }; }),
  };
}
