// Жизнь жителей: опыт, уровни, должности, деньги, покупки, поиск работы.
// Всё считается по дням от основания государства — у всех зрителей одинаково.
//
// • Опыт: каждый рабочий день даёт опыт (талант у всех разный). 10 уровней на каждой должности,
//   10 должностей в профессии; последняя — своё производство. Чем выше должность — тем быстрее работа
//   и выше заработок, а значит больше брёвен, рыбы, урожая и налогов в казну.
// • Деньги: всё платно — хлеб (3 раза в день) и место в шалаше. Деньги дают только работа.
//   Без работы монеты кончаются — житель сам устраивается туда, где нужны руки.
//   Нет денег на хлеб — житель голодает, и работает хуже.

export const FOUND_DAY = Math.floor(Date.UTC(2026, 10, 8, 0, 0) / 864e5);   // 8 ноября 2026
export const WORK_FROM = 8, WORK_TO = 18;
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
export const BREAD = 2, BED = 1, MEALS = [7, 13.3, 19.5];   // хлеб — 2 монеты (3 раза в день), место в шалаше — 1 монета за ночь
const HIRE_BELOW = 10, CAP = { farm: 40, fish: 16 };

export const talentOf = i => 0.8 + hash(i + 41) * 0.45;
const needOf = r => 0.8 * Math.pow(1.35, r);            // дней опыта на один уровень: каждая следующая должность даётся на 35% дольше
export function levelOf(xp) {
  let r = 0, left = xp;
  while (r < 9 && left >= needOf(r) * 10) { left -= needOf(r) * 10; r++; }
  if (r === 9) return { rank: 9, lvl: 10, frac: 1, top: true };
  const lv = Math.min(9, Math.floor(left / needOf(r)));
  return { rank: r, lvl: lv + 1, frac: (left - lv * needOf(r)) / needOf(r), top: false, dayLeft: needOf(r) * (1 - (left - lv * needOf(r)) / needOf(r)) };
}
export const multOf = L => 1 + 0.12 * L.rank + 0.012 * (L.lvl - 1);   // скорость работы и заработок
export const titleOf = (role, L) => RANKS[role] ? RANKS[role][L.rank] + (L.top ? '' : ` · ${L.lvl} ур.`) : 'Без работы';
const workFracAt = h => clamp((h - WORK_FROM) / (WORK_TO - WORK_FROM), 0, 1);

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
export function createLife(spec, tax) {
  const n = spec.length, full = [];             // full[d] — состояние после полного дня d
  const init = () => ({ role: spec.map(s => s.role), xp: new Float64Array(n), coins: Float64Array.from(spec, s => 20 + Math.round(hash(s.i + 51) * 20)),
    earned: new Float64Array(n), hungry: new Uint8Array(n), hiredDay: new Int32Array(n).fill(-1), treasury: 0, logs: 0, fish: 0, grain: 0, hires: [], promos: [] });
  const clone = s => ({ ...s, role: s.role.slice(), xp: s.xp.slice(), coins: s.coins.slice(), earned: s.earned.slice(), hungry: s.hungry.slice(), hiredDay: s.hiredDay.slice(), hires: s.hires.slice(), promos: s.promos.slice() });
  // один день (или его часть до часа h)
  function step(s, d, h) {
    const f = workFracAt(h), meals = MEALS.filter(m => m <= h).length, night = h >= 22 ? 1 : 0;
    const cnt = { farm: 0, fish: 0 }; s.role.forEach(r => { if (r in cnt) cnt[r]++; });
    let bread = 0; s.hungry.fill(0);
    for (let k = 0; k < n; k++) {
      if (d < spec[k].join) continue;
      // утро: денег мало — идёт устраиваться на работу
      if (s.role[k] === 'walk' && s.coins[k] < HIRE_BELOW && h >= WORK_FROM - 0.5) {
        const r = cnt.farm < CAP.farm ? 'farm' : cnt.fish < CAP.fish ? 'fish' : 'farm'; s.role[k] = r; cnt[r]++; s.hiredDay[k] = d; s.hires.push({ d, k, r });
      }
      const r = s.role[k];
      if (r !== 'walk') {
        const L0 = levelOf(s.xp[k]), m = multOf(L0);
        for (let j = 0; j < meals; j++) if (s.coins[k] >= BREAD) { s.coins[k] -= BREAD; bread++; } else s.hungry[k] = 1;
        const pay = WAGE[r] * m * f, t = pay * tax; s.coins[k] += pay - t; s.earned[k] += pay - t; s.treasury += t;
        s.xp[k] += talentOf(spec[k].i) * f * (s.hungry[k] ? 0.6 : 1);
        const L1 = levelOf(s.xp[k]); if (L1.rank > L0.rank) s.promos.push({ d, k, rank: L1.rank });
        if (r === 'wood') s.logs += 4 * m * f; else if (r === 'fish') s.fish += 4 * m * f; else if (r === 'farm') s.grain += 1.5 * m * f;
      } else for (let j = 0; j < meals; j++) if (s.coins[k] >= BREAD) { s.coins[k] -= BREAD; bread++; } else s.hungry[k] = 1;
      if (night) { const b = Math.min(BED, s.coins[k]); s.coins[k] -= b; s.treasury += b; }
    }
    const ck = spec.findIndex((x, k) => s.role[k] === 'cook');   // хлеб покупают у пекаря: 10% цены — её доход сверх зарплаты (остальное — мука и дрова)
    if (ck >= 0) { s.coins[ck] += bread * BREAD * 0.1; s.earned[ck] += bread * BREAD * 0.1; }
  }
  return function at(day, hour) {
    if (day < 0) return init();
    while (full.length < day) { const s = clone(full.length ? full[full.length - 1] : init()); step(s, full.length, 24); full.push(s); }
    const s = clone(day > 0 ? full[day - 1] : init()); step(s, day, hour); return s;
  };
}
