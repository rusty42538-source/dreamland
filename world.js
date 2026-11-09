// «Цивилизация с нуля» — 3D-мир государства (Three.js, low-poly)
// Режимы (параметры URL):
//   ?mode=map&state=<base64 JSON>   — карта государства
//   ?mode=char&id=grisha            — портрет жителя
// window.renderAt(t) — кадр анимации (t от 0 до 1), для видео
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const W = +params.get('w') || 1080, H = +params.get('h') || 1920;
const MODE = params.get('mode') || 'map';
const STATE = params.get('state') ? JSON.parse(decodeURIComponent(escape(atob(params.get('state'))))) : {};

// ---------- общие утилиты ----------
let seed = 12345;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const rr = (a, b) => a + (b - a) * rand();
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

const mats = {};
function mat(color, o = {}) {
  const k = color + JSON.stringify(o);
  if (!mats[k]) mats[k] = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...o });
  return mats[k];
}
function mesh(geo, color, o) {
  const m = new THREE.Mesh(geo, typeof color === 'string' ? mat(color, o) : color);
  m.castShadow = true; m.receiveShadow = true; return m;
}
function at(obj, x, y, z) { obj.position.set(x, y, z); return obj; }

// ---------- renderer / scene ----------
const SITE = typeof window !== 'undefined' && window.WORLD_SITE;
const renderer = new THREE.WebGLRenderer({ antialias: !SITE || !!window.WORLD_VIDEO, preserveDrawingBuffer: !SITE || !!window.WORLD_VIDEO, powerPreference: SITE ? 'high-performance' : 'default' });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = SITE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();

function gradientTexture(stops) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 512);
  stops.forEach(([p, col]) => gr.addColorStop(p, col));
  g.fillStyle = gr; g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// =====================================================================
//                              ЖИТЕЛИ
// =====================================================================
const SKIN = '#e9b58f';
const CHARS = {
  grisha: { name: 'Гриша', height: 1.05, girth: 1.3, shirt: '#efe3c8', vest: '#7a4a28', pants: '#4b3a2a',
    beard: { color: '#c0522a', size: 1.25 }, hair: { color: '#c0522a', style: 'short' }, hat: 'straw', cow: true },
  pakhom: { name: 'Староста Пахом', height: 1.0, girth: 1.0, coat: '#8d8f94', coatLong: true, shirt: '#8d8f94',
    beard: { color: '#d9d9d6', size: 0.8 }, hair: { color: '#d9d9d6', style: 'short' }, hat: 'fur', hatColor: '#5b4433', acc: ['staff'] },
  arkadiy: { name: 'Аркадий', height: 1.02, girth: 0.82, coat: '#4f7a3a', shirt: '#4f7a3a', pants: '#3d3a33',
    mustache: '#2b2118', hair: { color: '#2b2118', style: 'short' }, acc: ['bag'], patches: true },
  marfa: { name: 'Марфа', height: 0.95, girth: 1.3, shirt: '#d9c7a3', skirt: '#a8452f', apron: '#f7f3ea',
    hat: 'kerchief', hatColor: '#cf2f2a', cheeks: true, hair: { color: '#6b4226', style: 'none' }, flour: true },
  timosha: { name: 'Тимоша', height: 0.98, girth: 0.9, shirt: '#c8b48a', vest: '#9a7650', vestFur: true, pants: '#5a4a35',
    hair: { color: '#ecd27a', style: 'messy' }, acc: ['bow'], young: true },
  nyura: { name: 'Баба Нюра', height: 0.8, girth: 1.0, shirt: '#6d5a4a', skirt: '#4a3d33', shawl: '#2f5fa8',
    hair: { color: '#e4e4e0', style: 'bun' }, acc: ['basket'], cheeks: true, old: true },
};

function person(p) {
  const g = new THREE.Group();
  const s = p.girth || 1;
  const longLower = p.coatLong || p.skirt;
  const legH = 0.72, torsoH = 0.72;
  // ноги / юбка
  if (longLower) {
    const sk = mesh(new THREE.CylinderGeometry(0.3 * s, 0.44 * s, legH + 0.05, 9), p.skirt || p.coat);
    g.add(at(sk, 0, (legH + 0.05) / 2, 0));
  } else {
    for (const sx of [-1, 1]) {
      g.add(at(mesh(new THREE.CylinderGeometry(0.1 * s, 0.09 * s, legH, 6), p.pants || '#4b3a2a'), sx * 0.13 * s, legH / 2, 0));
      g.add(at(mesh(new THREE.BoxGeometry(0.17 * s, 0.1, 0.28), '#3a2a1e'), sx * 0.13 * s, 0.05, 0.05));
    }
  }
  // туловище
  const ty = legH + torsoH / 2;
  const torso = mesh(new THREE.CylinderGeometry(0.27 * s, 0.33 * s, torsoH, 9), p.coat || p.shirt);
  g.add(at(torso, 0, ty, 0));
  if (s > 1.15) g.add(at(mesh(new THREE.SphereGeometry(0.3 * s, 8, 6), p.coat || p.shirt), 0, ty - 0.08, 0.12 * s));
  if (p.vest) {
    const vest = mesh(new THREE.CylinderGeometry(0.29 * s, 0.35 * s, torsoH * 0.95, 9, 1, true, 0.55, Math.PI * 2 - 1.1),
      mat(p.vest, { side: THREE.DoubleSide }));
    g.add(at(vest, 0, ty, 0));
    if (s > 1.15) { // жилет на животе — по бокам
      for (const sx of [-1, 1]) g.add(at(mesh(new THREE.BoxGeometry(0.12, torsoH * 0.9, 0.3), p.vest), sx * 0.3 * s, ty, 0.08));
    }
    if (p.vestFur) g.add(at(mesh(new THREE.TorusGeometry(0.28 * s, 0.06, 5, 10), '#e8dcc4'), 0, ty + torsoH / 2 - 0.02, 0).rotateX(Math.PI / 2));
  }
  if (p.apron) {
    const ap = mesh(new THREE.BoxGeometry(0.42 * s, 0.75, 0.04), p.apron);
    g.add(at(ap, 0, legH - 0.05, 0.36 * s + (s > 1.15 ? 0.1 : 0)));
    ap.rotation.x = -0.12;
    if (p.flour) for (let i = 0; i < 6; i++) g.add(at(mesh(new THREE.SphereGeometry(0.03, 4, 3), '#ffffff'), rr(-0.15, 0.15) * s, legH + rr(-0.2, 0.4), 0.42 * s + 0.08));
  }
  if (p.shawl) {
    const sh = mesh(new THREE.ConeGeometry(0.46 * s, 0.55, 9, 1, true), mat(p.shawl, { side: THREE.DoubleSide }));
    g.add(at(sh, 0, legH + torsoH - 0.15, 0));
  }
  if (p.patches) {
    g.add(at(mesh(new THREE.BoxGeometry(0.12, 0.12, 0.03), '#9b7b3f'), 0.12, ty - 0.1, 0.31));
    g.add(at(mesh(new THREE.BoxGeometry(0.1, 0.1, 0.03), '#6b4f2a'), -0.15, ty + 0.15, 0.29));
  }
  // пояс
  g.add(at(mesh(new THREE.CylinderGeometry(0.315 * s, 0.315 * s, 0.07, 9), '#3a2a1e'), 0, legH + 0.08, 0));
  // руки
  const shoulderY = legH + torsoH - 0.08;
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.add(at(mesh(new THREE.CylinderGeometry(0.08 * s, 0.075 * s, 0.62, 6), p.coat || (p.vest && !p.vestFur ? p.shirt : p.shirt)), 0, -0.31, 0));
    arm.add(at(mesh(new THREE.IcosahedronGeometry(0.085, 0), SKIN), 0, -0.64, 0));
    arm.position.set(sx * (0.33 * s + 0.04), shoulderY, 0);
    arm.userData.arm = sx;
    arm.rotation.z = sx * 0.18; arm.rotation.x = p.acc && p.acc.includes('staff') && sx > 0 ? -0.5 : 0.05;
    g.add(arm);
  }
  // голова
  const hy = legH + torsoH + 0.3;
  const head = new THREE.Group(); head.position.y = hy; g.add(head);
  head.add(mesh(new THREE.IcosahedronGeometry(0.27, 1), SKIN));
  for (const sx of [-1, 1]) {
    head.add(at(mesh(new THREE.SphereGeometry(0.035, 6, 5), '#1d1712'), sx * 0.095, 0.04, 0.245));
    head.add(at(mesh(new THREE.BoxGeometry(0.09, 0.022, 0.02), p.hair?.color || '#5a3d2a'), sx * 0.095, 0.11, 0.25));
    if (p.cheeks) head.add(at(mesh(new THREE.SphereGeometry(0.05, 6, 4), '#f08a7e'), sx * 0.15, -0.05, 0.215));
    head.add(at(mesh(new THREE.SphereGeometry(0.06, 5, 4), SKIN), sx * 0.27, 0, 0)); // уши
  }
  head.add(at(mesh(new THREE.IcosahedronGeometry(0.06, 0), '#de9f7b'), 0, -0.02, 0.27));
  if (!p.beard) head.add(at(mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), '#a5534a'), 0, -0.11, 0.25));
  if (p.old) for (const sx of [-1, 1]) head.add(at(mesh(new THREE.BoxGeometry(0.06, 0.012, 0.01), '#b98a6c'), sx * 0.18, 0.02, 0.215));
  if (p.beard) {
    const b = p.beard.size;
    const beard = mesh(new THREE.ConeGeometry(0.22 * b, 0.42 * b, 8), p.beard.color);
    beard.rotation.x = Math.PI + 0.25;
    head.add(at(beard, 0, -0.24 - 0.1 * b, 0.1));
    head.add(at(mesh(new THREE.BoxGeometry(0.2, 0.05, 0.07), p.beard.color), 0, -0.1, 0.25));
  }
  if (p.mustache) for (const sx of [-1, 1]) {
    const m = mesh(new THREE.BoxGeometry(0.12, 0.025, 0.03), p.mustache); m.rotation.z = sx * -0.35;
    head.add(at(m, sx * 0.06, -0.08, 0.265));
  }
  // волосы
  const hc = p.hair?.color || '#5a3d2a';
  if (p.hair && p.hair.style !== 'none') {
    head.add(at(mesh(new THREE.SphereGeometry(0.29, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.45), hc), 0, 0.02, -0.02));
    head.add(at(mesh(new THREE.SphereGeometry(0.28, 9, 6, Math.PI * 0.75, Math.PI * 1.5, 0, Math.PI * 0.75), hc), 0, 0.0, -0.03));
    if (p.hair.style === 'bun') head.add(at(mesh(new THREE.IcosahedronGeometry(0.13, 1), hc), 0, 0.2, -0.22));
    if (p.hair.style === 'messy') for (let i = 0; i < 9; i++)
      head.add(at(mesh(new THREE.IcosahedronGeometry(rr(0.07, 0.11), 0), hc), rr(-0.2, 0.2), rr(0.18, 0.28), rr(-0.15, 0.18)));
  }
  // шапки
  if (p.hat === 'straw') {
    head.add(at(mesh(new THREE.CylinderGeometry(0.55, 0.58, 0.04, 12), '#e1bf5b'), 0, 0.2, 0));
    head.add(at(mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.22, 10), '#e1bf5b'), 0, 0.32, 0));
    head.add(at(mesh(new THREE.CylinderGeometry(0.285, 0.285, 0.05, 10), '#8a3b24'), 0, 0.25, 0));
  } else if (p.hat === 'fur') {
    head.add(at(mesh(new THREE.SphereGeometry(0.3, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), p.hatColor), 0, 0.16, 0));
    head.add(at(mesh(new THREE.TorusGeometry(0.3, 0.08, 6, 12), '#a08060'), 0, 0.15, 0).rotateX(Math.PI / 2));
  } else if (p.hat === 'kerchief') {
    head.add(at(mesh(new THREE.SphereGeometry(0.305, 9, 7, Math.PI * 0.7, Math.PI * 1.6, 0, Math.PI * 0.62), p.hatColor), 0, 0.01, -0.01));
    head.add(at(mesh(new THREE.IcosahedronGeometry(0.08, 0), p.hatColor), 0, -0.2, -0.16));
    for (let i = 0; i < 7; i++) head.add(at(mesh(new THREE.SphereGeometry(0.025, 4, 3), '#ffffff'), rr(-0.22, 0.22), rr(0.05, 0.25), -rr(0.1, 0.27)));
  }
  // предметы
  const acc = p.acc || [];
  if (acc.includes('staff')) {
    g.add(at(mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.05, 6), '#6b4a2b'), 0.62 * s, 1.0, 0.18));
    g.add(at(mesh(new THREE.IcosahedronGeometry(0.08, 0), '#5a3d22'), 0.62 * s, 2.05, 0.18));
  }
  if (acc.includes('bag')) {
    const strap = mesh(new THREE.BoxGeometry(0.06, 0.95, 0.04), '#5a3b22'); strap.rotation.z = 0.75;
    g.add(at(strap, 0, ty + 0.05, 0.27 * s));
    g.add(at(mesh(new THREE.BoxGeometry(0.3, 0.28, 0.14), '#7d5532'), -0.36 * s, legH + 0.05, 0.12));
  }
  if (acc.includes('bow')) {
    const bow = new THREE.Group();
    bow.add(mesh(new THREE.TorusGeometry(0.55, 0.03, 5, 14, Math.PI * 0.95), '#6b4a2b'));
    bow.add(at(mesh(new THREE.BoxGeometry(1.08, 0.01, 0.01), '#eeeeee'), 0, 0.05, 0));
    bow.rotation.set(0, 0, Math.PI / 2 + 0.6);
    g.add(at(bow, 0, ty + 0.05, -0.38 * s));
    g.add(at(mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.55, 7), '#7a5634'), -0.18, ty + 0.2, -0.33).rotateZ(-0.3));
  }
  if (acc.includes('basket')) {
    const bk = new THREE.Group();
    bk.add(mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.2, 9), '#a6773d'));
    for (let i = 0; i < 6; i++) bk.add(at(mesh(new THREE.ConeGeometry(0.05, 0.22, 4), i % 2 ? '#4f8f3a' : '#7bb24a'), rr(-0.12, 0.12), 0.16, rr(-0.1, 0.1)));
    bk.add(at(mesh(new THREE.TorusGeometry(0.17, 0.02, 4, 10, Math.PI), '#8a5f2e'), 0, 0.08, 0));
    g.add(at(bk, -0.5 * s, legH - 0.1, 0.12));
  }
  const k = (p.height || 1) * (p.young ? 0.95 : 1);
  g.scale.setScalar(k);
  return g;
}

function cow(color = '#f4f1ea', spot = '#3b2a20') {
  const g = new THREE.Group(), head = new THREE.Group(), N = [0.68, 1.18, 0];   // голова на шарнире у шеи — чтобы корова могла жевать траву
  head.position.set(...N); head.userData.cowHead = true; g.add(head);
  const H = (m, x, y, z) => { head.add(at(m, x - N[0], y - N[1], z - N[2])); return m; };
  g.add(at(mesh(new THREE.BoxGeometry(1.45, 0.75, 0.75), color), 0, 0.95, 0));
  for (let i = 0; i < 4; i++) {
    g.add(at(mesh(new THREE.BoxGeometry(rr(0.25, 0.45), rr(0.2, 0.35), 0.77), spot), rr(-0.5, 0.45), rr(0.85, 1.15), 0));
  }
  H(mesh(new THREE.BoxGeometry(0.46, 0.44, 0.48), color), 0.9, 1.2, 0);
  H(mesh(new THREE.BoxGeometry(0.22, 0.26, 0.44), '#e8a59a'), 1.15, 1.08, 0);
  for (const sz of [-1, 1]) {
    H(mesh(new THREE.ConeGeometry(0.05, 0.22, 5), '#efe6c8'), 0.85, 1.5, sz * 0.18).rotateZ(-0.3);
    H(mesh(new THREE.BoxGeometry(0.1, 0.08, 0.2), color), 0.85, 1.32, sz * 0.3);
    H(mesh(new THREE.SphereGeometry(0.035, 5, 4), '#111111'), 1.13, 1.27, sz * 0.14);
    for (const sx of [-1, 1]) g.add(at(mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), color), sx * 0.5, 0.3, sz * 0.24));
  }
  g.add(at(mesh(new THREE.SphereGeometry(0.15, 6, 4), '#f0a8a0'), -0.25, 0.58, 0));
  g.add(at(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 4), color), -0.78, 0.85, 0).rotateZ(-0.3));
  return g;
}

function wolf() {
  const g = new THREE.Group(); const c = '#6e6c6a';
  g.add(at(mesh(new THREE.BoxGeometry(1.1, 0.45, 0.42), c), 0, 0.7, 0));
  g.add(at(mesh(new THREE.BoxGeometry(0.4, 0.36, 0.36), c), 0.7, 0.88, 0));
  g.add(at(mesh(new THREE.ConeGeometry(0.13, 0.36, 5), '#5a5856'), 1.0, 0.82, 0).rotateZ(-Math.PI / 2));
  for (const sz of [-1, 1]) {
    g.add(at(mesh(new THREE.ConeGeometry(0.07, 0.2, 4), '#4e4c4a'), 0.68, 1.13, sz * 0.11));
    g.add(at(mesh(new THREE.SphereGeometry(0.03, 4, 3), '#f2d23a', { emissive: '#f2c23a', emissiveIntensity: 0.6 }), 0.9, 0.93, sz * 0.12));
    for (const sx of [-1, 1]) g.add(at(mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), c), sx * 0.38, 0.25, sz * 0.14));
  }
  g.add(at(mesh(new THREE.ConeGeometry(0.1, 0.6, 5), '#5a5856'), -0.75, 0.75, 0).rotateZ(Math.PI / 2 + 0.4));
  return g;
}

// =====================================================================
//                              КАРТА
// =====================================================================
function noise2(x, z) {
  const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return mix(mix(h(xi, zi), h(xi + 1, zi), u), mix(h(xi, zi + 1), h(xi + 1, zi + 1), u), v);
}
const CAMP = new THREE.Vector2(-1, 1);
const riverX = z => 8.5 + 3.2 * Math.sin(z * 0.075 + 0.6) + 1.3 * Math.sin(z * 0.21 + 1);
function groundH(x, z) {
  let hills = noise2(x * 0.06, z * 0.06) * 1.5 + noise2(x * 0.2, z * 0.2) * 0.35;
  const dc = Math.hypot(x - CAMP.x, z - CAMP.y);
  hills *= mix(0.12, 1, smooth(9, 20, dc));
  let h = 0.35 + hills;
  if (z < -45) h += (-45 - z) * 0.12 * (0.6 + noise2(x * 0.1, z * 0.1));
  const d = Math.abs(x - riverX(z));
  h = mix(-0.7, h, smooth(1.8, 5.0, d));
  return h;
}

function buildMap(state) {
  seed = 777;
  const winter = state.season === 'winter';
  scene.background = gradientTexture(winter ? [[0, '#9fb3c8'], [0.6, '#dde6ee'], [1, '#eef2f5']] : [[0, '#7fb8e6'], [0.55, '#cfe3ef'], [1, '#f7dcb0']]);
  scene.fog = new THREE.Fog(winter ? '#e3e9ef' : '#efdcb9', 60, 230);

  // свет
  const hemi = new THREE.HemisphereLight(winter ? '#dfe9f5' : '#ffeacc', winter ? '#7a8590' : '#5d7a3a', winter ? 1.3 : 1.15); scene.add(hemi);
  const sun = new THREE.DirectionalLight(winter ? '#fff3e6' : '#ffd9a0', winter ? 2.0 : 2.6);
  sun.position.set(-30, 40, 22); sun.castShadow = true;
  const sm = SITE && window.WORLD_LOW ? 1024 : 2048; sun.shadow.mapSize.set(sm, sm);   // на телефонах тень вдвое легче — на вид почти незаметно
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 140 });
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
  scene.add(sun);

  // земля
  const geo = new THREE.PlaneGeometry(180, 200, 150, 170); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position; const cols = [];
  const cA = new THREE.Color(winter ? '#f2f5f7' : '#7fb24a'), cB = new THREE.Color(winter ? '#dfe7ee' : '#5e9a3c'),
    cSand = new THREE.Color(winter ? '#cfd6dc' : '#d9c48a'), cRock = new THREE.Color(winter ? '#e9eef2' : '#8f8a7c'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i) - 40;
    pos.setZ(i, z);
    const y = groundH(x, z); pos.setY(i, y);
    c.copy(cA).lerp(cB, noise2(x * 0.3, z * 0.3));
    const d = Math.abs(x - riverX(z));
    if (d < 5.2 && y < 1.0) c.lerp(cSand, (1 - smooth(3.4, 5.2, d)) * (1 - smooth(0.4, 1.0, y)));
    if (y > 6) c.lerp(cRock, smooth(6, 12, y));
    const dc = Math.hypot(x - CAMP.x, z - CAMP.y);
    if (!winter && dc < 7) c.lerp(new THREE.Color('#9a9a5a'), 0.35 * (1 - dc / 7));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  ground.receiveShadow = true; scene.add(ground);

  // вода
  const water = new THREE.Mesh(new THREE.PlaneGeometry(180, 200), new THREE.MeshStandardMaterial({
    color: winter ? '#a9cfe0' : '#3f9fc9', roughness: winter ? 0.6 : 0.15, metalness: 0.1, transparent: true, opacity: 0.92 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -0.15, -40); water.receiveShadow = true; scene.add(water);

  // горы
  for (let i = 0; i < 14; i++) {
    const x = -95 + i * 15 + rr(-5, 5), z = rr(-135, -118), h = rr(20, 32), r = rr(14, 20);
    const m = mesh(new THREE.ConeGeometry(r, h, 6), i % 2 ? '#9aaac0' : '#8b9db5');
    m.rotation.y = rand() * 3; scene.add(at(m, x, groundH(x, z) + h / 2 - 2, z));
    const cap = mesh(new THREE.ConeGeometry(r * 0.38, h * 0.38, 6), '#f4f6f8');
    cap.rotation.y = m.rotation.y; scene.add(at(cap, x, groundH(x, z) + h - 2 - h * 0.19 + 0.05, z));
  }

  const blocked = []; // [x,z,r] — занятые места
  const free = (x, z, r) => blocked.every(([bx, bz, br]) => Math.hypot(x - bx, z - bz) > r + br) && Math.abs(x - riverX(z)) > 4 + r;
  const place = (obj, x, z, r = 1) => { obj.position.set(x, groundH(x, z), z); scene.add(obj); blocked.push([x, z, r]); return obj; };

  // ---- постройки по состоянию ----
  const B = new Set(state.buildings || []);
  const pop = state.population || 100;

  // костёр
  const fire = new THREE.Group();
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; fire.add(at(mesh(new THREE.DodecahedronGeometry(0.22, 0), '#8a8580'), Math.cos(a) * 0.75, 0.1, Math.sin(a) * 0.75)); }
  for (let i = 0; i < 3; i++) fire.add(at(mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.3, 5), '#5a3a22'), 0, 0.2, 0).rotateY(i * 1.05).rotateZ(Math.PI / 2 - 0.25));
  const flames = [];
  [['#ff7a1a', 0.42, 1.0], ['#ffb422', 0.3, 0.75], ['#ffe27a', 0.16, 0.5]].forEach(([col, r, h]) => {
    const f = mesh(new THREE.ConeGeometry(r, h, 6), col, { emissive: col, emissiveIntensity: 1.6 }); f.castShadow = false;
    fire.add(at(f, 0, h / 2 + 0.15, 0)); flames.push(f); f.userData.dynamic = true;
  });
  const fireLight = new THREE.PointLight('#ff9a3a', 25, 14, 1.6); fireLight.position.set(0, 1.4, 0); fire.add(fireLight);
  place(fire, CAMP.x, CAMP.y, 1.5);
  const smoke = [];
  for (let i = 0; i < 7; i++) { const s = mesh(new THREE.IcosahedronGeometry(0.35, 0), '#d8d4cc', { transparent: true, opacity: 0.55 }); s.castShadow = false; s.userData.dynamic = true; scene.add(s); smoke.push(s); }

  // шалаши / дома: 6 на 100 жителей, +1 на каждые 20
  const HUTS = [];
  const huts = state.huts != null ? Math.max(1, Math.min(42, state.huts)) : Math.min(42, 8 + Math.floor((pop - 100) / 20));
  for (let i = 0; i < huts; i++) {
    const ring = i < 8 ? 6.4 : 10.6 + Math.floor((i - 8) / 12) * 3.2;
    const n = i < 8 ? Math.min(8, huts) : 12;
    const a = (i < 8 ? i : i - 8) / n * Math.PI * 2 + (i < 8 ? 0.35 : 0.1) + rr(-0.12, 0.12);
    const x = CAMP.x + Math.cos(a) * ring, z = CAMP.y + Math.sin(a) * ring * 0.9;
    if (!free(x, z, 1.4)) continue;
    const hut = new THREE.Group();
    const r = rr(1.0, 1.3);
    hut.add(at(mesh(new THREE.CylinderGeometry(r, r * 1.05, 1.0, 8), '#8a6440'), 0, 0.5, 0));
    hut.add(at(mesh(new THREE.ConeGeometry(r * 1.45, 1.7, 8), i % 3 ? '#d9b65e' : '#c9a24e'), 0, 1.85, 0));
    hut.add(at(mesh(new THREE.ConeGeometry(0.08, 0.5, 4), '#6b4a2b'), 0, 2.85, 0));
    hut.add(at(mesh(new THREE.BoxGeometry(0.5, 0.75, 0.1), '#3a2618'), 0, 0.38, r * 1.02));
    hut.lookAt(new THREE.Vector3(CAMP.x, 0, CAMP.y)); hut.rotation.x = 0; hut.rotation.z = 0;
    hut.rotation.y = Math.atan2(CAMP.x - x, CAMP.y - z);
    place(hut, x, z, 1.4); HUTS.push({ x, z, y: groundH(x, z) });
  }

  // склад
  if (B.has('storage')) {
    const b = new THREE.Group();
    b.add(at(mesh(new THREE.BoxGeometry(3.4, 1.9, 2.6), '#9a6a3c'), 0, 0.95, 0));
    for (let i = -1; i <= 1; i++) b.add(at(mesh(new THREE.BoxGeometry(0.1, 1.9, 2.62), '#6f4a28'), i * 1.1, 0.95, 0));
    const sh = new THREE.Shape(); sh.moveTo(-1.95, 0); sh.lineTo(1.95, 0); sh.lineTo(0, 1.4); sh.closePath();
    const roof = mesh(new THREE.ExtrudeGeometry(sh, { depth: 3.0, bevelEnabled: false }), '#b5462f'); roof.geometry.translate(0, 0, -1.5);
    b.add(at(roof, 0, 1.9, 0));
    b.add(at(mesh(new THREE.BoxGeometry(1.0, 1.3, 0.1), '#4a2f1a'), 0, 0.65, 1.31));
    for (let i = 0; i < 3; i++) b.add(at(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 8), '#a8743f'), 2.2 + (i % 2) * 0.5, 0.3, 0.6 - i * 0.6));
    b.rotation.y = 0.5; place(b, -7.5, -3, 2.6);
  }
  // колодец
  if (B.has('well')) {
    const w = new THREE.Group();
    w.add(at(mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.8, 10), '#9c968c'), 0, 0.4, 0));
    w.add(at(mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.05, 10), '#2e5f7a'), 0, 0.78, 0));
    for (const sx of [-1, 1]) w.add(at(mesh(new THREE.BoxGeometry(0.14, 1.6, 0.14), '#6b4a2b'), sx * 0.8, 1.4, 0));
    w.add(at(mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.8, 6), '#6b4a2b'), 0, 1.85, 0).rotateZ(Math.PI / 2));
    w.add(at(mesh(new THREE.BoxGeometry(0.28, 0.3, 0.28), '#7d5532'), 0, 1.2, 0));
    const sh = new THREE.Shape(); sh.moveTo(-1.1, 0); sh.lineTo(1.1, 0); sh.lineTo(0, 0.7); sh.closePath();
    const roof = mesh(new THREE.ExtrudeGeometry(sh, { depth: 1.3, bevelEnabled: false }), '#b5462f'); roof.geometry.translate(0, 0, -0.65);
    w.add(at(roof, 0, 2.15, 0));
    place(w, 4.0, -2.5, 1.3);
  }
  // лечебница (больница): строится по закону государства; до тех пор лекарь лечит жителей на дому
  let CLINIC = null;
  if (B.has('clinic')) {
    const c = new THREE.Group();
    c.add(at(mesh(new THREE.BoxGeometry(4.2, 1.9, 3.0), '#efe6d2'), 0, 0.95, 0));
    const sh = new THREE.Shape(); sh.moveTo(-2.3, 0); sh.lineTo(2.3, 0); sh.lineTo(0, 1.3); sh.closePath();
    const roof = mesh(new THREE.ExtrudeGeometry(sh, { depth: 4.6, bevelEnabled: false }), '#b5352a'); roof.geometry.translate(0, 0, -2.3); roof.rotation.y = Math.PI / 2; c.add(at(roof, 0, 1.9, 0));
    c.add(at(mesh(new THREE.BoxGeometry(0.9, 1.4, 0.1), '#6b4a2b'), 0, 0.7, 1.53));
    for (const sx of [-1.4, 1.4]) c.add(at(mesh(new THREE.BoxGeometry(0.7, 0.6, 0.1), '#9fd0e8'), sx, 1.1, 1.53));
    for (const sx of [-1.1, 1.1]) c.add(at(mesh(new THREE.BoxGeometry(0.14, 1.9, 0.14), '#a87a48'), sx, 0.95, 2.2));
    c.add(at(mesh(new THREE.BoxGeometry(2.7, 0.1, 1.0), '#c9a06a'), 0, 1.95, 2.0));
    c.add(at(mesh(new THREE.BoxGeometry(0.9, 0.25, 0.08), '#d24a3a'), 0, 2.9, 1.5)); c.add(at(mesh(new THREE.BoxGeometry(0.25, 0.9, 0.08), '#d24a3a'), 0, 2.9, 1.5));   // красный крест
    let best = null, bd = 1e9;
    for (let x = -18; x <= 6; x += 1.5) for (let z = -10; z <= 14; z += 1.5) { if (!free(x, z, 3.6)) continue; const d = Math.hypot(x - CAMP.x, z - CAMP.y); if (d > 8.5 && d < bd) { bd = d; best = [x, z]; } }
    if (best) { c.rotation.y = Math.atan2(CAMP.x - best[0], CAMP.y - best[1]); place(c, best[0], best[1], 3.1); CLINIC = { x: best[0], z: best[1] }; }
  }
  // поля
  if (B.has('fields')) {
    for (let k = 0; k < 2; k++) {
      const f = new THREE.Group(); const cx = -3 + k * 5.5, cz = -11;
      f.add(at(mesh(new THREE.BoxGeometry(4.6, 0.12, 4.0), '#7a5a35'), 0, 0.06, 0));
      for (let r = 0; r < 6; r++) for (let q = 0; q < 8; q++)
        f.add(at(mesh(new THREE.ConeGeometry(0.12, 0.45, 4), k ? '#e3c552' : '#9cc24a'), -2 + q * 0.57, 0.3, -1.6 + r * 0.64));
      place(f, cx, cz, 3);
    }
  }
  // загон с коровами
  const cows = state.cows ?? 5;
  const pen = new THREE.Vector2(4.2, 6.5);
  if (B.has('pen')) {
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2; const x = pen.x + Math.cos(a) * 3.3, z = pen.y + Math.sin(a) * 2.4;
      scene.add(at(mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), '#6b4a2b'), x, groundH(x, z) + 0.45, z));
      const a2 = (i + 1) / 18 * Math.PI * 2, x2 = pen.x + Math.cos(a2) * 3.3, z2 = pen.y + Math.sin(a2) * 2.4;
      const len = Math.hypot(x2 - x, z2 - z);
      for (const hh of [0.4, 0.75]) { const rail = mesh(new THREE.BoxGeometry(len, 0.08, 0.08), '#7d5532'); rail.rotation.y = -Math.atan2(z2 - z, x2 - x);
        scene.add(at(rail, (x + x2) / 2, groundH((x + x2) / 2, (z + z2) / 2) + hh, (z + z2) / 2)); }
    }
  }
  blocked.push([pen.x, pen.y, 2.5]);
  for (let i = 0; i < cows; i++) {
    const cw = cow(); cw.scale.setScalar(0.55); cw.rotation.y = rr(0, 6.28); cw.userData.dynamic = cw.userData.cow = true;
    const x = pen.x + rr(-2.2, 2.2), z = pen.y + rr(-1.4, 1.4);
    scene.add(at(cw, x, groundH(x, z), z));
  }
  // частокол
  if (B.has('palisade')) {
    const R = 12.5;
    for (let i = 0; i < 120; i++) {
      const a = i / 120 * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.13) continue; // ворота к зрителю
      const x = CAMP.x + 2 + Math.cos(a) * R, z = CAMP.y + Math.sin(a) * R * 0.85;
      if (Math.abs(x - riverX(z)) < 3.4) continue;
      const hgt = rr(1.6, 2.1), log = new THREE.Group();
      log.add(at(mesh(new THREE.CylinderGeometry(0.2, 0.22, hgt, 6), '#8a5f36'), 0, hgt / 2, 0));
      log.add(at(mesh(new THREE.ConeGeometry(0.2, 0.4, 6), '#a77a4a'), 0, hgt + 0.2, 0));
      scene.add(at(log, x, groundH(x, z) - 0.1, z));
    }
    for (const sx of [-1, 1]) {
      const x = CAMP.x + 2 + sx * 1.3, z = CAMP.y + R * 0.85;
      scene.add(at(mesh(new THREE.CylinderGeometry(0.28, 0.3, 3.2, 6), '#6f4a28'), x, groundH(x, z) + 1.6, z));
    }
  }
  // волки
  if (state.wolves) {
    for (let i = 0; i < 4; i++) {
      const wf = wolf(); wf.scale.setScalar(0.65); const x = 0.5 + i * 1.3 + rr(-0.4, 0.4), z = 11.2 + rr(-0.6, 0.6);
      wf.rotation.y = Math.atan2(-(pen.y - z), pen.x - x) + rr(-0.3, 0.3); scene.add(at(wf, x, groundH(x, z), z));
    }
  }
  // флаг
  let flagMesh = null;
  if (state.flag) {
    const fx = CAMP.x + 2.6, fz = CAMP.y - 1.5, gy = groundH(fx, fz);
    scene.add(at(mesh(new THREE.CylinderGeometry(0.07, 0.09, 5, 6), '#6b4a2b'), fx, gy + 2.5, fz));
    scene.add(at(mesh(new THREE.IcosahedronGeometry(0.14, 0), '#e2b23a', { metalness: 0.6, roughness: 0.3 }), fx, gy + 5.05, fz));
    const cnv = document.createElement('canvas'); cnv.width = 384; cnv.height = 256; const g = cnv.getContext('2d');
    const stripes = state.flag.colors || ['#ffffff', '#2f5fa8', '#cf2f2a'];
    stripes.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, i * 256 / stripes.length, 384, 256 / stripes.length + 1); });
    if (state.flag.symbol) { g.font = '150px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(state.flag.symbol, 192, 136); }
    const tex = new THREE.CanvasTexture(cnv); tex.colorSpace = THREE.SRGBColorSpace;
    const fg = new THREE.PlaneGeometry(2.4, 1.6, 16, 4); fg.translate(1.2, 0, 0);
    flagMesh = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
    flagMesh.castShadow = true; flagMesh.userData.dynamic = true; flagMesh.userData.base = fg.attributes.position.array.slice();
    scene.add(at(flagMesh, fx, gy + 4.15, fz));
  }
  // табличка с названием
  {
    const sx = CAMP.x + 4.6, sz = CAMP.y + 9.0, gy = groundH(sx, sz);
    const sign = new THREE.Group();
    for (const d of [-1, 1]) sign.add(at(mesh(new THREE.BoxGeometry(0.16, 2.0, 0.16), '#6b4a2b'), d * 1.5, 1.0, 0));
    const cnv = document.createElement('canvas'); cnv.width = 1024; cnv.height = 320; const g = cnv.getContext('2d');
    g.fillStyle = '#b98a52'; g.fillRect(0, 0, 1024, 320);
    g.strokeStyle = 'rgba(90,55,25,0.35)'; g.lineWidth = 6;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, i * 80); g.lineTo(1024, i * 80); g.stroke(); }
    g.strokeStyle = '#6b4424'; g.lineWidth = 18; g.strokeRect(9, 9, 1006, 302);
    const name = state.name || '???';
    g.fillStyle = '#3a2412'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 170; g.font = `800 ${fs}px Inter`; while (g.measureText(name).width > 900 && fs > 50) { fs -= 8; g.font = `800 ${fs}px Inter`; }
    g.fillText(name, 512, 168);
    const tex = new THREE.CanvasTexture(cnv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.06, 0.14), [mat('#8a5f36'), mat('#8a5f36'), mat('#8a5f36'), mat('#8a5f36'),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), mat('#8a5f36')]);
    board.castShadow = true; sign.add(at(board, 0, 1.55, 0.06));
    sign.rotation.y = -0.25; sign.position.set(sx, gy, sz); scene.add(sign); blocked.push([sx, sz, 2]);
  }

  // жители (именные + массовка)
  const people = [];
  const named = [['grisha', pen.x - 3.2, pen.y + 1.4], ['pakhom', CAMP.x - 1.6, CAMP.y + 2.0]];
  if (state.showAll) named.push(['arkadiy', CAMP.x + 2.2, CAMP.y + 2.6], ['marfa', CAMP.x - 2.6, CAMP.y - 1.0], ['timosha', -6, 6], ['nyura', CAMP.x + 1.8, CAMP.y - 2.4]);
  if (state.noCrowd) named.length = 0;
  for (const [id, x, z] of named) { const pp = person(CHARS[id]); pp.scale.multiplyScalar(0.62); pp.rotation.y = Math.atan2(CAMP.x - x, CAMP.y - z) + 0.4; scene.add(at(pp, x, groundH(x, z), z)); }
  const crowd = state.noCrowd ? 0 : Math.min(40, Math.round(pop / 6));
  const palette = ['#b84a3a', '#3f6fa5', '#7a8a3a', '#a0763f', '#8a5aa0', '#d8c79f', '#4f7a5a', '#c08a3a'];
  for (let i = 0; i < crowd; i++) {
    let x, z, tries = 0;
    do { const a = rr(0, 6.28), r = rr(2.0, 9 + pop / 60); x = CAMP.x + Math.cos(a) * r; z = CAMP.y + Math.sin(a) * r; tries++; } while (!free(x, z, 0.45) && tries < 30);
    if (tries >= 30) continue;
    const female = rand() < 0.5;
    const pp = person({ height: rr(0.85, 1.05), girth: rr(0.85, 1.15), shirt: palette[i % palette.length], pants: '#4b3a2a',
      skirt: female ? palette[(i + 3) % palette.length] : null, hat: female && rand() < 0.6 ? 'kerchief' : (rand() < 0.3 ? 'straw' : null),
      hatColor: palette[(i + 5) % palette.length], hair: { color: ['#3a2618', '#6b4226', '#c9a25a', '#2a2a2a'][i % 4], style: 'short' },
      beard: !female && rand() < 0.35 ? { color: '#5a3d2a', size: 0.7 } : null });
    pp.scale.multiplyScalar(0.55); pp.rotation.y = Math.atan2(CAMP.x - x, CAMP.y - z) + rr(-0.6, 0.6);
    scene.add(at(pp, x, groundH(x, z), z)); blocked.push([x, z, 0.45]); people.push(pp);
  }

  // деревья
  const pine = (s) => { const t = new THREE.Group(); const dark = rand() < 0.5;
    t.add(at(mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.0, 5), '#6b4a2b'), 0, 0.5, 0));
    for (let i = 0; i < 3; i++) t.add(at(mesh(new THREE.ConeGeometry(1.3 - i * 0.3, 1.5, 7), winter ? (i === 2 ? '#f4f7f9' : '#3f6b4f') : (dark ? '#2f6b3a' : '#3c7d3e')), 0, 1.3 + i * 0.85, 0));
    t.scale.setScalar(s); t.rotation.y = rand() * 6; return t; };
  const leafy = (s) => { const t = new THREE.Group();
    t.add(at(mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.4, 5), '#6b4a2b'), 0, 0.7, 0));
    t.add(at(mesh(new THREE.IcosahedronGeometry(1.2, 0), winter ? '#c9d3da' : ['#5f9e3a', '#79b04a', '#4f8a34'][Math.floor(rand() * 3)]), 0, 2.1, 0));
    t.scale.setScalar(s); t.rotation.y = rand() * 6; return t; };
  for (let i = 0; i < 1400; i++) {
    const x = rr(-75, 75), z = rr(-80, 40);
    const leftForest = x < -11 + noise2(z * 0.1, 3) * 4;
    const dens = leftForest ? 1.0 : (z < -18 ? 0.5 : 0.1);
    if (rand() > dens) continue;
    const dc = Math.hypot(x - CAMP.x, z - CAMP.y);
    if (dc < Math.max(15, 9 + Math.sqrt(pop) * 0.6 + 14) || !free(x, z, 0.9) || groundH(x, z) > 14) continue;   // вокруг поселения лес вырублен — тем шире, чем больше жителей
    const t = rand() < (leftForest ? 0.75 : 0.4) ? pine(rr(0.8, 1.4)) : leafy(rr(0.8, 1.3));
    scene.add(at(t, x, groundH(x, z) - 0.05, z)); blocked.push([x, z, 0.9]);
  }
  // камни и кусты
  for (let i = 0; i < 90; i++) {
    const x = rr(-30, 30), z = rr(-40, 25); if (!free(x, z, 0.5) || Math.hypot(x - CAMP.x, z - CAMP.y) < 8) continue;
    const big = rand() < 0.4;
    const m = big ? mesh(new THREE.DodecahedronGeometry(rr(0.3, 0.8), 0), '#9a958a') : mesh(new THREE.IcosahedronGeometry(rr(0.3, 0.55), 0), winter ? '#d5dde3' : '#4f8a34');
    scene.add(at(m, x, groundH(x, z) + 0.1, z));
  }
  // цветы
  if (!winter) for (let i = 0; i < 160; i++) {
    const x = rr(-25, 25), z = rr(-25, 22); if (!free(x, z, 0.2)) continue;
    const f = mesh(new THREE.IcosahedronGeometry(0.09, 0), ['#f2e14a', '#ffffff', '#e86a8a', '#b07ae0'][i % 4]); f.castShadow = false;
    scene.add(at(f, x, groundH(x, z) + 0.12, z));
  }
  // снег (зима)
  let snow = null;
  if (winter) {
    const n = 1500, g = new THREE.BufferGeometry(), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = rr(-30, 30); a[i * 3 + 1] = rr(0, 30); a[i * 3 + 2] = rr(-40, 30); }
    g.setAttribute('position', new THREE.BufferAttribute(a, 3));
    snow = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 0.18 })); scene.add(snow);
  }

  // камера
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.5, 400);
  const look = new THREE.Vector3();
  const P0 = new THREE.Vector3(0, 70, 95), L0 = new THREE.Vector3(0, 10, -40);
  const P1 = new THREE.Vector3(1.5, 25, 45), L1 = new THREE.Vector3(0.5, 1.5, -24);
  const effects = (time) => {
    flames.forEach((f, i) => { f.scale.set(1 + Math.sin(time * 9 + i) * 0.08, 1 + Math.sin(time * 13 + i * 2) * 0.15, 1); });
    fireLight.intensity = 25 + Math.sin(time * 17) * 4;
    smoke.forEach((s, i) => { const ph = (time * 0.25 + i / smoke.length) % 1;
      s.position.set(CAMP.x + Math.sin(ph * 5 + i) * 0.5, 1.6 + ph * 7, CAMP.y - ph * 2); s.scale.setScalar(0.5 + ph * 1.6); s.material.opacity = 0.55 * (1 - ph); });
    if (flagMesh) { const p = flagMesh.geometry.attributes.position, b = flagMesh.userData.base;
      for (let i = 0; i < p.count; i++) { const x = b[i * 3]; p.setZ(i, Math.sin(x * 2.2 - time * 5) * 0.15 * (x / 2.4)); } p.needsUpdate = true; flagMesh.geometry.computeVertexNormals(); }
    if (snow) { const p = snow.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, ((p.getY(i) - 0.02 + 30) % 30)); p.needsUpdate = true; }
  };
  window.WORLD = { scene, renderer, sun, hemi, fireLight, effects, huts: HUTS, clinic: CLINIC, groundH, CAMP, THREE, people, person, CHARS, riverX, pen, blocked, rr: () => rand() };
  window.renderAt = (t, intro = false, custom = null) => {
    const k = intro ? 1 - Math.pow(1 - Math.min(1, t * 1.15), 3) : 1;
    camera.position.lerpVectors(P0, P1, k); look.lerpVectors(L0, L1, k);
    if (intro) camera.position.x += Math.sin(t * Math.PI) * 6;
    if (custom) { camera.position.set(...custom.p); look.set(...custom.l); }
    camera.lookAt(look);
    const time = custom ? custom.time : t * 8;
    effects(time);
    renderer.render(scene, camera);
  };
}

// =====================================================================
//                           ПОРТРЕТ ЖИТЕЛЯ
// =====================================================================
function buildChar(id) {
  seed = 99;
  const p = CHARS[id];
  scene.background = gradientTexture([[0, '#f6e7c8'], [0.6, '#f3d9a9'], [1, '#d9b680']]);
  scene.add(new THREE.HemisphereLight('#fff1d6', '#8a6a40', 1.4));
  const key = new THREE.DirectionalLight('#ffe2b5', 2.6); key.position.set(-3, 5, 6); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 }); key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#ffd27a', 1.6); rim.position.set(4, 3, -5); scene.add(rim);

  const base = new THREE.Group();
  base.add(at(mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.4, 12), '#6f9e3f'), 0, -0.2, 0));
  base.add(at(mesh(new THREE.CylinderGeometry(2.4, 2.3, 0.35, 12), '#8a6440'), 0, -0.55, 0));
  for (let i = 0; i < 30; i++) { const a = rr(0, 6.28), r = rr(0.9, 2.05);
    base.add(at(mesh(new THREE.ConeGeometry(0.06, rr(0.15, 0.3), 3), rand() < 0.5 ? '#5d8f33' : '#86b84a'), Math.cos(a) * r, 0.08, Math.sin(a) * r)); }
  for (let i = 0; i < 8; i++) { const a = rr(0, 6.28), r = rr(1.2, 2.0);
    base.add(at(mesh(new THREE.IcosahedronGeometry(0.07, 0), ['#f2e14a', '#ffffff', '#e86a8a'][i % 3]), Math.cos(a) * r, 0.12, Math.sin(a) * r)); }
  scene.add(base);

  const ch = person(p); ch.rotation.y = -0.25; scene.add(ch);
  if (p.cow) { const c = cow(); c.scale.setScalar(0.7); c.rotation.y = -1.25; scene.add(at(c, 0.55, 0, -1.3)); ch.position.x = -0.3; }

  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
  const hgt = 1.9 * (p.height || 1);
  const dist = p.cow ? 7.0 : 5.9; camera.position.set(0.35, hgt * 0.62 + 0.35, dist); camera.lookAt(0, hgt * 0.5 + 0.12, 0);
  window.renderAt = () => renderer.render(scene, camera);
}

// ---------- запуск ----------
window.buildMap = buildMap;
if (!window.WORLD_SITE) {
  if (MODE === 'char') buildChar(params.get('id') || 'grisha'); else buildMap(STATE);
  window.renderAt(1, false);
  window.READY = true;
}
