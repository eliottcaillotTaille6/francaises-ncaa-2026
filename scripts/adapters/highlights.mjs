// Recherche du résumé vidéo (« highlights ») d'un match sur YouTube : chaînes des facs, des conférences,
// télés locales… Une vidéo n'est retenue que si on est sûr que c'est ce match :
// - « highlights » ou « condensed game » dans le titre (« Full Game Highlights » compris, mais pas un match complet) ;
// - match féminin (women, WBB, Lady… dans le titre ou le nom de la chaîne) ;
// - les deux équipes reconnues, dans le titre ou le nom de la chaîne (ex. chaîne « Xavier Musketeers ») ;
// - publiée après le match, dans les 5 jours (date relative de YouTube : « 14h ago », « 2 days ago ») ;
// - si le titre porte une date, c'est celle du match (± 1 jour) ;
// - entre 30 s et 25 min.
// Parmi les vidéos retenues : d'abord les chaînes officielles (fac, conférence, ESPN…), puis la plus longue
// (plus de paniers ; un « condensed game » contient toutes les possessions).
import { fetchJSON, fetchText } from '../lib/http.mjs';
import { addDays } from '../lib/time.mjs';
import { titleDate } from './youtube.mjs';

const ESPN_TEAMS = 'https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/teams?limit=500';
const plain = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

let espnTeams = null;
async function teamsById() {
  if (!espnTeams) {
    const r = await fetchJSON(ESPN_TEAMS, { ttl: 7 * 86400 });
    const list = r.sports[0].leagues[0].teams.map((t) => t.team);
    // mascotte utilisable seule seulement si aucune autre équipe ne la porte (« Mastodons » oui, « Tigers » non)
    const count = new Map();
    for (const t of list) count.set(plain(t.name), (count.get(plain(t.name)) ?? 0) + 1);
    espnTeams = new Map(list.map((t) => [String(t.id), { ...t, uniqueMascot: count.get(plain(t.name)) === 1 }]));
  }
  return espnTeams;
}

/** Noms sous lesquels l'équipe peut apparaître : noms (minuscules) et sigles (casse exacte, ex. « PFW »). */
export async function aliasesOf(side, extra = []) {
  const t = side.espn_id ? (await teamsById()).get(String(side.espn_id)) : null;
  const names = new Set([side.name, side.team, ...extra].filter(Boolean).map(plain));
  const codes = new Set();
  if (t) {
    for (const n of [t.location, t.nickname, t.shortDisplayName, t.displayName]) if (n) names.add(plain(n));
    if (t.uniqueMascot && t.name) names.add(plain(t.name));
    const abbr = (t.abbreviation ?? '').replace(/[^A-Za-z]/g, '');
    if (abbr.length >= 3) codes.add(abbr.toUpperCase());
  }
  return { names: [...names].filter((n) => n.length >= 3), codes: [...codes] };
}

function mentions(text, raw, { names, codes }) {
  const p = ` ${plain(text)} `;
  return names.some((n) => p.includes(` ${n} `)) || codes.some((c) => new RegExp(`(^|[^A-Za-z])${c}([^A-Za-z]|$)`).test(raw));
}

// « 14h ago », « 2 days ago », « Streamed 3 hours ago » → âge approximatif en jours (null si ancien ou illisible)
function ageDays(text) {
  const m = /(\d+)\s*(s|sec|second|m|min|minute|h|hr|hour|d|day|w|wk|week|mo|month|y|yr|year)s?\s+ago/i.exec(text ?? '');
  if (!m) return null;
  const unit = m[2].toLowerCase();
  const n = Number(m[1]);
  if (/^(mo|month|y|yr|year)$/.test(unit)) return Infinity;
  const per = /^(w|wk|week)$/.test(unit) ? 7 : /^(d|day)$/.test(unit) ? 1 : /^(h|hr|hour)$/.test(unit) ? 1 / 24 : 1 / 1440;
  return n * per;
}

function seconds(text) {
  if (!/^\d+(:\d{2}){1,2}$/.test(text ?? '')) return null;
  return text.split(':').reduce((a, x) => a * 60 + Number(x), 0);
}

function results(html) {
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  if (!m) return [];
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (o.videoRenderer) {
      const v = o.videoRenderer;
      out.push({
        id: v.videoId,
        title: (v.title?.runs ?? []).map((r) => r.text).join(''),
        channel: v.ownerText?.runs?.[0]?.text ?? '',
        age_days: ageDays(v.publishedTimeText?.simpleText),
        duration_s: seconds(v.lengthText?.simpleText),
      });
    }
    Object.values(o).forEach(walk);
  };
  walk(JSON.parse(m[1]));
  return out;
}

/** La vidéo est-elle sûrement le résumé de ce match ? today = date du jour (US Eastern). */
export function isHighlightsOf(v, game, home, away, today) {
  const both = `${v.title} | ${v.channel}`;
  if (!/highlight|condensed game/i.test(v.title)) return false;
  if (/full (game|replay)(?!\s*highlight)/i.test(v.title)) return false;
  if (!/\b(women|womens|wbb|lady|ladies)\b/.test(plain(both))) return false;
  if (!mentions(both, both, home) || !mentions(both, both, away)) return false;
  if (v.duration_s == null || v.duration_s < 30 || v.duration_s > 25 * 60) return false;
  // publiée entre le jour du match et 5 jours après
  const sinceGame = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${game.date_et}T12:00:00Z`)) / 86400000;
  if (v.age_days == null || v.age_days > sinceGame + 1 || v.age_days < sinceGame - 5) return false;
  const d = titleDate(v.title);
  if (d && ![game.date_et, addDays(game.date_et, -1), addDays(game.date_et, 1)].includes(d)) return false;
  return true;
}

/**
 * Cherche le résumé du match. names = { home: [noms], away: [noms] } (le premier sert à la recherche),
 * extra = { home: [alias], away: [alias] }. Renvoie { url, title, channel, duration_s } ou null.
 */
export async function findHighlights(game, names, extra, today) {
  const home = await aliasesOf(game.home, extra.home);
  const away = await aliasesOf(game.away, extra.away);
  const query = `${names.home[0]} vs ${names.away[0]} women's basketball highlights`;
  const html = await fetchText(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
    ttl: 6 * 3600,
    headers: { 'Accept-Language': 'en-US,en;q=0.8' },
  });
  const hits = results(html).filter((v) => isHighlightsOf(v, game, home, away, today));
  const official = (v) => (mentions(v.channel, v.channel, home) || mentions(v.channel, v.channel, away)
    || /conference|athletics|sports|network|espn|ncaa|march madness|big ten|big 12|big east|\bacc\b|\bsec\b|women'?s basketball|\bwbb\b/i.test(v.channel)) ? 1 : 0;
  hits.sort((a, b) => official(b) - official(a) || b.duration_s - a.duration_s);
  const best = hits[0];
  return best
    ? { url: `https://www.youtube.com/watch?v=${best.id}`, title: best.title, channel: best.channel, duration_s: best.duration_s, official: !!official(best) }
    : null;
}
