// Присяги подписчиков → жители. Одни и те же правила здесь (сайт, мгновенно) и в scripts/merge_residents.py (закрепление в data.json):
// ник уникален; характеров до двух, без несовместимых; профессия 2–24 символа без нежелательных слов; жителей-подписчиков не больше, чем подписчиков.
import { pickTraits, cleanWish } from './sim_life.js';
const mskDate = ts => new Date(ts + 3 * 3600e3).toISOString().slice(0, 10);
export function acceptSubmissions(d, rows) {
  const base = (d.residents || []).filter(r => !r.live), have = new Set(base.map(r => String(r.nick).toLowerCase()));
  const banNick = new Set((d.banned_nicks || []).map(x => String(x).toLowerCase().replace(/^@/, ''))), banWord = (d.banned_words || []).map(w => String(w).toLowerCase());
  let room = Math.max(0, (+d.followers || 0) - base.length); const out = [], now = Date.now(), t0 = Date.UTC(2026, 10, 8);
  for (const s of [...(rows || [])].sort((a, b) => (+a.ts || 0) - (+b.ts || 0))) {
    if (room <= 0) break;
    const nick = String(s.nick || '').trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9._]{1,30}$/.test(nick) || have.has(nick) || banNick.has(nick)) continue;
    const traits = pickTraits(Array.isArray(s.traits) ? s.traits : String(s.traits || '').split(',')); if (!traits.length) continue;
    let wish = cleanWish(s.wish); if (wish && banWord.some(w => wish.toLowerCase().includes(w))) wish = null;
    const ts = Math.min(Math.max(+s.ts || now, t0), now);          // время присяги не раньше основания государства и не из будущего
    const rec = { num: base.length + out.length + 1, nick, traits, joined: mskDate(ts), live: true }; if (wish) rec.wish = wish;
    out.push(rec); have.add(nick); room--;
  }
  return out;
}
