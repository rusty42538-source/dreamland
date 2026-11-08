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

const MAX_SHOWN = 700;
const WORK_FROM = 8, WORK_TO = 18, LUNCH_FROM = 13, LUNCH_TO = 13.7;
const FOUND_DAY = Math.floor(Date.UTC(2026, 10, 8, 0, 0) / 864e5);   // 8 ноября 2026 — первый рабочий день
const LOGS_PER_DAY = 8, HOUSE_COST = 16;                              // 2 лесоруба: 8 брёвен в день, дом — 16 брёвен
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
  for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.06), HM.win); w.position.set(sx * 0.95, 1.25, 2.4 / 2 + 0.12); g.add(w); }
  return g;
}

export const HUT_CAPACITY = 20;
export const taxRateOf = D => { const l = (D.laws || []).find(x => x.policy === 'tax10' && !x.veto); return l ? 0.1 : 0; };
export function housesDoneAt(hour, rate = 0) {
  const day = Math.floor((Date.now() + 3 * 3600e3) / 864e5) - FOUND_DAY, wf = clamp((hour - WORK_FROM) / (WORK_TO - WORK_FROM), 0, 1);
  return Math.min(40, Math.floor(LOGS_PER_DAY * (1 - rate) * (Math.max(0, day) + (day >= 0 ? wf : 0)) / HOUSE_COST));
}
export const hutsNeeded = (pop, own) => Math.max(1, Math.ceil(Math.max(0, pop - own) / HUT_CAPACITY));

export function createSim(world, D) {
  const { scene, groundH, CAMP, riverX, person, CHARS, huts, pen } = world;
  const TAX = taxRateOf(D), TAX_FAIL = TAX > 0 && TAX < 0.1;
  const pop = D.population, shown = Math.min(Math.max(8, Math.round(pop * 0.5)), MAX_SHOWN);
  const R = clamp(9 + Math.sqrt(pop) * 0.6, 12, 34);
  const okLand = (x, z) => x < riverX(z) - 4.2;
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

  // ---------- участки под дома (заранее, по кругу за шалашами) ----------
  const plots = [];
  { const r = seeded(9001);
    for (let i = 0; i < 4000 && plots.length < 40; i++) {
      const a = r() * 6.283, d = 9 + Math.sqrt(r()) * (R + 4 - 9), x = CAMP.x + Math.cos(a) * d, z = CAMP.y + Math.sin(a) * d * 0.9;
      if (!okLand(x - 2, z) || !freeOf(x, z, 2.4) || inFarm(x, z, 3.5) || plots.some(p => Math.hypot(p.x - x, p.z - z) < 4.6)) continue;
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
  const resByNum = new Map((D.residents || []).map(r => [r.num, r]));
  const agents = [];
  const nFish = clamp(Math.round(shown * 0.08), 2, 16), nFarm = clamp(Math.round(shown * 0.12), 2, 40);
  for (let i = 0; i < shown; i++) {
    let tpl = Math.floor(hash(i + 1) * 12), role = 'walk', named = null;
    if (i < 6) { named = Object.keys(NAMED)[i]; tpl = NAMED[named]; }
    if (named === 'grisha') role = 'herd'; else if (named === 'pakhom') role = 'elder'; else if (named === 'timosha') role = 'wood';
    else if (named === 'marfa') role = 'cook'; else if (named === 'nyura') role = 'herbal';
    else if (i === 6) role = 'wood'; else if (i < 7 + nFish) role = 'fish'; else if (i < 7 + nFish + nFarm) role = 'farm';
    const res = resByNum.get(i + 1);
    const fem = tplDefs[tpl].female || named === 'marfa' || named === 'nyura';
    agents.push({ i, tpl, role, named, name: named ? names[named] : res ? '@' + res.nick : null, gen: named ? gens[named] : res ? '@' + res.nick : (fem ? 'жительницы' : 'жителя') + ' №' + (i + 1), x: 0, z: 0, tx: 0, tz: 0, path: null, pk: '', speed: 1.1 + hash(i + 3) * 0.45,
      swing: hash(i + 21) * 7, wake: 6 + hash(i + 7) * 1.0, sleep: 21.3 + hash(i + 8) * 1.4, phase: hash(i + 5) * 6.28, female: tplDefs[tpl].female || named === 'marfa' || named === 'nyura',
      fireNight: role === 'elder', hidden: false, act: 'walk', wait: 0, stuck: 0 });
  }
  const fireN = clamp(Math.round(shown * 0.07), 2, 12);
  agents.filter(a => a.role === 'walk').sort((p, q) => hash(p.i + 11) - hash(q.i + 11)).slice(0, fireN - 1).forEach(a => a.fireNight = true);

  // очередь на собственный дом: сначала именные жители, потом остальные по номеру
  const queue = ['grisha', 'marfa', 'arkadiy', 'timosha', 'nyura'].map(n => agents.find(a => a.named === n)).filter(Boolean)
    .concat(agents.filter(a => !a.named));
  const builders = agents.filter(a => a.role === 'walk' && !a.fireNight).slice(0, 2);       // двое плотников
  builders.forEach(a => a.role = 'build');

  // ---------- экономика: брёвна → дома (детерминированно от времени) ----------
  const economy = (hour) => {
    const day = today() - FOUND_DAY, workFrac = clamp((hour - WORK_FROM) / (WORK_TO - WORK_FROM), 0, 1);
    const daysWork = Math.max(0, day) + (day >= 0 ? workFrac : 0);
    const logsAll = LOGS_PER_DAY * daysWork, logs = logsAll * (1 - TAX), done = Math.min(queue.length, plots.length, Math.floor(logs / HOUSE_COST));
    const prog = done < Math.min(queue.length, plots.length) ? (logs % HOUSE_COST) / HOUSE_COST : 0;
    const fish = Math.round(nFish * 4 * daysWork), harvests = Math.max(0, Math.floor((day + 1) / 6));
    return { day, logs: Math.floor(logsAll), done, prog, fish, harvests, workFrac, tax: TAX, reserve: { logs: Math.floor(logsAll * TAX), fish: Math.floor(fish * TAX) } };
  };

  // ---------- дома на карте ----------
  const houseObjs = [];       // { k, owner, plot, stage, obj }
  let housesKey = '';
  const houseObs = [];
  function syncHouses(eco) {
    const key = eco.done + ':' + Math.floor(eco.prog * 20);
    if (key === housesKey) return false;
    const countKey = eco.done + (eco.prog > 0 ? 1 : 0), countChanged = !housesKey || housesKey.split(':')[2] !== String(countKey); housesKey = key + ':' + countKey;
    for (const h of houseObjs) scene.remove(h.obj);
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
    const all = OBS.concat(houseObs, [treeOb]);
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
  const fishers = agents.filter(a => a.role === 'fish');
  const rodMat = new THREE.MeshBasicMaterial({ color: '#3a2a1a' });
  fishers.forEach((a, k) => { const z = CAMP.y - R * 0.8 + (k / Math.max(1, fishers.length - 1)) * R * 1.6; a.spotRaw = [riverX(z) - 3.45, z];
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 2.2, 4), rodMat); rod.visible = false; scene.add(rod); a.rod = rod; });

  function placeFixedSpots() {
    const owners = agents.filter(a => a.house && a.house.done), lodgers = agents.filter(a => !(a.house && a.house.done));
    const inHuts = Math.max(0, pop - lastEco.done);                         // жители без своего дома
    hutOcc = huts.map((_, h) => clamp(inHuts - h * HUT_CAPACITY, 0, HUT_CAPACITY));
    const filled = hutOcc.filter(v => v > 0).length || 1;
    lodgers.forEach((a, k) => { const h = Math.min(filled - 1, Math.floor(k * filled / Math.max(1, lodgers.length))); a.hutNo = h;
      const hh = huts[h] || { x: CAMP.x + 3, z: CAMP.y }; a.hut = freeNear(...hutDoor(hh)); });
    owners.forEach(a => { a.hutNo = null; a.hut = freeNear(...hutDoor(huts[0] || { x: CAMP.x + 3, z: CAMP.y })); });
    agents.forEach(a => { if (a.house) a.house.door = freeNear(a.house.x, a.house.z); });
    const watchers = agents.filter(a => a.fireNight);
    watchers.forEach((a, k) => { const ang = k / watchers.length * 6.283; a.seat = freeNear(CAMP.x + Math.cos(ang) * 2.7, CAMP.y + Math.sin(ang) * 2.7); });
    woodcutters.forEach((a, k) => a.pileSpot = freeNear(pile.x + Math.sin(k * 2.4) * 1.5, pile.z + Math.cos(k * 2.4) * 1.5));
    fishers.forEach(a => a.spot = freeNear(...a.spotRaw));
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
  // ---------- «Z z z» над шалашами и домами, где спят ----------
  const zTex = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d');
    x.font = '900 46px Inter, sans-serif'; x.lineWidth = 8; x.strokeStyle = 'rgba(30,25,60,.85)'; x.fillStyle = '#f4f0ff';
    [['Z', 18, 112, 1], ['z', 62, 74, 0.8], ['z', 92, 40, 0.6]].forEach(([ch, px, py, k]) => { x.save(); x.translate(px, py); x.scale(k, k); x.strokeText(ch, 0, 0); x.fillText(ch, 0, 0); x.restore(); });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const zPool = [];
  function zzz(t, spots) {
    while (zPool.length < spots.length) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false, fog: false })); sp.scale.set(1.5, 1.5, 1); sp.renderOrder = 5; scene.add(sp); zPool.push(sp); }
    zPool.forEach((sp, k) => { const p = spots[k]; sp.visible = !!p; if (!p) return; const ph = (t * 0.35 + k * 0.37) % 1;
      sp.position.set(p[0] + ph * 0.5, p[2] + 0.4 + ph * 1.1, p[1]); sp.material.opacity = Math.sin(ph * Math.PI) * 0.95; });
  }

  // ---------- коровы в загоне: пасутся, жуют траву, ночью лежат ----------
  const cows = [];
  scene.traverse(o => { if (o.userData.cow) cows.push(o); });
  cows.forEach((g, i) => { const head = g.children.find(o => o.userData.cowHead); g.remove(head);
    const body = bakeGroup(g); body.castShadow = true; g.clear(); g.add(body);
    const hm = bakeGroup(head); const hp = new THREE.Group(); hp.position.copy(head.position); hp.add(hm); hm.castShadow = true; g.add(hp);
    g.userData.st = { head: hp, x: g.position.x, z: g.position.z, tx: g.position.x, tz: g.position.z, rot: g.rotation.y, mode: 'graze', timer: 2 + i * 3, ph: i * 1.7, nod: 0 }; });
  const penSpot = () => { for (let i = 0; i < 20; i++) { const [x, z] = penSpot0(); if (cows.every(o => Math.hypot(o.userData.st.tx - x, o.userData.st.tz - z) > 1.4)) return [x, z]; } return penSpot0(); };
  const penSpot0 = () => { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()); return [pen.x + Math.cos(a) * r * 2.2, pen.y + Math.sin(a) * r * 1.4]; };
  function cowsUpdate(dt, t, hour) {
    const night = hour >= 22 || hour < 5.5;
    for (const g of cows) { const c = g.userData.st;
      if (night) { c.mode = 'lie'; }
      else if (c.mode === 'lie') { c.mode = 'graze'; c.timer = 3; }
      c.timer -= dt;
      if (c.mode !== 'lie' && c.timer <= 0) {
        if (c.mode === 'walk' || Math.random() < 0.5) { c.mode = Math.random() < 0.75 ? 'graze' : 'look'; c.timer = c.mode === 'graze' ? 8 + Math.random() * 12 : 3 + Math.random() * 3; }
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
  const forestSpot = () => { for (let i = 0; i < 60; i++) { const x = -48 + Math.random() * 36, z = -55 + Math.random() * 70;
      if (x < riverX(z) - 6 && Math.hypot(x - CAMP.x, z - CAMP.y) > R + 8 && Math.hypot(x - tree.x, z - tree.z) > 10 && !inFarm(x, z, 8)) return [x, z]; } return [-40, -30]; };

  // ---------- распорядок дня ----------
  const PROF = { wood: 'Лесоруб', fish: 'Рыбак', farm: 'Земледелец', herd: 'Скотовод', elder: 'Староста', build: 'Плотник', cook: 'Пекарь', herbal: 'Травница', walk: 'Разнорабочий' };
  function plan(a, h, eco) {
    const night = h >= 22.5 || h < 6, lunch = h >= LUNCH_FROM && h < LUNCH_TO, work = h >= WORK_FROM && h < WORK_TO && !lunch;
    const home = a.house && a.house.done && a.house.door ? a.house.door : a.hut;
    if ((h >= a.sleep || h < a.wake) && !(a.fireNight && night)) return { act: 'sleep', goal: home };
    if (a.fireNight && night) return { act: 'fire', goal: a.seat };
    if (h < a.wake + 0.45) return { act: 'eat', goal: home, what: 'Завтракаю у дома' };
    if (lunch) return { act: 'eat', goal: home, what: 'Обед! Марфа испекла хлеб' };
    if (h >= 19 && h < 20.2) return { act: 'eat', goal: a.dinner, what: 'Ужинаем все вместе у костра' };
    const building = houseObjs.find(o => o.p < 1);
    if (work && building && (a.role === 'build' || building.owner === a)) {
      const side = a.role === 'build' ? (builders[0] === a ? 1 : -1) : 0, pl = building.plot;
      const off = side === 0 ? [Math.sin(pl.rot) * 2.3, Math.cos(pl.rot) * 2.3] : [Math.cos(pl.rot) * 2.2 * side, -Math.sin(pl.rot) * 2.2 * side];
      return { act: 'build', goal: freeNear(pl.x + off[0], pl.z + off[1]), face: [pl.x, pl.z] };
    }
    if (a.role === 'wood' && work && eco.workFrac < 0.97) {
      if (a.carry) { const b = houseObjs.find(o => o.p < 1); const g2 = b ? freeNear(b.plot.x - Math.cos(b.plot.rot) * 2.6, b.plot.z + Math.sin(b.plot.rot) * 2.6) : a.pileSpot; return { act: 'carry', goal: g2, to: b ? b.owner : null }; }
      const side = woodcutters[0] === a ? 1 : -1; return { act: 'chop', goal: freeNear(tree.x + side * 0.8, tree.z + 0.85), face: [tree.x, tree.z] };
    }
    if (a.role === 'fish' && h >= 7 && h < 20) return { act: 'fish', goal: a.spot };
    if (a.role === 'farm' && h >= 7 && h < 19) { if (!a.farmGoal || a.farmDone) { a.farmGoal = freeNear(...farm.spot(), true); a.farmDone = false; a.dwell = 4 + Math.random() * 8; } return { act: 'farm', goal: a.farmGoal, farm: true }; }
    if (a.role === 'herd' && h < 19) { if (!a.herdGoal || a.herdDone) { a.herdGoal = freeNear(pen.x - 4.6 - Math.random() * 1.3, pen.y - 2 + Math.random() * 4); a.herdDone = false; a.dwell = 3 + Math.random() * 5; } return { act: 'herd', goal: a.herdGoal }; }
    if (a.role === 'cook' && work) return { act: 'cook', goal: freeNear(pile.x + 1.4, pile.z - 1.2), face: [CAMP.x, CAMP.y] };
    if (a.role === 'herbal' && work) { if (!a.herbGoal || a.herbDone) { a.herbGoal = randomSpot(R + 2); a.herbDone = false; a.dwell = 5 + Math.random() * 6; } return { act: 'herb', goal: a.herbGoal }; }
    if (!a.walkGoal || a.walkDone) { a.walkGoal = h >= 18 ? randomSpot(9) : randomSpot(); a.walkDone = false; a.dwell = 2 + Math.random() * 8; }
    return { act: 'walk', goal: a.walkGoal };
  }

  // мысли жителя — по его делам, дому и состоянию поселения
  function thought(a) {
    const e = lastEco, b = houseObjs.find(o => o.p < 1), q = queue.indexOf(a), act = a.act;
    const own = a.house, nextOwner = b && b.owner ? b.owner.gen : null;
    switch (act) {
      case 'sleep': return own && own.done ? 'Сплю в своём доме. Тепло!' : 'Сплю… Снится собственный дом';
      case 'fire': return 'Сторожу костёр, пока все спят';
      case 'eat': return a.plan.what || 'Ем';
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
    if (dn !== dayKey) { dayKey = dn; [tree.x, tree.z] = treeSpot(dn); tree.t.position.set(tree.x, groundH(tree.x, tree.z), tree.z); treeOb.x = tree.x; treeOb.z = tree.z; housesKey = ''; }
    const hc = syncHouses(eco);
    if (hc === 'count' || first) { rebuildNav(); placeFixedSpots(); agents.forEach(a => { a.pk = ''; }); }
    else if (hc && lastDone !== eco.done) placeFixedSpots();
    lastDone = eco.done;
    if (hc) housesChanged = true;
    const fall = clamp((eco.workFrac - 0.97) / 0.03, 0, 1); tree.pivot.rotation.z = fall * 1.5; tree.pivot.position.y = fall * 0.25; tree.blob.scale.set(1 - fall * 0.5, 1 - fall * 0.5, 1);
    const grow = ((((eco.day % 6) + 6) % 6) + hour / 24) / 6;
    { const s2 = 0.25 + 0.75 * Math.min(1, grow * 1.1); if (farm.s2 !== s2) { farm.s2 = s2; farm.crops.forEach(c => { dummy.position.set(c.x, 0.17 + c.h * s2, c.z); dummy.rotation.set(0, c.ry, 0); dummy.scale.setScalar(s2); dummy.updateMatrix(); c.im.setMatrixAt(c.j, dummy.matrix); c.im.instanceMatrix.needsUpdate = true; }); } };
    farm.wheatM.color.setRGB(0.56 + 0.32 * grow, 0.75 - 0.05 * grow, 0.29 - 0.12 * grow);
    const nightK = hour >= 20 || hour < 6.5 ? 1 : 0; HM.win.emissiveIntensity = nightK * 1.4;

    const cnt = { sleep: 0, fire: 0, chop: 0, carry: 0, build: 0, fish: 0, farm: 0, herd: 0, eat: 0, walk: 0, cook: 0, herb: 0 };
    for (const a of agents) {
      const pl = plan(a, hour, eco); a.plan = pl; a.act = pl.act;
      const goal = pl.goal || [a.x, a.z];
      if (first) { a.x = goal[0]; a.z = goal[1]; a.path = [goal]; a.pi = 0; a.pk = goal[0].toFixed(2) + ',' + goal[1].toFixed(2); }
      const gk = goal[0].toFixed(2) + ',' + goal[1].toFixed(2);
      let moving = false, arrived = Math.hypot(goal[0] - a.x, goal[1] - a.z) < 0.3 || a.reachedKey === gk + '#done';
      if (!arrived && setPath(a, goal, !!pl.farm) && a.path && a.path.length) {
        const wp = a.path[a.pi] || goal, dx = wp[0] - a.x, dz = wp[1] - a.z, d = Math.hypot(dx, dz);
        if (d < 0.2) a.pi++;
        else { const st = Math.min(d, a.speed * dt), px = a.x, pz = a.z; a.x += dx / d * st; a.z += dz / d * st; a.rot = Math.atan2(dx, dz); moving = true;
          if (Math.hypot(a.x - px, a.z - pz) < st * 0.3) { a.stuck += dt; if (a.stuck > 1.5) { a.stuck = 0; a.pk = ''; } } else a.stuck = 0; }
        if (a.pi >= a.path.length) { const last = a.path[a.path.length - 1]; if (Math.hypot(last[0] - goal[0], last[1] - goal[1]) < 0.6 && nav.passAt(goal[0], goal[1], !!pl.farm)) { a.x = goal[0]; a.z = goal[1]; } arrived = true; a.pk = a.pk + '#done'; a.reachedKey = a.pk; }
      }
      // задержка на месте, потом следующая цель (поле, прогулка, пастбище, травы)
      if (arrived && a.dwell != null) { a.dwell -= dt; if (a.dwell <= 0) { if (a.act === 'farm') a.farmDone = true; else if (a.act === 'herd') a.herdDone = true; else if (a.act === 'herb') a.herbDone = true; else if (a.act === 'walk') a.walkDone = true; } }
      // лесоруб: 7 ударов → бревно на плечо → отнёс → снова рубит
      if (a.act === 'chop' && arrived) { a.swing += dt; if (a.swing >= 7) { a.swing = 0; a.carry = true; } }
      if (a.act === 'carry' && arrived) a.carry = false;
      if (a.act !== 'chop' && a.act !== 'carry') a.carry = false;
      a.hidden = a.act === 'sleep' && arrived;
      cnt[a.act] = (cnt[a.act] || 0) + 1;

      // ----- поза тела и рук -----
      let y = groundH(a.x, a.z), rx = 0, rz = 0, sy = 1, rot = a.rot ?? 0, armL = 0.08, armR = 0.08, tool = false;
      const sitting = arrived && (a.act === 'fish' || a.act === 'fire' || a.act === 'eat');
      if (pl.face && arrived) rot = Math.atan2(pl.face[0] - a.x, pl.face[1] - a.z);
      if (a.act === 'fire' && arrived) rot = Math.atan2(CAMP.x - a.x, CAMP.y - a.z);
      if (a.act === 'eat' && arrived && pl.goal === a.dinner) rot = Math.atan2(CAMP.x - a.x, CAMP.y - a.z);
      if (moving) { const w = Math.sin(t * 9 + a.phase); y += Math.abs(w) * 0.06; rz = w * 0.04; armL = w * 0.6; armR = -w * 0.6;
        if (a.act === 'carry') { armL = armR = -2.7; } }
      else if (a.act === 'chop' && arrived) { const ph = (a.swing % 1) / 1; const k = ph < 0.62 ? ph / 0.62 : 1 - (ph - 0.62) / 0.38; armL = armR = -0.5 - 2.4 * k; rx = 0.25 * (1 - k) - 0.08; tool = true; }
      else if (a.act === 'build' && arrived) { const k = Math.abs(Math.sin(t * 4.2 + a.phase)); armR = -0.6 - 1.9 * k; armL = -0.9; rx = 0.12; tool = true; }
      else if (a.act === 'farm' && arrived) { rx = 0.55 + Math.sin(t * 2.2 + a.phase) * 0.12; armL = armR = -1.0 + Math.sin(t * 2.2 + a.phase) * 0.35; }
      else if (a.act === 'cook' && arrived) { armL = armR = -1.1 + Math.sin(t * 3 + a.phase) * 0.25; rx = 0.15; }
      else if (a.act === 'herb' && arrived) { rx = 0.7; armL = armR = -1.2; }
      else if (a.act === 'fish' && arrived) { armL = armR = -1.25; }
      else if (sitting) { armL = armR = -0.75 + (a.act === 'eat' ? Math.max(0, Math.sin(t * 2.5 + a.phase)) * -0.9 : 0); }
      else if (a.act === 'herd' || a.act === 'walk') armL = armR = 0.08 + Math.sin(t * 1.3 + a.phase) * 0.05;
      if (sitting) { y -= 0.28; sy = 0.82; }
      if (a.act === 'fish' && arrived) rot = Math.PI / 2;
      a.rotShown = rot; a.yShown = y;

      const sc = a.hidden ? 0 : (a.named ? 0.62 : 0.55);
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
      if (!tool || a.hidden) M3.makeScale(0, 0, 0); tools.setMatrixAt(a.i, M3);
      dummy.position.set(a.x, groundH(a.x, a.z) + 0.04, a.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(a.hidden ? 0 : (a.named ? 1.1 : 1)); dummy.updateMatrix(); blobs.setMatrixAt(a.i, dummy.matrix);
      if (a.role === 'wood') { const k = woodcutters.indexOf(a), show = a.act === 'carry' && !a.hidden;
        dummy.position.set(a.x, y + 0.82, a.z); dummy.rotation.set(0, rot, Math.PI / 2, 'YXZ'); dummy.scale.setScalar(show ? 1 : 0); dummy.updateMatrix(); carryLogs.setMatrixAt(k, dummy.matrix); }
      if (a.rod) { a.rod.visible = a.act === 'fish' && arrived && !a.hidden; if (a.rod.visible) { a.rod.position.set(a.x + 1.0, y + 0.85, a.z); a.rod.rotation.set(0, 0, -1.05 + Math.sin(t * 1.3 + a.phase) * 0.04); } }
    }
    bodies.forEach(m => m && (m.instanceMatrix.needsUpdate = true));
    [sleeves, hands, blobs, carryLogs, tools].forEach(m => m.instanceMatrix.needsUpdate = true);

    cowsUpdate(dt, t, hour);
    { const sp = new Map(); for (const a of agents) if (a.hidden) { const home = a.house && a.house.done ? a.house : a.hutNo != null ? huts[a.hutNo] : null;
        if (home && !sp.has(home)) sp.set(home, [home.x, home.z, groundH(home.x, home.z) + (home === a.house ? 3.4 : 3.0)]); }
      zzz(t, [...sp.values()]); }
    // звери
    const night = hour >= 22.5 || hour < 6;
    for (const an of animals) {
      an.timer -= dt;
      if (an.timer <= 0) { an.vis = !an.vis; an.timer = an.vis ? 150 + Math.random() * 200 : 15 + Math.random() * 40; if (an.vis) an.placed = false; }
      if (an.vis && !an.placed) { an.placed = true; [an.x, an.z] = forestSpot(); [an.tx, an.tz] = forestSpot(); }
      an.g.visible = an.vis && !(night && an.kind === 'hare');
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
    stats = { huts: huts.length, hutOcc, hutCap: HUT_CAPACITY, ...cnt, wood: cnt.chop, animals: animals.filter(an => an.g.visible).length, shown, pop, felled: fall >= 1 ? 1 : 0, trees: 1, prog: eco.workFrac,
      harvestIn: 5 - (((eco.day % 6) + 6) % 6), eco, building: b ? { owner: b.owner?.gen || 'жителя', p: b.p } : null, housesDone: eco.done };
    first = false;
  }

  // ---------- для интерфейса ----------
  function info(a) {
    const days = Math.max(1, lastEco.day + 1), lvl = days >= 10 ? 'мастер' : days >= 3 ? '' : 'ученик';
    const h = lastHour, energy = a.act === 'sleep' ? 100 : Math.round(clamp(100 - (h - a.wake) / (a.sleep - a.wake) * 70, 20, 100));
    const meals = [a.wake + 0.3, LUNCH_FROM + 0.3, 19.5].filter(m => m <= h), since = h - (meals.at(-1) ?? (h + 24 - 19.5 - 24));
    const satiety = Math.round(clamp(100 - since * 14, 15, 100));
    const q = queue.indexOf(a), own = a.house;
    const home = own ? (own.done ? 'Свой дом (сруб №' + (own.k + 1) + ')' : `Строит свой дом — готов на ${Math.round((houseObjs.find(o => o.owner === a)?.p || 0) * 100)}%`)
      : `Живёт в шалаше №${(a.hutNo ?? 0) + 1} (${hutOcc[a.hutNo ?? 0] ?? '?'} из ${HUT_CAPACITY} мест занято) · очередь на свой дом: ${q + 1}-й`;
    const dream = own && own.done ? (a.female ? 'Завести корову и огород у дома' : 'Открыть свою мастерскую') : 'Построить собственный дом';
    return { title: a.name || (a.female ? 'Жительница' : 'Житель') + ' №' + (a.i + 1), prof: (PROF[a.role] || 'Житель') + (lvl ? ' · ' + lvl : ''), days, home, thought: thought(a), energy, satiety, dream, named: a.named };
  }
  let lastHour = 12;
  const raycaster = new THREE.Raycaster();
  function pick(ndc, camera) {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(bodies.filter(Boolean), false);
    for (const h of hits) { const a = byTpl[h.object.userData.tpl][h.instanceId]; if (a && !a.hidden) return a; }
    // промах по пикселю — берём ближайшего к лучу жителя
    let best = null, bd = 0.9; const o = raycaster.ray.origin, dir = raycaster.ray.direction, p = new THREE.Vector3();
    for (const a of agents) { if (a.hidden) continue; p.set(a.x, a.yShown + 0.5, a.z); const d = raycaster.ray.distanceToPoint(p); if (d < bd) { bd = d; best = a; } }
    return best;
  }
  const headPos = (a, out) => out.set(a.x, (a.yShown ?? 0) + (a.named ? 1.45 : 1.3), a.z);
  return {
    update: (dt, hour, t) => { lastHour = hour; update(dt, hour, t); },
    stats: () => stats, info, pick, headPos, thought, agents: () => agents,
    housesChanged: () => { const c = housesChanged; housesChanged = false; return c; },
    houses: () => houseObjs.map(o => ({ x: o.plot.x, z: o.plot.z, p: o.p, owner: o.owner ? o.owner.gen : '' })),
    farm: [farm.fx, farm.fz], trees: () => [[tree.x, tree.z]], pile: [pile.x, pile.z],
    agentPath: i => { const a = agents[i]; return { x: +a.x.toFixed(2), z: +a.z.toFixed(2), act: a.act, pi: a.pi, path: a.path && a.path.map(p => p.map(v => +v.toFixed(2))), pk: a.pk, rk: a.reachedKey, wait: a.wait, stuck: a.stuck }; },
    pathStats: () => ({ pathTotal, starved }),
    unreach: () => agents.reduce((s, a) => s + (a.unreach || 0), 0),
    debugSpots: () => ({ parts: nav.parts, reachCells: nav.reach.reduce((a, v) => a + v, 0), hutsBad: agents.filter(a => !nav.passAt(a.hut[0], a.hut[1], false)).length, seatsBad: agents.filter(a => a.seat && !nav.passAt(a.seat[0], a.seat[1], false)).length, dinnerBad: agents.filter(a => !nav.passAt(a.dinner[0], a.dinner[1], false)).length, blockedCells: nav.g.reduce((s, v) => s + (v === 1), 0), cells: nav.g.length }),
    debugBad: () => agents.filter(a => !a.hidden && a.act !== 'farm' && a.act !== 'fish' && !nav.passAt(a.x, a.z, false)).map(a => ({ i: a.i, act: a.act, role: a.role, x: +a.x.toFixed(2), z: +a.z.toFixed(2), goal: a.plan?.goal?.map(v => +v.toFixed(2)), cell: nav.g[nav.idx(a.x, a.z)] })),
    violations: () => agents.filter(a => !a.hidden && !(a.act === 'farm') && !nav.passAt(a.x, a.z, false) && !(a.act === 'fish')).length,
    agentsDbg: () => agents.map(a => { const g = a.plan?.goal || [a.x, a.z]; return { i: a.i, role: a.role, act: a.act, x: +a.x.toFixed(2), z: +a.z.toFixed(2), tx: +g[0].toFixed(2), tz: +g[1].toFixed(2), hidden: a.hidden, waiting: false, pl: a.path ? a.path.length : -1, pi: a.pi, rk: a.reachedKey === (g[0].toFixed(2) + ',' + g[1].toFixed(2) + '#done'), dwell: a.dwell != null ? +a.dwell.toFixed(1) : null, wd: a.walkDone, unreach: a.unreach || 0 }; }),
  };
}
