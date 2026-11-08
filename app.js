// Живой сайт «Государства подписчиков»: 3D-мир + данные из data.json
// Идея: каждый объект мира связан с решением Думы; мир реагирует на показатели;
// зритель может просчитать закон до того, как его предложить.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSim, housesDoneAt, hutsNeeded, HUT_CAPACITY, taxRateOf } from './sim_core.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nk = s => String(s || '').trim().replace(/^@/, '').toLowerCase();
const clamp = (v, a = 0, b = 100) => Math.min(b, Math.max(a, v));
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ---------- справочники ----------
const STATS = [
  ['food', 'Еда', '#d9a43a', 'Голод: жители уходят, счастье падает'],
  ['money', 'Казна', '#c48a1a', 'Банкротство: стройки замирают'],
  ['health', 'Здоровье', '#d0453f', 'Эпидемия: болеют и работают меньше'],
  ['order', 'Порядок', '#2f5fa8', 'Разбой: грабят склад'],
  ['happy', 'Счастье', '#e7b21f', 'Бунт: Дума обязана принять закон спасения'],
];
const START = { food: 50, money: 20, health: 60, order: 50, happy: 50 };
const IC = {
  food: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#e9c25a"/><path d="M32 54V18" stroke="#7a5320" stroke-width="4" stroke-linecap="round"/><ellipse cx="25" cy="27" rx="6" ry="3.5" transform="rotate(-35 25 27)" fill="#b07d2a"/><ellipse cx="39" cy="27" rx="6" ry="3.5" transform="rotate(35 39 27)" fill="#b07d2a"/><ellipse cx="25" cy="37" rx="6" ry="3.5" transform="rotate(-35 25 37)" fill="#b07d2a"/><ellipse cx="39" cy="37" rx="6" ry="3.5" transform="rotate(35 39 37)" fill="#b07d2a"/><ellipse cx="32" cy="15" rx="3.5" ry="6" fill="#b07d2a"/></svg>',
  money: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#e2b23a"/><circle cx="32" cy="32" r="21" fill="none" stroke="#a87b16" stroke-width="4"/><rect x="26" y="22" width="12" height="20" rx="3" fill="#a87b16"/></svg>',
  health: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#f2a3a0"/><path d="M32 50 14 32a10 10 0 0 1 18-12 10 10 0 0 1 18 12Z" fill="#c8312f"/></svg>',
  order: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#9fb6d6"/><path d="M32 10 50 17v14c0 11-8 19-18 23-10-4-18-12-18-23V17Z" fill="#2f5fa8"/><path d="M24 31l6 6 11-12" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  happy: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#ffd45a"/><circle cx="23" cy="26" r="4" fill="#5a3416"/><circle cx="41" cy="26" r="4" fill="#5a3416"/><path d="M19 37c6 10 20 10 26 0" stroke="#5a3416" stroke-width="5" fill="none" stroke-linecap="round"/></svg>',
};
const EPOCHS = [
  [100, 'Поселение', 'костёр, шалаши, первые законы'],
  [300, 'Деревня', 'рынок, кузнец, лекарь, своя монета, первые министры'],
  [1000, 'Городок', 'стража, школа, лекарня, налоги, суд'],
  [3000, 'Город', 'купцы, банк, газета, театр, торговля с соседями'],
  [10000, 'Страна', 'второй город, дороги, выборы президента'],
];
const BUILD = { storage: 'Склад', well: 'Колодец', palisade: 'Частокол', fields: 'Поля', pen: 'Загон' };
const LAW_TYPES = [
  ['Построить склад', 'построить общий склад для зерна', { food: 10, money: -10 }, 'Защищает от голода зимой'],
  ['Выкопать колодец', 'выкопать колодец у реки', { health: 10, money: -5, happy: 5 }, ''],
  ['Поставить частокол', 'окружить поселение частоколом', { order: 15, money: -15, happy: -5 }, 'Защита от разбойников и волков'],
  ['Распахать поля', 'распахать новые поля у реки', { food: 15, money: -5, health: -5 }, 'Через пару выпусков ещё +5 к еде'],
  ['Общий котёл', 'охотники отдают половину добычи в общий склад', { food: 10, order: 5, happy: -10 }, 'Охотники будут недовольны'],
  ['Бесплатная еда', 'все едят бесплатно в таверне', { food: -20, money: -10, happy: 15 }, 'Риск голода через пару выпусков'],
  ['Новый налог', 'каждый платит 1 монету в неделю', { money: 15, happy: -10 }, ''],
  ['Праздник', 'устроить праздник урожая', { food: -10, money: -5, happy: 20 }, 'Самые красивые выпуски'],
  ['Выходной день', 'воскресенье — выходной для всех', { food: -5, money: -5, health: 5, happy: 10 }, ''],
  ['Субботник', 'раз в неделю все работают на стройке', { food: 5, money: 5, happy: -10 }, 'Ускоряет стройки'],
  ['Лекарня', 'построить лекарню', { health: 15, money: -15, happy: 5 }, 'Появятся лекари'],
  ['Карантин', 'закрыть ворота на время болезни', { food: -5, money: -10, health: 15, order: 5, happy: -10 }, 'Спасает при эпидемии'],
  ['Стража', 'создать стражу из 5 жителей', { order: 15, money: -10, happy: -5 }, 'Появится стража'],
  ['Рынок', 'открыть рынок по субботам', { food: 5, money: 10, order: -5, happy: 5 }, 'Появятся торговцы'],
  ['Своя монета', 'ввести свою монету', { money: 10, order: 5 }, 'Название монеты выберет Дума'],
  ['Школа', 'открыть школу для детей', { money: -10, order: 5, happy: 5 }, 'Позже: +1 ко всем броскам судьбы'],
  ['Караван к соседям', 'отправить караван к соседям', { food: 5, money: 15, health: -5, happy: 5 }, 'Риск: чужая болезнь'],
  ['Суд', 'создать суд из 3 жителей', { money: -5, order: 10, happy: 5 }, ''],
  ['Запрет', 'запретить песни после заката', { health: 5, order: 5, happy: -15 }, ''],
  ['Смешной закон', 'все носят шляпы по пятницам', { money: -5, happy: 10 }, 'Станет фишкой государства'],
];
const ICONS = {
  fire: '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z" fill="currentColor"/></svg>',
  sign: '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M4 5h16v8H4zM7 13v8M17 13v8" stroke="currentColor" stroke-width="2.4" fill="none"/></svg>',
  cow: '<svg viewBox="0 0 24 24" width="12" height="12"><circle cx="12" cy="13" r="7" fill="currentColor"/><path d="M5 6l3 3M19 6l-3 3" stroke="currentColor" stroke-width="2.4"/></svg>',
};

let D = null, worldKey = '';
const effOf = l => (l && !l.veto && l.effects) || {};
const lawsOk = () => D.laws.filter(l => !l.veto);

// ---------- 3D ----------
// качество: на телефонах дешевле; по замеру кадров снижаем ещё
const QUALITY = { dpr: Math.min(devicePixelRatio || 1, matchMedia('(pointer: coarse)').matches ? 1.25 : 1.5), fpsCap: 30 };
let sim = null, world, camera, controls, flight = null, garland = null, crisisSmoke = [], pins = [];
const DATA_URL = './' + (new URLSearchParams(location.search).get('data') || 'data.json').replace(/[^\w.-]/g, '');
const loadData = async () => (await fetch(DATA_URL + '?ts=' + Date.now(), { cache: 'no-store' })).json();

function mergeStatic(scene) {
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

function cheapMaterials(root) {
  const cache = new Map();
  root.traverse(o => { if (!o.isMesh) return; const swap = m => { if (!m || !m.isMeshStandardMaterial || (m.emissive && m.emissive.getHex() !== 0)) return m; if (cache.has(m)) return cache.get(m);
      const n = new THREE.MeshLambertMaterial({ color: m.color, vertexColors: m.vertexColors, flatShading: m.flatShading, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity,
        transparent: m.transparent, opacity: m.opacity, map: m.map, side: m.side, depthWrite: m.depthWrite }); n.color = m.color; cache.set(m, n); return n; };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material); });
}
function buildWorld() {
  const st = { population: D.population, name: D.name || '', ...D.world, noCrowd: true, huts: hutsNeeded(D.population, housesDoneAt(mskHour(), taxRateOf(D))) };
  worldKey = JSON.stringify(st);
  window.buildMap(st);
  world = window.WORLD;
  const { renderer, scene, groundH, CAMP } = world;
  $('stage').appendChild(renderer.domElement);
  renderer.setPixelRatio(QUALITY.dpr);
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  mergeStatic(scene);
  cheapMaterials(scene);
  sim = createSim(world, D);
  cheapMaterials(scene); setInterval(() => cheapMaterials(scene), 5000);   // новые дома и стройки тоже
  // гирлянда — появляется, когда счастье высокое
  garland = new THREE.Group(); const cols = ['#ffd27a', '#ff7a5a', '#8fd0ff', '#b8f07a'];
  for (let i = 0; i < 40; i++) { const an = i / 40 * 6.283, x = CAMP.x + Math.cos(an) * 7, z = CAMP.y + Math.sin(an) * 6.3;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshBasicMaterial({ color: cols[i % 4] }));
    b.position.set(x, groundH(x, z) + 2.3 - Math.abs(Math.sin(an * 4)) * 0.5, z); garland.add(b); }
  scene.add(garland);
  // дым кризиса
  for (let i = 0; i < 10; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), new THREE.MeshStandardMaterial({ color: '#3a3430', transparent: true, opacity: 0.5, flatShading: true })); s.visible = false; scene.add(s); crisisSmoke.push(s); }
  camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 500);
  camera.position.set(4, 36, 50);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, -2); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 8; controls.maxDistance = 110; controls.maxPolarAngle = 1.36; controls.autoRotateSpeed = 0.3;
  // управление как у карты: один палец / левая кнопка — двигать, щипок — масштаб, два пальца / правая кнопка — поворот
  controls.screenSpacePanning = false; controls.panSpeed = 1.3; controls.zoomSpeed = 1.1;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.listenToKeyEvents(window); controls.keyPanSpeed = 25;
  let idle = 0, downAt = 0, downXY = [0, 0];
  renderer.domElement.addEventListener('pointerdown', e => { idle = performance.now(); downAt = idle; downXY = [e.clientX, e.clientY]; controls.autoRotate = false; flight = null; hideHint(); });
  renderer.domElement.addEventListener('pointermove', e => { if (e.buttons && Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 10) { idle = performance.now(); if (!$('panel').classList.contains('closed')) togglePanel(false); } });
  renderer.domElement.addEventListener('pointerup', e => { if (performance.now() - downAt < 250 && Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) < 8) {
    const a = sim.pick(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera); if (a) showResident(a); else togglePanel(false); } });
  renderer.domElement.addEventListener('wheel', () => { idle = performance.now(); controls.autoRotate = false; }, { passive: true });
  world.idle = () => idle; world.touch = () => { idle = performance.now(); };
  addEventListener('resize', resize); resize();
  buildPins();
}
function resize() { if (!world) return; world.renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }

// метки на объектах: каждый объект мира — чьё-то решение
function buildPins() {
  const { groundH, CAMP } = world, P = (x, z, h) => new THREE.Vector3(x, groundH(x, z) + h, z);
  const lawFor = b => D.laws.find(l => !l.veto && l.building === b);
  const list = [
    { pos: P(CAMP.x, CAMP.y, 3.2), icon: ICONS.fire, text: 'Сердце поселения', info: () => `<h2>Костёр</h2><div class="sub">Сердце поселения</div><div class="box hint">Здесь собираются ${D.population} жителей. Всё, что строится вокруг, появляется только по законам Думы — то есть по комментариям зрителей.</div>` },
    { pos: P(3.6, 10, 2.6), icon: ICONS.sign, text: D.name ? D.name : 'Имя выбирается', info: () => D.name ? `<h2>${esc(D.name)}</h2><div class="box hint">Название государства. ${(() => { const l = D.nameBy || D.laws.find(x => x.kind === 'name'); return l ? `Предложил(а) ${esc(l.author)}${l.likes ? ', ' + l.likes + ' ❤' : ''}.` : ''; })()}</div>` : `<h2>Имени пока нет</h2><div class="box hint">Название выбирается прямо сейчас на заседании Думы. Самый залайканный комментарий станет именем государства.</div>` },
    { pos: P(4.2, 6.5, 2.2), icon: ICONS.cow, text: `Коровы Гриши · ${D.world.cows ?? 5}`, info: () => charInfo('grisha') },
  ];
  const BP = { storage: [-7.5, -3, 4.2], well: [4, -2.5, 3.4], palisade: [-12, 1, 3], fields: [0, -11, 1.8], pen: [4.2, 9.2, 1.6] };
  for (const b of D.world.buildings || []) {
    if (!BP[b]) continue; const l = lawFor(b);
    list.push({ pos: P(BP[b][0], BP[b][1], BP[b][2]), law: l?.num, text: BUILD[b] + (l?.author ? ' · ' + l.author : ''), info: () => `<h2>${BUILD[b]}</h2>` + (l ? `<div class="sub">Построен по закону №${l.num}</div><div class="box"><div class="hint">«${esc(l.text)}»</div><div class="sub" style="margin-top:6px">Автор: ${esc(l.author || '—')}${l.likes ? ' · ' + l.likes + ' ❤' : ''}</div>${chips(l.effects)}</div>` : '<div class="box hint">Построен решением Думы.</div>') });
  }
  for (const h of sim?.houses() || []) list.push({ pos: P(h.x, h.z, h.p >= 1 ? 4.2 : 2.6), icon: ICONS.sign, text: h.p >= 1 ? `Дом ${h.owner}` : `Стройка: дом ${h.owner} · ${Math.round(h.p * 100)}%`,
    info: () => `<h2>${h.p >= 1 ? 'Дом ' + esc(h.owner) : 'Стройка дома ' + esc(h.owner)}</h2><div class="sub">${h.p >= 1 ? 'Сруб из брёвен, которые заготовили лесорубы' : 'Строят двое плотников вместе с будущим хозяином'}</div><div class="box hint">${h.p >= 1 ? 'Хозяин переехал сюда из общего шалаша. Следующий дом в очереди уже строится.' : `Готово на ${Math.round(h.p * 100)}%. Каждый дом — 16 брёвен: лесорубы рубят дерево, несут брёвна на стройку, плотники ставят венец за венцом.`}</div>` });
  for (const b of sim?.biz() || []) if (b.x != null) list.push({ pos: P(b.x, b.z, 2.6), icon: ICONS.sign, text: `${b.shop} · ${b.owner}`,
    info: () => `<h2>${esc(b.shop)}</h2><div class="sub">${esc(b.title)} — ${esc(b.owner)}</div><div class="box hint">Своё дело открыто на ${b.day + 1}-й день государства: ${esc(b.why)}. Хозяин вложил 50 монет, а теперь зарабатывает на покупателях: жители тратят здесь часть своих денег. Чем опытнее хозяин, тем лучше товар и тем больше покупают.</div>` });
  $('pins').innerHTML = '';
  pins = list.map(p => { const el = document.createElement('button'); el.className = 'pin' + (p.law ? ' pinlaw' : ''); el.innerHTML = `<b>${p.law ? p.law : p.icon}</b>${esc(p.text)}`;
    el.onclick = () => showInfo(p.info()); $('pins').appendChild(el); return { ...p, el }; });
}
const tmpV = new THREE.Vector3();
let barBottom = 80; setInterval(() => { const b = document.querySelector('.bar'); if (b) barBottom = b.getBoundingClientRect().bottom; }, 1000);
function updatePins() {
  const placed = [];
  for (const p of [...pins].sort((x, y) => (y.law ? 1 : 0) - (x.law ? 1 : 0))) {
    tmpV.copy(p.pos).project(camera);
    const x = (tmpV.x + 1) / 2 * innerWidth, y = (1 - tmpV.y) / 2 * innerHeight;
    let vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.05 && y > barBottom + 30 && y < innerHeight - 70;
    if (vis) { p.w ||= p.el.offsetWidth || 120; p.h ||= p.el.offsetHeight || 28;
      const r = [x - p.w / 2, y - p.h, x + p.w / 2, y];
      if (placed.some(q => r[0] < q[2] + 4 && r[2] + 4 > q[0] && r[1] < q[3] + 4 && r[3] + 4 > q[1])) vis = false; else placed.push(r); }
    p.el.style.visibility = vis ? 'visible' : 'hidden';
    if (vis) p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }
}
// московское время (для отладки: ?hour=14&speed=600)
const T0 = performance.now(), QP = new URLSearchParams(location.search);
function mskHour() {
  const dbg = QP.get('hour'); if (dbg) return (+dbg + (performance.now() - T0) / 1000 * (+QP.get('speed') || 1) / 3600) % 24;
  const p = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
  return +p.find(x => x.type === 'hour').value + +p.find(x => x.type === 'minute').value / 60;
}
function skyTex(top, mid, bot) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(0.6, mid); gr.addColorStop(1, bot); x.fillStyle = gr; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let dayPart = '', skySet = false;
// ночи нет: в государстве всегда светлый день, часы показывают московское время
function dayNight() {
  const h = mskHour(), { sun, hemi, scene } = world;
  if (!skySet) { skySet = true;
    sun.intensity = 2.65; sun.color.set('#ffd9a0'); hemi.intensity = 1.2; hemi.color.set('#ffeacc'); hemi.groundColor.set('#5d7a3a');
    scene.background = skyTex('#7fb8e6', '#cfe3ef', '#f7dcb0'); scene.fog.color.set('#efdcb9'); }
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  dayPart = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} МСК`;
  renderBar();
}

// ---------- интерфейс ----------
const epoch = pop => { let i = 0; EPOCHS.forEach((e, k) => { if (pop >= e[0]) i = k; }); return { cur: EPOCHS[i], next: EPOCHS[i + 1] }; };
const chips = e => { const ks = STATS.filter(([k]) => e?.[k]); return ks.length ? `<div class="chips">${ks.map(([k, l]) => `<span class="chip ${e[k] > 0 ? 'p' : 'n'}">${l} ${e[k] > 0 ? '+' : ''}${e[k]}</span>`).join('')}</div>` : ''; };
const statusOf = v => v < 20 ? 'кризис' : v < 40 ? 'плохо' : v < 70 ? 'норма' : 'отлично';
function renderBar() {
  if (!D) return;
  $('name').textContent = D.name || 'Государство без имени';
  document.title = (D.name || 'Государство подписчиков') + ' · LIVE';
  $('status').textContent = `${D.population.toLocaleString('ru-RU')} ${plural(D.population, 'житель', 'жителя', 'жителей')} · ${epoch(D.population).cur[1]} · ${dayPart}`;
}
function renderAlert() {
  const low = STATS.filter(([k]) => D.stats[k] < 20);
  const el = $('alert');
  if (low.length) { el.className = 'alert'; el.innerHTML = `⚠ КРИЗИС: ${low.map(([k, l, , w]) => `${l} ${D.stats[k]} — ${w.split(':')[0].toLowerCase()}`).join(' · ')}. Думе нужен закон спасения.`; el.hidden = false; }
  else if (D.stats.happy >= 70) { el.className = 'alert good'; el.textContent = `Праздник: счастье ${D.stats.happy}. Жители развесили огни.`; el.hidden = false; }
  else el.hidden = true;
  const r = document.querySelector('.bar').getBoundingClientRect(); el.style.top = (r.bottom + 8) + 'px';
  garland.visible = D.stats.happy >= 70;
  crisisSmoke.forEach(s => s.visible = low.length > 0);
}
function tickTimer() {
  const el = document.getElementById('timer'), s = D?.session; if (!el || !s?.deadline) return;
  const ms = new Date(s.deadline) - Date.now();
  if (ms <= 0) { el.textContent = 'Итоги подводятся'; return; }
  const h = Math.floor(ms / 36e5), m = Math.floor(ms / 6e4) % 60, sec = Math.floor(ms / 1e3) % 60;
  el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
function meterRow(k, l, c, v, nv) {
  const d = nv == null ? null : nv - v, lo = Math.min(v, nv ?? v), hi = Math.max(v, nv ?? v);
  return `<div class="stat">${IC[k]}<div class="l">${l}<small>${statusOf(nv ?? v)}</small></div>
    <div class="meter"><i style="width:${lo}%;background:${c}"></i>${d ? `<em style="left:${lo}%;width:${hi - lo}%;background:${d > 0 ? '#3f9a52' : '#c8312f'}"></em>` : ''}<u></u></div>
    <div class="v">${nv ?? v}${d ? `<small class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</small>` : ''}</div></div>`;
}
const igUrl = () => D.instagram ? `https://www.instagram.com/${encodeURIComponent(nk(D.instagram))}/` : '';

const TABS = {
  now() {
    const s = D.session || {}, vote = s.reel || igUrl();
    const welcome = store.get('welcomed') ? '' : `<div class="welcome" id="welcome"><b>Это государство подписчиков.</b> Каждый подписчик — новый житель, каждый комментарий под роликом — законопроект. Закон с наибольшим числом лайков вступает в силу, и мир здесь меняется.<br><button id="okWelcome">Понятно</button></div>`;
    const leaders = (s.leaders || []).slice(0, 3);
    return `${welcome}
    <div class="box"><div class="lbl">ЗАСЕДАНИЕ ДУМЫ №${s.num || 1} · ИДЁТ СЕЙЧАС</div><div class="q">${esc(s.question || 'Скоро новое заседание')}</div>
      <div class="row"><div class="timer" id="timer">--:--:--</div>${vote ? `<a href="${esc(vote)}" target="_blank" rel="noopener"><button>Голосовать в Instagram</button></a>` : ''}</div>
      <div class="hint" style="margin-top:8px">Напиши в комментариях под роликом <b>${esc(s.format || 'ЗАКОН: …')}</b> и лайкай лучшие варианты.</div>
      ${leaders.length ? `<h3>Сейчас лидируют${s.leadersAt ? ' · ' + esc(s.leadersAt) : ''}</h3>` + leaders.map((x, i) => `<div class="lead"><div class="k">${i + 1}</div><div class="x">${esc(x.text)}<small>${esc(x.author || '')}</small></div><div class="l">${x.likes} ❤</div></div>`).join('') : ''}
    </div>
    <div class="box"><div class="lbl">ПРЯМО СЕЙЧАС В ПОСЕЛЕНИИ</div><div class="hint" id="liveNow" style="font-weight:700;color:#2b1a0e;margin-top:4px">…</div></div>
    <h3>Что будет, если…</h3>
    <div class="box"><div class="hint">Просчитай закон до того, как предложить его Думе.</div>
      <select id="simSel" style="margin-top:10px" aria-label="Тип закона">${LAW_TYPES.map((t, i) => `<option value="${i}">${t[0]}</option>`).join('')}</select>
      <div id="simOut"></div></div>
    <h3>Последнее в летописи</h3>
    ${[...D.news].reverse().slice(0, 3).map(n => `<div class="box"><div class="sub">${esc(n.date)}</div><div class="hint" style="font-weight:700;color:#2b1a0e">${esc(n.text)}</div></div>`).join('')}`;
  },
  state() {
    const { cur, next } = epoch(D.population);
    const k = next ? (D.population - cur[0]) / (next[0] - cur[0]) : 1;
    return `<h2>${esc(D.name || 'Государство без имени')}</h2><div class="sub">${D.population} ${plural(D.population, 'житель', 'жителя', 'жителей')} · эпоха «${cur[1]}» · законов: ${lawsOk().length}</div>
    <div class="box">${STATS.map(([k2, l, c]) => meterRow(k2, l, c, D.stats[k2])).join('')}<div class="hint" style="margin-top:6px">Красная черта — 20. Ниже неё начинается кризис.</div></div>
    <h3>Рост государства</h3>
    <div class="box"><div class="meter" style="height:14px"><i style="width:${Math.round(k * 100)}%;background:linear-gradient(90deg,#e2b23a,#ffd27a)"></i></div>
      <div class="hint" style="margin-top:8px">${next ? `До эпохи <b>«${next[1]}»</b> — ещё ${next[0] - D.population} ${plural(next[0] - D.population, 'житель', 'жителя', 'жителей')}. Откроется: ${next[2]}.` : 'Достигнута высшая эпоха.'}<br>Каждый новый подписчик — новый житель.</div></div>
    <h3>Развитие поселения</h3>
    <div class="box" id="devBox">${devHtml()}</div>
    <h3>Жители, которых стоит знать</h3>
    ${D.characters.map(c => `<div class="person"><img src="img/${c.id}.jpg" alt="" loading="lazy"><div><b>${esc(c.name)}</b><small>${esc(c.role)}</small><p>${esc(c.about)}</p></div></div>`).join('')}
    <h3>Правительство</h3>
    ${D.ministers.map(m => `<div class="rank"><div class="x">${esc(m.post)}<small>${m.nick ? '@' + esc(nk(m.nick)) : 'вакантно — выборы скоро'} · отвечает за: ${esc(m.area)}</small></div></div>`).join('')}`;
  },
  laws() {
    if (!D.laws.length) return `<h2>Свод законов</h2><div class="box empty">Ни одного закона пока не принято. Первым станет решение заседания №${D.session?.num || 1}: «${esc(D.session?.question || '')}». Твой комментарий может открыть историю государства.</div>`;
    let cur = { ...START, ...(D.startStats || {}) }; const hist = [];
    for (const l of D.laws) { const e = effOf(l); cur = Object.fromEntries(STATS.map(([k]) => [k, clamp(cur[k] + (e[k] || 0))])); hist.push({ l, s: cur }); }
    return `<h2>Свод законов</h2><div class="sub">Принято ${lawsOk().length} · под каждым законом — состояние государства после него</div><div style="margin-top:12px">` +
      hist.reverse().map(({ l, s }) => `<div class="law${l.veto ? ' veto' : ''}"><div class="h">Закон №${l.num}${l.veto ? ' · ВЕТО' : ''}${l.date ? ' · ' + esc(l.date) : ''}</div><div class="t">${esc(l.text)}</div>
        <div class="m">${l.author ? 'Автор: ' + esc(l.author) : ''}${l.likes ? ' · ' + l.likes + ' ❤' : ''}</div>${l.result ? `<div class="m" style="color:#a2342a;font-weight:800">${esc(l.result)}</div>` : ''}${l.veto ? '' : chips(l.effects)}
        <div class="mini" title="Еда, казна, здоровье, порядок, счастье после закона">${STATS.map(([k, , c]) => `<span><i style="width:${s[k]}%;background:${c}"></i></span>`).join('')}</div></div>`).join('') + '</div>';
  },
  deputies() {
    const by = new Map();
    for (const l of lawsOk()) { if (!l.author) continue; const key = nk(l.author); const r = by.get(key) || { nick: key, laws: [], likes: 0 }; r.laws.push(l.num); r.likes += l.likes || 0; by.set(key, r); }
    const top = [...by.values()].sort((a, b) => b.laws.length - a.laws.length || b.likes - a.likes);
    return `<h2>Зал славы Думы</h2><div class="sub">Депутаты, чьи законы вступили в силу</div>` +
      (top.length ? top.map((r, i) => `<div class="rank"><div class="p">${i + 1}</div><div class="x">@${esc(r.nick)}<small>${r.laws.length} ${plural(r.laws.length, 'закон', 'закона', 'законов')} (№${r.laws.join(', №')}) · ${r.likes} ❤</small></div></div>`).join('')
        : `<div class="box empty">Здесь пока пусто. Первый депутат, чей закон примут, навсегда займёт первое место в истории государства.</div>`) +
      `<h3>Как попасть сюда</h3><ol class="steps"><li>Напиши закон в комментариях под новым роликом.</li><li>Собери больше всех лайков за 24 часа — зови друзей.</li><li>Закон вступает в силу, а ты — в историю. Победить можно не чаще раза в неделю.</li></ol>`;
  },
  me() {
    return `<h2>Паспорт гражданина</h2><div class="sub">Найди себя среди граждан государства</div>
    <form class="form" id="findForm"><input id="nick" placeholder="Твой ник в Instagram" autocomplete="off" autocapitalize="off" aria-label="Ник в Instagram"><button>Найти</button></form>
    <div id="pass"></div>
    <h3>Как получить паспорт</h3>
    <ol class="steps"><li>Подпишись${D.instagram ? ` на <a href="${esc(igUrl())}" target="_blank" rel="noopener"><b>@${esc(nk(D.instagram))}</b></a>` : ''} — так ты становишься одним из жителей.</li><li>Напиши «Присягаю» в комментариях под любым роликом.</li><li>В течение суток получишь номер гражданина. Найди себя здесь и сделай картинку для сторис.</li></ol>`;
  },
};

function passportHtml(r) {
  const laws = lawsOk().filter(l => nk(l.author) === nk(r.nick)), mins = D.ministers.filter(m => nk(m.nick) === nk(r.nick));
  return `<div class="passport"><div class="k">${esc((D.name || 'Государство подписчиков').toUpperCase())} · ПАСПОРТ</div><div class="num">№ ${String(r.num).padStart(4, '0')}</div>
    <div class="f"><span>Гражданин</span>@${esc(nk(r.nick))}</div><div class="f"><span>Занятие</span>${esc(r.prof || 'житель')}</div>
    ${r.joined ? `<div class="f"><span>Присяга</span>${esc(r.joined)}</div>` : ''}
    <div class="f"><span>Принятых законов</span>${laws.length}</div>${mins.length ? `<div class="f"><span>Должность</span>${esc(mins.map(m => m.post).join(', '))}</div>` : ''}</div>
    <button id="story" style="width:100%;margin-top:10px">Сделать картинку для сторис</button>`;
}
function findMe(raw) {
  const n = nk(raw); if (!n) return;
  const r = D.residents.find(x => nk(x.nick) === n);
  $('pass').innerHTML = r ? passportHtml(r) : `<div class="box empty">@${esc(n)} пока нет среди граждан. Напиши «Присягаю» под любым роликом — и в течение суток паспорт появится здесь.</div>`;
  if (r) { $('story').onclick = () => storyImage(r); store.set('me', n); }
}

// картинка для сторис: снимок живого мира + паспорт
async function storyImage(r) {
  await document.fonts.load('60px "Ruslan Display"'); await document.fonts.load('900 40px Inter');
  const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  world.renderer.render(world.scene, camera);
  const src = world.renderer.domElement, sw = src.width, sh = src.height, k = Math.max(W / sw, 1150 / sh);
  x.fillStyle = '#1a1209'; x.fillRect(0, 0, W, H);
  x.drawImage(src, (W - sw * k) / 2, 0, sw * k, sh * k);
  const g = x.createLinearGradient(0, 700, 0, 1150); g.addColorStop(0, 'rgba(26,18,9,0)'); g.addColorStop(1, 'rgba(26,18,9,1)'); x.fillStyle = g; x.fillRect(0, 700, W, 450);
  x.fillStyle = '#1a1209'; x.fillRect(0, 1150, W, H - 1150);
  x.textAlign = 'center'; x.fillStyle = '#ffd27a'; x.font = '64px "Ruslan Display"'; x.fillText(D.name || 'Государство подписчиков', W / 2, 160);
  x.font = '800 36px Inter'; x.fillStyle = '#f6efe2'; x.fillText('Я — гражданин этого государства', W / 2, 220);
  const px = 90, py = 1000, pw = W - 180, ph = 640;
  const pg = x.createLinearGradient(px, py, px + pw, py + ph); pg.addColorStop(0, '#fbf2dd'); pg.addColorStop(1, '#e9cf98');
  x.fillStyle = pg; x.beginPath(); x.roundRect(px, py, pw, ph, 36); x.fill(); x.lineWidth = 10; x.strokeStyle = '#8a5f36'; x.stroke();
  x.textAlign = 'left'; x.fillStyle = '#8a2f24'; x.font = '900 30px Inter'; x.fillText('ПАСПОРТ ГРАЖДАНИНА', px + 50, py + 80);
  x.fillStyle = '#5a1f16'; x.font = '110px "Ruslan Display"'; x.fillText('№ ' + String(r.num).padStart(4, '0'), px + 50, py + 210);
  const laws = lawsOk().filter(l => nk(l.author) === nk(r.nick)).length;
  [['Гражданин', '@' + nk(r.nick)], ['Занятие', r.prof || 'житель'], ['Принятых законов', String(laws)], ['Жителей в государстве', String(D.population)]].forEach(([a, b], i) => {
    const y = py + 300 + i * 80; x.strokeStyle = 'rgba(90,52,22,.3)'; x.setLineDash([10, 8]); x.lineWidth = 3; x.beginPath(); x.moveTo(px + 50, y - 50); x.lineTo(px + pw - 50, y - 50); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#8a5f36'; x.font = '700 34px Inter'; x.textAlign = 'left'; x.fillText(a, px + 50, y);
    x.fillStyle = '#2b1a0e'; x.font = '900 38px Inter'; x.textAlign = 'right'; x.fillText(b, px + pw - 50, y); });
  x.save(); x.translate(px + pw - 130, py + 130); x.rotate(-0.3); x.strokeStyle = 'rgba(181,53,42,.85)'; x.lineWidth = 9; x.beginPath(); x.arc(0, 0, 95, 0, 6.283); x.stroke();
  x.fillStyle = 'rgba(181,53,42,.9)'; x.font = '44px "Ruslan Display"'; x.textAlign = 'center'; x.fillText('ДУМА', 0, 10); x.restore();
  x.textAlign = 'center'; x.fillStyle = '#ffd27a'; x.font = '900 40px Inter'; x.fillText('Стань жителем и пиши законы', W / 2, 1760);
  if (D.instagram) { x.fillStyle = '#f6efe2'; x.font = '800 36px Inter'; x.fillText('@' + nk(D.instagram), W / 2, 1815); }
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  const file = new File([blob], `pasport-${nk(r.nick)}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Мой паспорт гражданина' }); return; } catch {} }
  const url = URL.createObjectURL(blob), m = document.createElement('div'); m.className = 'mod';
  m.innerHTML = `<div><img src="${url}" alt="Паспорт гражданина"><p>Нажми и удерживай картинку, чтобы сохранить, и выложи в сторис.</p><a href="${url}" download="${file.name}"><button>Скачать</button></a> <button class="soft" style="color:#fff" id="modClose">Закрыть</button></div>`;
  document.body.appendChild(m); m.querySelector('#modClose').onclick = () => m.remove();
}

function devHtml() {
  const s = sim?.stats(); if (!s?.eco) return '…'; const e = s.eco;
  const busy = (s.hutOcc || []).reduce((x, v) => x + v, 0);
  return `<div class="hint">⛺ Шалашей: <b>${s.huts}</b> · по ${s.hutCap} мест · живут <b>${busy}</b> из ${s.huts * s.hutCap}<br>🪵 Заготовлено брёвен: <b>${e.logs}</b><br>🏠 Построено своих домов: <b>${e.done}</b>${s.building ? `<br>🔨 Сейчас строится дом ${esc(s.building.owner)} — <b>${Math.round(s.building.p * 100)}%</b>` : ''}${e.tax ? `<br>🏛 Государственный запас (закон №1): <b>${e.reserve.logs}</b> брёвен, <b>${e.reserve.fish}</b> рыбы${e.tax < 0.1 ? ' — собрана лишь малая часть: жители прячут добычу' : ''}` : ''}<br>🐟 Поймано рыбы: <b>${e.fish}</b><br>🌾 Собрано урожаев: <b>${e.harvests}</b></div>
    ${s.life ? `<div class="hint" style="margin-top:8px">💰 Казна: <b>${e.treasury}</b> монет${e.tax ? ' (налог 10% с заработка + плата за места в шалашах)' : ' (плата за места в шалашах)'}<br>${s.life.biz ? `🧰 Своё дело открыли: <b>${s.life.biz}</b> ${plural(s.life.biz, 'предприниматель', 'предпринимателя', 'предпринимателей')} — ${(sim.biz() || []).map(b => esc(b.shop.toLowerCase()) + ' (' + esc(b.owner) + ')').join(', ')}<br>` : '🧰 Своё дело пока никто не открыл: ждут спроса и копят 50 монет<br>'}🎖 Мастеров и выше: <b>${s.life.masters}</b> — чем их больше, тем быстрее растут запасы и казна<br>${s.life.best ? `🏆 Самый опытный: ${esc(s.life.best.who)} — ${esc(s.life.best.title)}<br>` : ''}🧑‍🌾 Без работы: <b>${s.life.jobless}</b>${s.life.hiredToday ? ` · сегодня устроились на работу: <b>${s.life.hiredToday}</b>` : ''}<br>🍞 Средний кошелёк: <b>${s.life.avgCoins}</b> монет${s.life.hungry ? ` · не хватило на хлеб: <b>${s.life.hungry}</b>` : ''}</div>` : ''}
    <div class="hint" style="margin-top:8px">Каждый житель мечтает о своём доме. Дом — это 16 брёвен: двое лесорубов рубят лес, плотники и хозяин строят. Всё платно: хлеб и место в шалаше стоят монет, а монеты даёт только работа. С каждым рабочим днём жители набираются опыта: 10 уровней на каждой из 10 должностей — от новичка до владельца своего производства. Нажми на любого жителя на карте, чтобы узнать, о чём он думает.</div>`;
}
setInterval(() => { const el = document.getElementById('devBox'); if (el) el.innerHTML = devHtml(); }, 3000);

// ---------- панель ----------
let tab = 'now';
function showTab(t) {
  tab = t; document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  $('body').innerHTML = TABS[t](); togglePanel(true); $('panel').scrollTop = 0; wire();
}
function showInfo(html) { tab = null; document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-selected', false)); $('body').innerHTML = html; togglePanel(true); $('panel').scrollTop = 0; }
function charInfo(id) { const c = D.characters.find(x => x.id === id); return c ? `<div class="person"><img src="img/${c.id}.jpg" alt=""><div><b>${esc(c.name)}</b><small>${esc(c.role)}</small><p>${esc(c.about)}</p></div></div>` : ''; }
function togglePanel(open) { $('panel').classList.toggle('closed', !(open ?? $('panel').classList.contains('closed'))); }
$('grab').onclick = () => togglePanel();
document.querySelectorAll('.nav button').forEach(b => b.onclick = () => (tab === b.dataset.tab && !$('panel').classList.contains('closed')) ? togglePanel(false) : showTab(b.dataset.tab));
function wire() {
  tickTimer();
  $('okWelcome')?.addEventListener('click', () => { store.set('welcomed', '1'); $('welcome').remove(); });
  const sel = $('simSel');
  if (sel) { const run = () => {
      const [name, ex, e, note] = LAW_TYPES[+sel.value];
      const nv = Object.fromEntries(STATS.map(([k]) => [k, clamp(D.stats[k] + (e[k] || 0))]));
      const crisis = STATS.filter(([k]) => nv[k] < 20 && D.stats[k] >= 20).map(([, l]) => l.toLowerCase());
      $('simOut').innerHTML = `<div style="margin-top:8px">${STATS.map(([k, l, c]) => meterRow(k, l, c, D.stats[k], nv[k])).join('')}</div>
        ${crisis.length ? `<div class="hint down" style="font-weight:800">⚠ Вызовет кризис: ${crisis.join(', ')}</div>` : ''}${note ? `<div class="hint">${esc(note)}</div>` : ''}
        <button id="copyLaw" style="width:100%;margin-top:10px">Скопировать: «ЗАКОН: ${esc(ex)}»</button>`;
      $('copyLaw').onclick = async ev => { try { await navigator.clipboard.writeText('ЗАКОН: ' + ex); ev.target.textContent = 'Скопировано — вставь в комментарии ✓'; } catch { prompt('Скопируй и вставь в комментарии:', 'ЗАКОН: ' + ex); } };
    }; sel.onchange = run; run(); }
  const f = $('findForm');
  if (f) { f.onsubmit = e => { e.preventDefault(); findMe($('nick').value); $('nick').blur(); }; const me = store.get('me'); if (me) { $('nick').value = me; findMe(me); } }
}

// ---------- кнопки карты ----------
function zoomBy(k) { const d = camera.position.clone().sub(controls.target); const len = Math.min(controls.maxDistance, Math.max(controls.minDistance, d.length() * k));
  flight = { t0: performance.now(), fromP: camera.position.clone(), fromT: controls.target.clone(), toT: controls.target.clone(), toP: controls.target.clone().add(d.setLength(len)) }; }
function rotateBy(ang) { const d = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
  flight = { t0: performance.now(), fromP: camera.position.clone(), fromT: controls.target.clone(), toT: controls.target.clone(), toP: controls.target.clone().add(d) }; }
function home() { flight = { t0: performance.now(), fromP: camera.position.clone(), fromT: controls.target.clone(), toT: new THREE.Vector3(0, 0, -2), toP: new THREE.Vector3(4, 36, 50) }; }
const ctl = document.createElement('div'); ctl.className = 'mapctl';
ctl.innerHTML = `<button aria-label="Приблизить">+</button><button aria-label="Отдалить">−</button><button aria-label="Повернуть карту">⟳</button><button aria-label="К центру поселения">◎</button>`;
document.body.appendChild(ctl);
const [bIn, bOut, bRot, bHome] = ctl.children;
const act = f => () => { world.touch(); controls.autoRotate = false; f(); };
bIn.onclick = act(() => zoomBy(0.7)); bOut.onclick = act(() => zoomBy(1.4)); bRot.onclick = act(() => rotateBy(Math.PI / 4)); bHome.onclick = act(home);
let hintEl = null;
function hideHint() { if (hintEl) { hintEl.remove(); hintEl = null; store.set('mapHint', '1'); } }
if (!store.get('mapHint')) {
  hintEl = document.createElement('div'); hintEl.className = 'maphint';
  hintEl.innerHTML = matchMedia('(pointer: coarse)').matches ? '<b>Двигай карту пальцем</b><br>щипок — масштаб · два пальца — поворот' : '<b>Тяни мышью, чтобы двигать карту</b><br>колесо — масштаб · правая кнопка — поворот';
  document.body.appendChild(hintEl); setTimeout(hideHint, 7000);
}

let shownResident = null;
function residentHtml(a) {
  const i = sim.info(a), bar = (v, c) => `<div class="meter" style="height:10px"><i style="width:${v}%;background:${c}"></i></div>`;
  return `${i.named ? `<div class="person" style="padding:0 0 6px"><img src="img/${i.named}.jpg" alt=""><div><b>${esc(i.title)}</b><small>${esc(i.prof)}</small></div></div>` : `<h2>${esc(i.title)}</h2><div class="sub">${esc(i.prof)}</div>`}
    <div class="box"><div class="lbl">МЫСЛИ</div><div class="hint" style="font-weight:800;color:#2b1a0e;font-size:15px;margin-top:4px">💭 ${esc(i.thought)}</div></div>
    <div class="box"><div class="stat" style="grid-template-columns:96px 1fr 40px"><div class="l">Бодрость</div>${bar(i.energy, '#3f9a52')}<div class="v">${i.energy}</div></div>
      <div class="stat" style="grid-template-columns:96px 1fr 40px"><div class="l">Сытость</div>${bar(i.satiety, '#d9a43a')}<div class="v">${i.satiety}</div></div></div>
    <div class="box"><div class="lbl">РАБОТА И ОПЫТ</div>
      ${i.career.rankNo ? `<div class="stat" style="grid-template-columns:96px 1fr 40px;margin-top:6px"><div class="l">Опыт</div>${bar(Math.round(i.career.frac * 100), '#2f5fa8')}<div class="v">${Math.round(i.career.frac * 100)}%</div></div>
      <div class="ranks" aria-label="Должность ${i.career.rankNo} из 10">${Array.from({ length: 10 }, (_, k) => `<i class="${k < i.career.rankNo ? 'on' : ''}"></i>`).join('')}</div>` : ''}
      <div class="hint" style="margin-top:4px">${esc(i.career.line)}${i.career.speed ? `<br>⚡ Работает на ${i.career.speed}% быстрее новичка` : ''}</div></div>
    <div class="box"><div class="lbl">ДЕНЬГИ</div><div class="hint" style="margin-top:4px">${esc(i.career.money || '')}</div></div>
    <div class="box"><div class="lbl">КОШЕЛЁК</div><div class="hint" style="margin-top:4px;font-size:15px;color:#2b1a0e"><b>💰 ${esc(i.coins)}</b>${i.hungry ? ' · <b style="color:#b5352a">не хватило на хлеб</b>' : ''}</div>
      <div class="hint">${esc(i.spend)}. Деньги даёт только работа.</div></div>
    <div class="box"><div class="lbl">ЖИЗНЬ</div><div class="hint" style="margin-top:4px">🏠 ${esc(i.home)}<br>⭐ Мечта: ${esc(i.dream)}<br>📅 В поселении: ${i.days} ${plural(i.days, 'день', 'дня', 'дней')}</div></div>`;
}
function showResident(a) { shownResident = a; showInfo(residentHtml(a)); }
setInterval(() => { if (shownResident && tab === null && !$('panel').classList.contains('closed')) { const st = $('panel').scrollTop; $('body').innerHTML = residentHtml(shownResident); $('panel').scrollTop = st; } else if (tab !== null) shownResident = null; }, 2000);

const bubbles = [], bubbleLayer = document.createElement('div'); bubbleLayer.id = 'bubbles'; document.body.appendChild(bubbleLayer);
function spawnBubble() {
  if (!sim || bubbles.length >= 3) return;
  const cand = sim.agents().filter(a => !bubbles.some(b => b.a === a)).filter(a => { sim.headPos(a, tmpV).project(camera);
    return tmpV.z < 1 && Math.abs(tmpV.x) < 0.75 && tmpV.y > -0.45 && tmpV.y < 0.6 && camera.position.distanceTo(sim.headPos(a, new THREE.Vector3())) < 40; });
  if (!cand.length) return;
  const a = cand[Math.floor(Math.random() * cand.length)], el = document.createElement('div'); el.className = 'bubble'; el.textContent = sim.thought(a);
  el.onclick = () => showResident(a); bubbleLayer.appendChild(el); bubbles.push({ a, el, until: performance.now() + 5200 });
}
setInterval(spawnBubble, 2600);
function updateBubbles() {
  const now = performance.now();
  for (let k = bubbles.length - 1; k >= 0; k--) { const b = bubbles[k];
    if (now > b.until) { b.el.remove(); bubbles.splice(k, 1); continue; }
    sim.headPos(b.a, tmpV).project(camera); const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1 && Math.abs(tmpV.y) < 1;
    b.el.style.visibility = vis ? 'visible' : 'hidden'; b.el.style.opacity = Math.min(1, (b.until - now) / 500);
    if (vis) b.el.style.transform = `translate(${(tmpV.x + 1) / 2 * innerWidth}px, ${(1 - tmpV.y) / 2 * innerHeight}px) translate(-50%, -100%)`; }
}

function liveText() {
  const s = sim?.stats(); if (!s || s.pop == null) return '';
  const p = (n, a, b, c) => n + ' ' + plural(n, a, b, c);
  const parts = [];
  if (s.rest) parts.push(p(s.rest, 'житель отдыхает', 'жителя отдыхают', 'жителей отдыхают') + ' часок после работы');
  if (s.eat) parts.push(p(s.eat, 'житель ест', 'жителя едят', 'жителей едят'));
  if (s.carry) parts.push(p(s.carry, 'несёт', 'несут', 'несут') + (s.building ? ' брёвна на стройку' : ' брёвна к костру'));
  if (s.building && s.build) parts.push(`${p(s.build, 'строит', 'строят', 'строят')} дом ${s.building.owner} (${Math.round(s.building.p * 100)}%)`);
  if (s.wood) parts.push(p(s.wood, 'лесоруб рубит', 'лесоруба рубят', 'лесорубов рубят') + ` лес (${s.felled ? (s.trees === 1 ? 'дерево срублено' : `срублено ${s.felled} из ${s.trees}`) : (s.trees === 1 ? `дерево готово на ${Math.round(s.prog * 100)}%` : `${s.trees} ${plural(s.trees, 'дерево', 'дерева', 'деревьев')} готовы на ${Math.round(s.prog * 100)}%`)})`);
  if (s.fish) parts.push(p(s.fish, 'рыбак у реки', 'рыбака у реки', 'рыбаков у реки'));
  if (s.farm) parts.push(p(s.farm, 'работает', 'работают', 'работают') + ` в поле (${s.harvestIn > 0 ? 'урожай через ' + s.harvestIn + ' ' + plural(s.harvestIn, 'день', 'дня', 'дней') : 'сегодня сбор урожая'})`);
  if (s.craft) parts.push(p(s.craft, 'предприниматель работает', 'предпринимателя работают', 'предпринимателей работают') + ' в своих мастерских');
  if (s.life?.jobless && s.walk) parts.push(p(s.life.jobless, 'житель ищет', 'жителя ищут', 'жителей ищут') + ' работу');
  if (s.herd) parts.push('Гриша пасёт коров');
  if (s.cook) parts.push('Марфа печёт хлеб');
  if (s.herb) parts.push('Баба Нюра собирает травы');
  if (s.housesDone) parts.push(`своих домов: ${s.housesDone}`);
  if (s.animals) parts.push(p(s.animals, 'дикий зверь', 'диких зверя', 'диких зверей') + (s.animals % 10 === 1 && s.animals % 100 !== 11 ? ' бродит' : ' бродят') + ' в лесу');
  if (s.walk) parts.push(p(s.walk, 'гуляет', 'гуляют', 'гуляют') + ' по поселению');
  return parts.join(' · ') + ` · на карте ${s.shown} ${plural(s.shown, 'фигурка', 'фигурки', 'фигурок')} — каждый второй из ${s.pop} жителей`;
}
setInterval(() => { const el = document.getElementById('liveNow'); if (el) el.textContent = liveText(); }, 1500);

// ---------- цикл ----------
const clock = new THREE.Clock();
let lastDt = 0.016, lastT = 0;
let frameAcc = 0, perf = { n: 0, sum: 0, checked: 0 };
function loop(now) {
  requestAnimationFrame(loop);
  const t = clock.getElapsedTime(); if (t - lastT < 1 / QUALITY.fpsCap - 0.002) return;   // не чаще 30 кадров в секунду
  lastDt = t - lastT; lastT = t;
  // если кадры долгие — снижаем разрешение (один раз-два)
  if (t > 3) { perf.n++; perf.sum += lastDt; if (perf.n >= 60) { const avg = perf.sum / perf.n; perf.n = perf.sum = 0;
      if (avg > 0.045 && QUALITY.dpr > 0.75 && perf.checked < 3) { QUALITY.dpr = Math.max(0.75, QUALITY.dpr - 0.25); world.renderer.setPixelRatio(QUALITY.dpr); resize(); perf.checked++; } } }
  if (flight) { const k = Math.min(1, (performance.now() - flight.t0) / 1600), e = 1 - Math.pow(1 - k, 3);
    controls.target.lerpVectors(flight.fromT, flight.toT, e); camera.position.lerpVectors(flight.fromP, flight.toP, e); if (k >= 1) flight = null; }
  else if (!controls.autoRotate && performance.now() - world.idle() > 20000) controls.autoRotate = true;
  controls.update();
  // не даём уехать за край мира
  const tx = Math.min(45, Math.max(-45, controls.target.x)), tz = Math.min(35, Math.max(-60, controls.target.z));
  if (tx !== controls.target.x || tz !== controls.target.z) { camera.position.x += tx - controls.target.x; camera.position.z += tz - controls.target.z; controls.target.x = tx; controls.target.z = tz; }
  world.effects(t * 1.15);
  sim.update(lastDt, mskHour(), t);
  if (garland.visible) garland.children.forEach((b, i) => b.material.color.offsetHSL(0, 0, Math.sin(t * 4 + i) * 0.004));
  crisisSmoke.forEach((s, i) => { if (!s.visible) return; const ph = (t * 0.15 + i / crisisSmoke.length) % 1;
    s.position.set(world.CAMP.x - 6 + Math.sin(ph * 6 + i) * 0.8, 2 + ph * 14, world.CAMP.y - 4 - ph * 3); s.scale.setScalar(0.6 + ph * 2.5); s.material.opacity = 0.55 * (1 - ph); });
  world.renderer.render(world.scene, camera);
  updatePins(); updateBubbles();
  if (sim.housesChanged()) buildPins();
}

// ---------- старт ----------
D = await loadData();
buildWorld(); dayNight(); renderAlert(); showTab('now');
setInterval(tickTimer, 1000); setInterval(dayNight, 30000);
setInterval(async () => {
  try {
    const d = await loadData();
    if (JSON.stringify(d) === JSON.stringify(D)) return;
    if (JSON.stringify({ population: d.population, name: d.name || '', ...d.world, noCrowd: true, huts: hutsNeeded(d.population, housesDoneAt(mskHour(), taxRateOf(d))) }) !== worldKey) { location.reload(); return; }
    D = d; renderBar(); renderAlert(); buildPins(); if (tab) { const st = $('panel').scrollTop; const open = !$('panel').classList.contains('closed'); showTab(tab); $('panel').scrollTop = st; togglePanel(open); }
  } catch {}
}, 60000);
window.__cam = () => camera; window.__fly = (x, z, d) => { const T = new THREE.Vector3(x, 0.5, z); flight = { t0: performance.now(), fromP: camera.position.clone(), fromT: controls.target.clone(), toT: T, toP: T.clone().add(new THREE.Vector3(0.4, 0.75, 0.55).setLength(d)) }; }; window.__sim = () => sim;
window.__dbg = () => ({ t: controls.target.toArray().map(v => +v.toFixed(2)), p: camera.position.toArray().map(v => +v.toFixed(1)) });
loop();
$('loading').style.opacity = 0; setTimeout(() => $('loading').remove(), 700);
