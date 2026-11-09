// Жизнь жителей: опыт, уровни, должности, деньги, покупки, поиск работы.
// Всё считается по дням от основания государства — у всех зрителей одинаково.
//
// • Опыт: каждый рабочий день даёт опыт (талант у всех разный). 10 уровней на каждой должности,
//   10 должностей в профессии; последняя — своё производство. Чем выше должность — тем быстрее работа
//   и выше заработок, а значит больше брёвен, рыбы, урожая и налогов в казну.
// • Деньги: всё платно — хлеб (3 раза в день) и место в шалаше (1 монета в день). Деньги дают только работа.
//   Без работы монеты кончаются — житель сам устраивается туда, где нужны руки.
//   Нет денег на хлеб — житель голодает, и работает хуже.

export const FOUND_DAY = Math.floor(Date.UTC(2026, 10, 8, 0, 0) / 864e5);   // 8 ноября 2026
export const MORNING = 7.5;   // ночи нет: работа идёт весь день (с перерывами на еду и отдых), утром — найм и новые дела
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

export const RANKS = {
  wood: ['Лесоруб', 'Мастер-лесоруб', 'Бригадир лесорубов', 'Старший бригадир', 'Десятник лесорубов', 'Лесничий', 'Старший лесничий', 'Главный лесничий', 'Управляющий лесным делом', 'Владелец лесопилки'],
  fish: ['Рыбак', 'Мастер-рыбак', 'Старшина артели', 'Бригадир рыбаков', 'Десятник артели', 'Кормчий', 'Старший кормчий', 'Глава артели', 'Управляющий промыслом', 'Владелец рыбного промысла'],
  farm: ['Земледелец', 'Мастер-земледелец', 'Бригадир поля', 'Старший бригадир поля', 'Десятник полей', 'Агроном', 'Старший агроном', 'Главный агроном', 'Управляющий угодьями', 'Владелец фермы'],
  build: ['Плотник', 'Мастер-плотник', 'Бригадир плотников', 'Старший бригадир', 'Десятник стройки', 'Зодчий', 'Старший зодчий', 'Главный зодчий', 'Управляющий стройкой', 'Владелец строительной артели'],
  cook: ['Пекарь', 'Мастер-пекарь', 'Старший пекарь', 'Хлебница', 'Старшая хлебница', 'Кондитер', 'Старший кондитер', 'Главный пекарь', 'Управляющая хлебной лавкой', 'Владелица пекарни'],
  herbal: ['Травница', 'Мастер-травница', 'Знахарка', 'Старшая знахарка', 'Лекарка', 'Целительница', 'Старшая целительница', 'Главная целительница', 'Управляющая аптекой', 'Владелица лекарни'],
  herd: ['Скотовод', 'Мастер-скотовод', 'Старший пастух', 'Бригадир пастухов', 'Десятник скотного двора', 'Животновод', 'Старший животновод', 'Главный животновод', 'Управляющий фермой', 'Владелец молочной фермы'],
  elder: ['Староста', 'Опытный староста', 'Старший староста', 'Глава общины', 'Голова поселения', 'Советник', 'Старший советник', 'Первый советник', 'Наместник', 'Основатель рода'],
};
export const PLACE = { wood: 'на лесоповал', fish: 'в рыбацкую артель', farm: 'в поле', build: 'на стройку', cook: 'в пекарню', herbal: 'к травнице', herd: 'на скотный двор', elder: 'в управу' };
const WAGE = { wood: 12, build: 12, fish: 10, farm: 9, cook: 8, herbal: 9, herd: 10, elder: 11 };   // монет за полный рабочий день
export const BREAD = 2, BED = 1, MEALS = [7, 13.3, 19.5];   // хлеб — 2 монеты (3 раза в день), место в шалаше — 1 монета в день
const HIRE_BELOW = 10, CAP = { farm: 40, fish: 16 };

// ---------- характер: у каждого свой, и он меняет жизнь ----------
export const TRAITS = {
  hard:     { m: 'Трудяга', f: 'Трудяга', about: 'дольше всех работает до перерыва и быстрее набирается опыта', talent: 1.15, work: 1.5 },
  lazy:     { m: 'Лентяй', f: 'Лентяйка', about: 'быстро устаёт, часто отдыхает и медленнее растёт', talent: 0.85, work: -1.2 },
  sly:      { m: 'Хитрец', f: 'Хитрюга', about: 'платит налог не полностью — утаивает половину', taxK: 0.5 },
  kind:     { m: 'Добряк', f: 'Добрячка', about: 'делится едой с теми, кому не хватило', gift: true },
  generous: { m: 'Щедрый', f: 'Щедрая', about: 'любит покупать в мастерских и угощает голодных', buyK: 1.6, gift: true },
  stingy:   { m: 'Скряга', f: 'Скряга', about: 'тратит в мастерских вдвое меньше — копит на своё дело', buyK: 0.5 },
  grump:    { m: 'Ворчун', f: 'Ворчунья', about: 'всем недоволен, но работает честно' },
  merry:    { m: 'Весельчак', f: 'Хохотушка', about: 'шутит и поднимает настроение соседям' },
  dreamer:  { m: 'Мечтатель', f: 'Мечтательница', about: 'мечтает о своём деле и первым берётся за новое', bizFirst: true },
  rebel:    { m: 'Бунтарь', f: 'Бунтарка', about: 'спорит с законами Думы и любит свободу' },
};
const TRAIT_KEYS = Object.keys(TRAITS), NAMED_TRAIT = ['kind', 'hard', 'merry', 'generous', 'sly', 'grump'];   // Гриша, Пахом, Тимоша, Марфа, Аркадий, Баба Нюра
// Подписчик, создавший жителя, сам выбирает до двух характеров (data.json → residents[].traits). Несовместимые не сочетаются.
export const CONFLICT = { hard: 'lazy', lazy: 'hard', generous: 'stingy', stingy: 'generous' };
export const pickTraits = list => { const out = []; for (const k of list || []) { if (!TRAITS[k] || out.includes(k) || out.some(o => CONFLICT[o] === k)) continue; out.push(k); if (out.length === 2) break; } return out; };
let OVER = new Map();
export const setTraitOverrides = obj => { OVER = new Map(Object.entries(obj || {}).map(([i, t]) => [+i, pickTraits(t)]).filter(([, t]) => t.length)); };
const baseTrait = i => i < 6 ? NAMED_TRAIT[i] : TRAIT_KEYS[Math.floor(hash(i + 61) * TRAIT_KEYS.length)];
export const traitsOf = i => OVER.get(i) || [baseTrait(i)];
export const traitOf = i => traitsOf(i)[0];
export const traitName = (i, fem) => traitsOf(i).map((k, j) => j ? TRAITS[k][fem ? 'f' : 'm'].toLowerCase() : TRAITS[k][fem ? 'f' : 'm']).join(' и ');
export const traitFx = i => { const L = traitsOf(i).map(k => TRAITS[k]);   // общее действие характеров на жизнь
  return { talent: L.reduce((p, t) => p * (t.talent || 1), 1), work: L.reduce((q, t) => q + (t.work || 0), 0), taxK: L.reduce((p, t) => p * (t.taxK ?? 1), 1), buyK: L.reduce((p, t) => p * (t.buyK || 1), 1),
    gift: L.some(t => t.gift), bizFirst: L.some(t => t.bizFirst), sly: traitsOf(i).includes('sly') }; };
export const talentOf = i => (0.8 + hash(i + 41) * 0.45) * traitFx(i).talent;
const needOf = r => 0.8 * Math.pow(1.35, r);            // дней опыта на один уровень: каждая следующая должность даётся на 35% дольше
export function levelOf(xp) {
  let r = 0, left = xp;
  while (r < 9 && left >= needOf(r) * 10) { left -= needOf(r) * 10; r++; }
  if (r === 9) return { rank: 9, lvl: 10, frac: 1, top: true };
  const lv = Math.min(9, Math.floor(left / needOf(r)));
  return { rank: r, lvl: lv + 1, frac: (left - lv * needOf(r)) / needOf(r), top: false, dayLeft: needOf(r) * (1 - (left - lv * needOf(r)) / needOf(r)) };
}
export const multOf = L => 1 + 0.12 * L.rank + 0.012 * (L.lvl - 1);   // скорость работы
export const payMultOf = L => 1 + 0.3 * L.rank + 0.02 * (L.lvl - 1);   // зарплата: каждая должность +30%, каждый уровень +2%
export const PAYDAY = 18;                                               // зарплата выдаётся раз в день — в конце рабочего дня

// ---------- новые профессии: начинающие предприниматели открывают своё дело, когда на него появляется спрос ----------
const L10 = (a, b, c, d, e, f, g, h, i, j) => [a, b, c, d, e, f, g, h, i, j];
export const BIZ = {
  potter: { name: 'гончар', shop: 'Гончарная', why: 'в новых домах нужна посуда', when: t => t.houses >= 1, needs: 'будет построен первый дом', color: '#c0704a',
    ranks: L10('Начинающий гончар', 'Гончар', 'Мастер-гончар', 'Хозяин гончарной', 'Гончар с подмастерьями', 'Хозяин двух гончарных', 'Мастер посуды', 'Главный мастер посуды', 'Хозяин гончарного двора', 'Владелец посудного завода') },
  tailor: { name: 'портной', shop: 'Швейная', why: 'одежда износилась — нужна новая', when: t => t.day >= 4, needs: 'пройдёт 4 дня', color: '#8a5fb0',
    ranks: L10('Начинающий портной', 'Портной', 'Мастер-портной', 'Хозяин швейной', 'Портной с подмастерьями', 'Хозяин двух швейных', 'Закройщик', 'Главный закройщик', 'Хозяин швейного двора', 'Владелец швейной фабрики') },
  smith: { name: 'кузнец', shop: 'Кузница', why: 'у работников тупятся топоры и мотыги', when: t => t.workers >= 30, needs: 'в государстве будет 30 работников', color: '#55504a',
    ranks: L10('Начинающий кузнец', 'Кузнец', 'Мастер-кузнец', 'Хозяин кузницы', 'Кузнец с подмастерьями', 'Хозяин двух кузниц', 'Оружейник', 'Главный оружейник', 'Хозяин кузнечного двора', 'Владелец кузнечного завода') },
  mill: { name: 'мельник', shop: 'Мельница', why: 'зерна так много, что его пора молоть', when: t => t.grain >= 150, needs: 'накопится 150 мер зерна', color: '#d9b25a',
    ranks: L10('Начинающий мельник', 'Мельник', 'Мастер-мельник', 'Хозяин мельницы', 'Мельник с работниками', 'Хозяин двух мельниц', 'Мукомол', 'Главный мукомол', 'Хозяин мукомольни', 'Владелец мукомольного завода') },
  smoke: { name: 'коптильщик', shop: 'Коптильня', why: 'рыбы больше, чем успевают съесть', when: t => t.fish >= 250, needs: 'поймают 250 рыб', color: '#7a4a2a',
    ranks: L10('Начинающий коптильщик', 'Коптильщик', 'Мастер-коптильщик', 'Хозяин коптильни', 'Коптильщик с работниками', 'Хозяин двух коптилен', 'Рыботорговец', 'Старший рыботорговец', 'Хозяин рыбного двора', 'Владелец рыбного завода') },
  joiner: { name: 'столяр', shop: 'Столярная', why: 'в новые дома нужна мебель', when: t => t.houses >= 3, needs: 'построят 3 дома', color: '#a0703a',
    ranks: L10('Начинающий столяр', 'Столяр', 'Мастер-столяр', 'Хозяин столярной', 'Столяр с подмастерьями', 'Хозяин двух столярных', 'Мебельщик', 'Главный мебельщик', 'Хозяин мебельного двора', 'Владелец мебельной фабрики') },
  cobbler: { name: 'сапожник', shop: 'Сапожная', why: 'лапти стоптались — нужна обувь', when: t => t.day >= 9, needs: 'пройдёт 9 дней', color: '#6a4a3a',
    ranks: L10('Начинающий сапожник', 'Сапожник', 'Мастер-сапожник', 'Хозяин сапожной', 'Сапожник с подмастерьями', 'Хозяин двух сапожных', 'Обувщик', 'Главный обувщик', 'Хозяин обувного двора', 'Владелец обувной фабрики') },
  trader: { name: 'торговец', shop: 'Лавка', why: 'у жителей появились сбережения — им есть что купить', when: t => t.savings >= 3000, needs: 'у жителей накопится 3000 монет', color: '#2f7a3a',
    ranks: L10('Начинающий торговец', 'Лавочник', 'Опытный лавочник', 'Хозяин лавки', 'Торговец с приказчиками', 'Хозяин двух лавок', 'Купец', 'Купец второй гильдии', 'Купец первой гильдии', 'Владелец торгового дома') },
  kvass: { name: 'квасовар', shop: 'Квасная', why: 'зерна в избытке — можно варить квас', when: t => t.grain >= 600, needs: 'накопится 600 мер зерна', color: '#b5802a',
    ranks: L10('Начинающий квасовар', 'Квасовар', 'Мастер-квасовар', 'Хозяин квасной', 'Квасовар с работниками', 'Хозяин двух квасных', 'Пивовар', 'Главный пивовар', 'Хозяин пивоварни', 'Владелец пивоваренного завода') },
};
// Чтобы открыть новое дело, нужно ПОСТРОИТЬ подходящее здание. Строит предприниматель из брёвен, которые покупает у лесорубов за свои деньги
// (брёвна берутся из общего запаса — тот же, из которого строятся дома). Пока строит — не работает и не получает зарплату.
export const LOG_PRICE = 6, RESERVE = 15;     // цена бревна, монет; сколько монет должно остаться на хлеб после покупки
export const BUILD = {   // сколько брёвен и рабочих дней нужно на здание
  potter: { logs: 4, days: 2, what: 'гончарную мастерскую с печью для обжига' }, tailor: { logs: 4, days: 2, what: 'швейную мастерскую с большими окнами' },
  smith: { logs: 6, days: 3, what: 'кузницу с горном и наковальней' }, mill: { logs: 8, days: 3, what: 'мельницу с крыльями-парусами' },
  smoke: { logs: 5, days: 2, what: 'коптильню с высокой трубой' }, joiner: { logs: 6, days: 2, what: 'столярную с навесом для досок' },
  cobbler: { logs: 4, days: 2, what: 'сапожную мастерскую' }, trader: { logs: 6, days: 3, what: 'торговую лавку с прилавком' },
  kvass: { logs: 5, days: 2, what: 'квасную с бочками' },
};
export const MAX_SHOPS = 16;     // столько зданий дел помещается на ярмарочной площади
export const buildCost = key => BUILD[key].logs * LOG_PRICE;

// ---------- желаемая профессия подписчика ----------
// Рыбак и земледелец — сразу работа. Готовые дела (гончар, кузнец…) — путь: работа → копит монеты → ждёт спроса → строит здание.
// Любая другая профессия — «своя»: житель строит мастерскую под это название (по одной на жителя).
const WISH = [[/рыбак|рыбач|рыболов/, 'fish'], [/земледел|фермер|крестьян|агроном|пахар|огородник|хлебороб/, 'farm'], [/гонч|керамик|посуд/, 'potter'],
  [/портн|швея|швей|одежд|модельер/, 'tailor'], [/кузнец|кузн|оружейн|слесар/, 'smith'], [/мельник|мельниц|мукомол/, 'mill'], [/коптил|копчен|рыботорг/, 'smoke'],
  [/столяр|мебел|краснодерев/, 'joiner'], [/сапожн|обув/, 'cobbler'], [/торгов|купец|лавоч|продав|предпринимат|бизнесмен/, 'trader'], [/квас|пивовар/, 'kvass']];
export const cleanWish = text => { const w = String(text || '').trim().replace(/\s+/g, ' '); return /^[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9 \-]{1,23}$/.test(w) ? w[0].toUpperCase() + w.slice(1) : null; };
export function describeWish(text) {
  const w = cleanWish(text); if (!w) return null;
  const low = w.toLowerCase().replace(/ё/g, 'е'), hit = WISH.find(([re]) => re.test(low));
  if (hit) return hit[1] === 'fish' || hit[1] === 'farm' ? { wish: w, key: hit[1], kind: 'job' } : { wish: w, key: hit[1], kind: 'known', price: buildCost(hit[1]), need: BIZ[hit[1]].needs, what: BUILD[hit[1]].what };
  return { wish: w, key: null, kind: 'custom', price: 5 * LOG_PRICE, need: 'пройдёт не меньше 6 дней', what: `мастерскую «${w}»` };
}
const CUSTOM_COLORS = ['#c0704a', '#8a5fb0', '#2f7a9a', '#b5802a', '#7a8a3a', '#a05050', '#4f7a5a', '#d08a3a'];
const customRanks = x => ['новичок', 'ученик', 'подмастерье', 'мастер', 'старший мастер', 'главный мастер', 'глава мастерской', 'глава двух мастерских', 'управляющий делом', 'владелец производства'].map(r => `${x} · ${r}`);
const GOALS = new Map(), CUSTOM = new Set();
// map: номер жителя на карте → желаемая профессия (текст). Вызывается при запуске мира.
export function setGoals(map) {
  for (const k of CUSTOM) { delete BIZ[k]; delete BUILD[k]; } CUSTOM.clear(); GOALS.clear();
  for (const [i, text] of Object.entries(map || {})) { const g = describeWish(text); if (!g) continue; const idx = +i;
    if (g.kind === 'known' && [...GOALS.values()].some(o => o.key === g.key)) { g.kind = 'custom'; g.key = null; }   // готовое дело одно: следующий желающий строит личную мастерскую
    if (g.kind === 'custom') { const key = 'u' + idx; g.key = key; CUSTOM.add(key);
      BIZ[key] = { name: g.wish.toLowerCase(), shop: `Мастерская «${g.wish}»`, why: 'это мечта хозяина', when: t => t.day >= 6, needs: 'пройдёт не меньше 6 дней', color: CUSTOM_COLORS[idx % CUSTOM_COLORS.length], ranks: customRanks(g.wish), only: idx, custom: true };
      BUILD[key] = { logs: 5, days: 2, what: `мастерскую «${g.wish}»` }; }
    GOALS.set(idx, g); }
}
export const goalOf = i => GOALS.get(i) || null;
// Лекарь (Баба Нюра) здания не строит: ходит к больным и лечит дома. Государство может построить лечебницу — тогда лечит там и принимает больше людей.
const P_SICK = 0.04, HEAL_FEE = 3, HEAL_CAP = 5, CLINIC_CAP = 20;
const BUY = 0.4, BUY_FROM = 15;    // кто богаче 15 монет, тратит в среднем 0,4 монеты в день в каждой мастерской
export const ladder = role => RANKS[role] || BIZ[role]?.ranks || null;
export const titleOf = (role, L) => ladder(role) ? ladder(role)[L.rank] + (L.top ? '' : ` · ${L.lvl} ур.`) : 'Без работы';
export const workFracAt = h => clamp(h / 24, 0, 1);   // доля прошедшего дня: опыт и добыча копятся круглые сутки

// Лесорубы известны заранее (Тимоша — №3 и житель №7), поэтому брёвна можно посчитать без всей симуляции
export const WOODCUTTERS = [2, 6];
export function logsUntil(day, hour) {
  let xp = WOODCUTTERS.map(() => 0), logs = 0;
  for (let d = 0; d <= day; d++) {
    const f = d < day ? 1 : workFracAt(hour);
    WOODCUTTERS.forEach((i, k) => { logs += 4 * multOf(levelOf(xp[k])) * f; xp[k] += talentOf(i) * f; });
  }
  return logs;
}

// spec: [{ i, role, join }] — role: стартовая работа ('walk' — без работы), join — день прихода в государство
export function createLife(spec, tax, houseCost, clinicFrom = Infinity) {
  const n = spec.length, FX = spec.map(s => traitFx(s.i));       // история считается один раз и продвигается день за днём на месте (без копий всего журнала)
  const init = () => ({ role: spec.map(s => s.role), xp: new Float64Array(n), coins: Float64Array.from(spec, s => 20 + Math.round(hash(s.i + 51) * 20)),
    earned: new Float64Array(n), pay: new Float64Array(n), hungry: new Uint8Array(n), hiredDay: new Int32Array(n).fill(-1), paid: 0,
    bk: new Uint8Array(n), sick: new Uint8Array(n), shopLogs: 0, sickToday: 0, healedToday: 0, treasury: 0, logs: 0, fish: 0, grain: 0, houses: 0, hires: [], promos: [], biz: [], log: [] });
  const clone = s => ({ ...s, role: s.role.slice(), xp: s.xp.slice(), coins: s.coins.slice(), earned: s.earned.slice(), pay: s.pay.slice(), hungry: s.hungry.slice(),
    hiredDay: s.hiredDay.slice(), bk: s.bk.slice(), sick: s.sick.slice(), hires: s.hires.slice(), promos: s.promos.slice(), biz: s.biz.map(b => ({ ...b })), log: [] });   // журнал копии — только новые события дня
  const free = r => r === 'walk' || r === 'farm' || r === 'fish';   // кто может уйти в своё дело (лесорубы, плотники и именные жители — на своих местах)
  // один день (или его часть до часа h)
  function step(s, d, h) {
    const f = workFracAt(h), meals = MEALS.filter(m => m <= h).length, rent = h >= 22 ? 1 : 0, payday = h >= PAYDAY;
    const cnt = { farm: 0, fish: 0 }; s.role.forEach(r => { if (r in cnt) cnt[r]++; });
    const logs0 = s.logs; let bread = 0; s.hungry.fill(0); s.pay.fill(0); s.paid = payday ? 1 : 0;
    s.sick.fill(0);
    if (h >= MORNING) {
      // 1) построенное здание готово — хозяин открывает дело
      for (const b of s.biz) if (b.state === 'build' && d >= b.ready) { b.state = 'open'; s.role[b.k] = b.key; s.xp[b.k] = 0; s.bk[b.k] = 0; s.log.push({ d, h: MORNING, t: 'biz', k: b.k, key: b.key }); }
      // 2) появился спрос — самый богатый из простых работников покупает брёвна и начинает стройку (одна стройка за раз)
      const t = { day: d, grain: s.grain, fish: s.fish, houses: s.houses, workers: s.role.filter((r, k) => r !== 'walk' && d >= spec[k].join).length, savings: s.coins.reduce((a, b) => a + b, 0) };
      s.demand = t;     // что сейчас происходит в государстве — по этому условию дела открываются (и показываются в «пути к мечте»)
      if (s.biz.length < Math.min(MAX_SHOPS, Object.keys(BIZ).length) && !s.biz.some(b => b.state === 'build')) {   // все дела уже есть — спрос не проверяем
        const stock = s.logs * (1 - tax) - s.shopLogs - s.houses * houseCost;     // свободные брёвна на складе (после домов и прошлых строек)
        const score = k => s.coins[k] * (FX[k].bizFirst ? 2 : 1);   // мечтатели берутся за новое дело первыми
        for (const key of Object.keys(BIZ)) {
          if (s.biz.some(x => x.key === key) || !BIZ[key].when(t) || stock < BUILD[key].logs) continue;
          const price = buildCost(key), only = BIZ[key].only; let best = -1;
          const ok = k => d >= spec[k].join && free(s.role[k]) && !s.bk[k] && s.coins[k] >= price + RESERVE && (only == null || spec[k].i === only) && (!goalOf(spec[k].i) || goalOf(spec[k].i).key === key);   // у кого своя мечта — тот строит только её   // личное дело открывает только его хозяин
          const dreamers = []; for (let k = 0; k < n; k++) if (goalOf(spec[k].i)?.key === key && d >= spec[k].join) dreamers.push(k);
          if (only == null && dreamers.length) {        // у дела есть «хозяин мечты»: даём ему месяц накопить, потом дело может открыть любой желающий
            const mine = dreamers.filter(ok); if (mine.length) best = mine.reduce((a, b) => score(a) >= score(b) ? a : b); else if (dreamers.some(k => d < spec[k].join + 30)) continue; }
          if (best < 0) for (let k = 0; k < n; k++) if (ok(k) && (best < 0 || score(k) > score(best))) best = k;
          if (best < 0) continue;
          s.coins[best] -= price; s.shopLogs += BUILD[key].logs; s.bk[best] = 1;
          const sellers = WOODCUTTERS.filter(i => i < n); sellers.forEach(i => { s.coins[i] += price / sellers.length; s.earned[i] += price / sellers.length; });   // деньги получают лесорубы
          s.biz.push({ key, k: best, d, ready: d + BUILD[key].days, state: 'build', was: s.role[best], mats: BUILD[key].logs, paid: price, p: 0 });
          s.log.push({ d, h: MORNING, t: 'mats', k: best, key, n: BUILD[key].logs, price }); break;
        }
      }
      // 3) болезни: у кого-то случается простуда; лекарь успевает не ко всем (5 в день, с лечебницей — 20)
      const hk = s.role.indexOf('herbal'), cap = hk < 0 ? 0 : d >= clinicFrom ? CLINIC_CAP : HEAL_CAP; let treated = 0, ill = 0;
      for (let k = 0; k < n; k++) if (d >= spec[k].join && k !== hk && hash(k * 131 + d * 17 + 7) < P_SICK) {
        ill++; if (treated < cap) { treated++; s.sick[k] = 2; const fee = Math.min(HEAL_FEE, s.coins[k]); s.coins[k] -= fee; s.coins[hk] += fee; s.earned[hk] += fee;
          if (treated <= 2) s.log.push({ d, h: MORNING + 0.5 + treated, t: 'heal', k: hk, to: k, clinic: d >= clinicFrom }); } else s.sick[k] = 1; }
      s.sickToday = ill; s.healedToday = treated;
    }
    for (const b of s.biz) b.p = b.state === 'open' ? 1 : Math.min(0.99, ((d - b.d) + clamp((h - MORNING) / (24 - MORNING), 0, 1)) / BUILD[b.key].days);
    for (let k = 0; k < n; k++) {
      if (d < spec[k].join) continue;
      if (d === spec[k].join && spec[k].wish && h >= MORNING) s.log.push({ d, h: MORNING, t: 'oath', k });   // присяга: житель пришёл с мечтой о профессии
      // утро: денег мало — идёт устраиваться на работу
      if (s.role[k] === 'walk' && s.coins[k] < HIRE_BELOW && h >= MORNING) {
        const r = cnt.farm < CAP.farm ? 'farm' : cnt.fish < CAP.fish ? 'fish' : 'farm'; s.role[k] = r; cnt[r]++; s.hiredDay[k] = d; s.hires.push({ d, k, r }); s.log.push({ d, h: MORNING + (k % 7) * 0.05, t: 'hire', k, r });
      }
      for (let j = 0; j < meals; j++) if (s.coins[k] >= BREAD) { s.coins[k] -= BREAD; bread++; } else s.hungry[k] = 1;
      const r = s.role[k], wk = s.bk[k] ? 0 : s.sick[k] === 1 ? 0 : s.sick[k] === 2 ? 0.5 : 1;   // стройка и болезнь отнимают рабочее время
      if (r !== 'walk') {
        const L0 = levelOf(s.xp[k]), m = multOf(L0) * wk;
        if (payday && WAGE[r] && wk) { const pay = WAGE[r] * payMultOf(L0) * wk, t = pay * tax * FX[k].taxK; s.coins[k] += pay - t; s.earned[k] += pay - t; s.pay[k] = pay - t; s.treasury += t; }
        const gain = talentOf(spec[k].i) * f * wk * (s.hungry[k] ? 0.6 : 1), x0 = s.xp[k]; s.xp[k] += gain;
        const L1 = levelOf(s.xp[k]); if (L1.rank > L0.rank) { let lo = 0, hi = 1; for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; if (levelOf(x0 + gain * mid).rank > L0.rank) hi = mid; else lo = mid; }
          s.promos.push({ d, k, rank: L1.rank }); s.log.push({ d, h: Math.round(hi * h * 100) / 100, t: 'promo', k, role: r, rank: L1.rank }); }   // опыт копится равномерно с 0:00 до h — значит, повышение было в hi·h часов
        if (r === 'wood') s.logs += 4 * m * f; else if (r === 'fish') s.fish += 4 * m * f; else if (r === 'farm') s.grain += 1.5 * m * f;
      }
    }
    // вечером жители покупают товары в мастерских — это и есть доход предпринимателей
    if (payday && s.biz.length) for (const b of s.biz) { if (b.state !== 'open') continue;
      let sum = 0; const q = 1 + 0.1 * levelOf(s.xp[b.k]).rank;   // чем опытнее хозяин, тем лучше товар и тем больше покупают
      for (let k = 0; k < n; k++) if (k !== b.k && d >= spec[k].join && s.coins[k] >= BUY_FROM) { const x = BUY * q * FX[k].buyK; s.coins[k] -= x; sum += x; }
      const t = sum * tax; s.coins[b.k] += sum - t; s.earned[b.k] += sum - t; s.pay[b.k] = sum - t; s.treasury += t; b.sold = Math.round(sum / 2);
    }
    // за ужином добряки и щедрые угощают тех, кому сегодня не хватило на хлеб
    if (h >= 19.5) { const hungry = []; for (let k = 0; k < n; k++) if (s.hungry[k] && d >= spec[k].join) hungry.push(k);
      for (let k = 0; k < n && hungry.length; k++) if (FX[k].gift && d >= spec[k].join && s.coins[k] >= 40) { const to = hungry.shift(); s.coins[k] -= 6; s.coins[to] += 6; s.log.push({ d, h: 19.5, t: 'gift', k, to }); } }
    if (tax && payday && d % 4 === 2) for (let k = 0; k < n; k++) if (FX[k].sly && s.role[k] !== 'walk' && d >= spec[k].join) { s.log.push({ d, h: PAYDAY, t: 'sly', k }); break; }
    if ((d + 1) % 6 === 0 && h >= 12) s.log.push({ d, h: 12, t: 'harvest', grain: Math.round(s.grain) });
    { const nh = Math.floor((s.logs * (1 - tax) - s.shopLogs) / houseCost); while (s.houses < nh) { s.houses++; const need = (s.houses * houseCost + s.shopLogs) / (1 - tax); s.log.push({ d, h: Math.round(h * clamp((need - logs0) / Math.max(1e-6, s.logs - logs0), 0, 1) * 100) / 100, t: 'house', n: s.houses }); } }
    if (rent) for (let k = 0; k < n; k++) if (d >= spec[k].join) { const b = Math.min(BED, s.coins[k]); s.coins[k] -= b; s.treasury += b; }
    const ck = s.role.indexOf('cook');   // хлеб покупают у пекаря: 10% цены — её доход сверх зарплаты (остальное — мука и дрова)
    if (ck >= 0 && payday) { s.coins[ck] += bread * BREAD * 0.1; s.earned[ck] += bread * BREAD * 0.1; s.pay[ck] += bread * BREAD * 0.1; }
  }
  let chain = null, chainDay = 0;    // состояние на начало дня chainDay (все прошлые дни уже посчитаны)
  return function at(day, hour) {
    if (day < 0) return init();
    if (!chain || day < chainDay) { chain = init(); chainDay = 0; }
    while (chainDay < day) { step(chain, chainDay, 24); chainDay++; }
    const s = clone(chain); step(s, day, hour); s.log = chain.log.concat(s.log); return s;   // сегодняшний день считается на копии; журнал = прошлое + новое
  };
}

// ожидаемая зарплата за полный день (для карточки жителя)
export const wageOf = (role, L, tax) => WAGE[role] ? Math.round(WAGE[role] * payMultOf(L) * (1 - tax)) : null;

// ---------- имена и фамилии жителей (у каждого свои, одинаковые у всех зрителей) ----------
const M_NAMES = ['Иван', 'Пётр', 'Степан', 'Фёдор', 'Василий', 'Егор', 'Семён', 'Матвей', 'Тихон', 'Никита', 'Захар', 'Прохор', 'Яков', 'Демьян', 'Игнат', 'Кузьма', 'Савелий', 'Ефим', 'Лука', 'Фома',
  'Илья', 'Андрей', 'Алексей', 'Григорий', 'Тимофей', 'Филипп', 'Остап', 'Мирон', 'Назар', 'Родион', 'Платон', 'Гордей', 'Ермолай', 'Макар', 'Антип', 'Добрыня', 'Елисей', 'Архип', 'Федот', 'Вавила'];
const F_NAMES = ['Анна', 'Мария', 'Дарья', 'Ольга', 'Аксинья', 'Пелагея', 'Василиса', 'Фёкла', 'Агафья', 'Прасковья', 'Ульяна', 'Евдокия', 'Глафира', 'Варвара', 'Настасья', 'Любава', 'Милана', 'Зоя', 'Лукерья', 'Матрёна',
  'Софья', 'Алёна', 'Арина', 'Ксения', 'Таисия', 'Устинья', 'Серафима', 'Олеся', 'Марфута', 'Дуняша', 'Злата', 'Ярослава', 'Василина', 'Мелания', 'Есения', 'Агния', 'Добрава', 'Забава', 'Полина', 'Вера'];
const SURNAMES = ['Кузнецов', 'Мельников', 'Рыбаков', 'Плотников', 'Бондарев', 'Гончаров', 'Пахомов', 'Сидоров', 'Ковалёв', 'Ершов', 'Лапин', 'Зайцев', 'Медведев', 'Соколов', 'Воронин', 'Галкин', 'Сорокин',
  'Белов', 'Чернов', 'Рыжов', 'Лесников', 'Полев', 'Ручьёв', 'Берёзин', 'Дубов', 'Клёнов', 'Осинин', 'Ивушкин', 'Пчёлкин', 'Мёдов', 'Калачёв', 'Пирогов', 'Блинов', 'Кашин', 'Щукин', 'Карасёв', 'Окунев',
  'Ладушкин', 'Тетерин', 'Глухарёв', 'Снегирёв', 'Скворцов', 'Журавлёв', 'Лебедев', 'Гусев', 'Уткин', 'Морозов', 'Метелин', 'Вешнев', 'Солнцев'];
const genFirst = (n, fem) => { const l = n.at(-1), p = n.at(-2);
  if (l === 'а') return n.slice(0, -1) + ('гкхжшчщ'.includes(p) ? 'и' : 'ы');
  if (l === 'я') return n.slice(0, -1) + 'и';
  if (fem) return n;
  if (l === 'й') return n.slice(0, -1) + 'я';
  if (l === 'ь') return n.slice(0, -1) + 'я';
  return n + 'а'; };
export function personName(i, fem) {
  const first = (fem ? F_NAMES : M_NAMES)[(i * 7 + 3) % 40], sur = SURNAMES[(i * 11 + 5) % SURNAMES.length];
  const surF = sur + 'а', name = `${first} ${fem ? surF : sur}`;
  const gen = `${genFirst(first, fem)} ${fem ? surF.slice(0, -1) + 'ой' : sur + 'а'}`;
  const accFirst = first.endsWith('я') ? first.slice(0, -1) + 'ю' : first.endsWith('а') ? first.slice(0, -1) + 'у' : genFirst(first, fem);   // Никита → Никиту, Илья → Илью, Иван → Ивана
  const acc = `${accFirst} ${fem ? surF.slice(0, -1) + 'у' : sur + 'а'}`;      // винительный: «угостил Пелагею Полеву», «угостил Никиту Плотникова»
  return { name, gen, acc, short: first };
}
