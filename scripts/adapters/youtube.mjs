// Recherche d'une vidéo de match sur une chaîne YouTube (page de recherche de la chaîne, JSON ytInitialData).
// Une vidéo n'est retenue que si son titre contient les deux équipes, une mention « women/féminin »
// et la date du match (± 1 jour).
import { fetchText } from '../lib/http.mjs';
import { teamSimilarity } from '../lib/match.mjs';
import { addDays } from '../lib/time.mjs';

const MONTHS = { jan: 1, feb: 2, fev: 2, mar: 3, apr: 4, avr: 4, may: 5, mai: 5, jun: 6, juin: 6, jul: 7, juil: 7, aug: 8, aou: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// « Nov 2,2026 », « November 2, 2026 », « 2 nov. 2026 », « 1er nov. 2026 »
export function titleDate(title) {
  const t = plain(title);
  let m = /\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})\s*,\s*(\d{4})/.exec(t);
  if (m && MONTHS[m[1]]) return ymd(m[3], MONTHS[m[1]], m[2]);
  m = /\b(\d{1,2})(?:er)?\s+([a-z]{3,4})[a-z]*\.?\s+(\d{4})/.exec(t);
  if (m && (MONTHS[m[2]] || MONTHS[m[2].slice(0, 3)])) return ymd(m[3], MONTHS[m[2]] ?? MONTHS[m[2].slice(0, 3)], m[1]);
  return null;
}

function videos(html) {
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  if (!m) return [];
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (o.videoRenderer) {
      const v = o.videoRenderer;
      out.push({ id: v.videoId, title: (v.title?.runs ?? []).map((r) => r.text).join('') });
    }
    Object.values(o).forEach(walk);
  };
  walk(JSON.parse(m[1]));
  return out;
}

export function matchesGame(title, game, names) {
  if (!/women|feminin|femenino/i.test(plain(title))) return false;
  const d = titleDate(title);
  if (!d || ![game.date_et, addDays(game.date_et, -1), addDays(game.date_et, 1)].includes(d)) return false;
  const matchup = title.split('|')[0].replace(/\b(full game|match complet|highlights?|resume|résumé)\b.*$/i, '');
  const sides = matchup.split(/\s+(?:vs\.?|contre|at|@|v)\s+/i).map((s) => s.trim()).filter(Boolean);
  if (sides.length !== 2) return false;
  const best = (side) => (cands) => Math.max(...cands.map((c) => teamSimilarity(side, c)));
  const [a, b] = sides.map(best);
  const ok = (x, y) => x(names.home) >= 0.5 && y(names.away) >= 0.5;
  return ok(a, b) || ok(b, a);
}

/**
 * Cherche le match sur la chaîne. names = { home: [noms possibles], away: [...] }.
 * Renvoie { url, title } ou null.
 */
export async function findOnChannel(channel, game, names) {
  const query = `${names.home[0]} ${names.away[0]}`;
  const html = await fetchText(channel.search_url + encodeURIComponent(query), {
    ttl: 6 * 3600,
    headers: { 'Accept-Language': 'en-US,en;q=0.8' },
  });
  const hit = videos(html).find((v) => matchesGame(v.title, game, names));
  return hit ? { url: `https://www.youtube.com/watch?v=${hit.id}`, title: hit.title } : null;
}
