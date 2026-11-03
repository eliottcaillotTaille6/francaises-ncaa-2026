// Rapprochements : joueuses dans un box score, adversaires entre deux sources.
import { normalizeName, compactName, parseBoxName } from './normalize.mjs';

/**
 * Cherche une joueuse de la liste parmi les lignes d'un box score de fac.
 * Ordre : nom complet (avec alias), puis « P. Nom » / « Nom, P » si unique, puis maillot pour départager.
 */
export function findInFacBox(player, rows, jersey) {
  const names = [player.name, ...(player.aliases ?? [])];
  const fulls = new Set(names.map(compactName));
  const exact = rows.filter((r) => {
    const { first, last } = parseBoxName(r.name);
    return fulls.has(compactName(`${first} ${last}`)) || fulls.has(compactName(`${last} ${first}`)) || fulls.has(compactName(r.name));
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1 && jersey) return exact.find((r) => String(Number(r.jersey)) === String(Number(jersey))) ?? null;

  // Initiale + nom de famille.
  const words = normalizeName(player.name).split(' ');
  const first = words[0];
  const lastCompact = words.slice(1).join('');
  const loose = rows.filter((r) => {
    const { first: f, last: l } = parseBoxName(r.name);
    return compactName(l) === lastCompact && f && f[0] === first[0];
  });
  if (loose.length === 1) return loose[0];
  if (loose.length > 1 && jersey) return loose.find((r) => String(Number(r.jersey)) === String(Number(jersey))) ?? null;

  // Nom composé plus long dans le box score (« Keita-Cissoko, Aissatou » pour « Aissatou Keita ») :
  // prénom identique exigé, et un seul candidat.
  const compound = rows.filter((r) => {
    const { first: f, last: l } = parseBoxName(r.name);
    const lc = compactName(l);
    return compactName(f) === compactName(first) && lastCompact.length > 2 && (lc.startsWith(lastCompact) || lc.endsWith(lastCompact));
  });
  return compound.length === 1 ? compound[0] : null;
}

/** Le tableau d'un box score qui correspond à une équipe donnée (meilleure similarité de nom). */
export function pickTeam(teams, names) {
  let best = null;
  let score = 0;
  for (const t of teams)
    for (const n of names) {
      const s = teamSimilarity(t.name ?? '', n);
      if (s > score) [best, score] = [t, s];
    }
  return score >= 0.5 ? best : null;
}

const STOP = new Set(['university', 'of', 'the', 'college', 'at', 'univ', 'u', 'women', 'womens', 'lady']);
const SUB = { st: 'state', saint: 'st', mt: 'mount', n: 'north', s: 'south', e: 'east', w: 'west' };

function tokens(name) {
  return normalizeName(name)
    .replace(/[()&]/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => SUB[w] ?? w);
}

/** Similarité 0..1 entre deux noms d'équipe venant de sources différentes. */
export function teamSimilarity(a, b) {
  const ca = compactName(a).replace(/[^a-z]/g, '');
  const cb = compactName(b).replace(/[^a-z]/g, '');
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  if (ca.length > 3 && cb.length > 3 && (ca.startsWith(cb) || cb.startsWith(ca))) return 0.9;
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  const inter = [...ta].filter((x) => tb.has(x)).length;
  return inter / Math.max(1, Math.min(ta.size, tb.size)) * 0.8;
}
