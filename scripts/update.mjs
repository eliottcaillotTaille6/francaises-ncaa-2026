// Pipeline quotidien : récupère les matchs terminés, extrait la ligne de chaque Française,
// fusionne les sources dans data/games.json et régénère les rapports.
//
//   node scripts/update.mjs                       veille + jour (date US Eastern)
//   node scripts/update.mjs --date 2026-11-02     une journée
//   node scripts/update.mjs --from 2026-11-02 --to 2026-11-20   rattrapage
//   options : --no-espn (sites des facs seuls) · --out fichier.json (autre fichier de sortie, sans rapports)
import fs from 'node:fs';
import * as espn from './adapters/espn.mjs';
import * as sidearm from './adapters/sidearm.mjs';
import * as wmt from './adapters/wmt.mjs';
import * as youtube from './adapters/youtube.mjs';
import { fetchJSON } from './lib/http.mjs';
import { todayET, addDays, dateRange } from './lib/time.mjs';
import { slugify, normalizeName } from './lib/normalize.mjs';
import { findInFacBox, teamSimilarity, pickTeam } from './lib/match.mjs';

const SEASON_START = '2026-11-02';
const PRIORITY = { espn: 3, fac: 2, ncaa: 1 };

// ---------- arguments ----------
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};
const today = todayET();
let dates;
if (arg('--date')) dates = [arg('--date')];
else if (arg('--from')) dates = dateRange(arg('--from'), arg('--to') ?? today);
else dates = [addDays(today, -1), today];
const NO_ESPN = process.argv.includes('--no-espn');
const OUT = arg('--out') ?? 'data/games.json';

// ---------- données ----------
const readJSON = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const players = readJSON('data/players.json', []).filter((p) => p.active !== false);
const sources = readJSON('data/sources.json', { teams: {} }).teams;
const siteConfig = readJSON('config/site.json', {});
const store = readJSON(OUT, { games: [] });
const games = new Map(store.games.map((g) => [g.id, g]));
const errors = [];

const teamNames = [...new Set(players.map((p) => p.team))];
const byEspnTeam = new Map(teamNames.filter((t) => sources[t]?.espn_team_id).map((t) => [sources[t].espn_team_id, t]));
const displayName = (team) => sources[team]?.youtube_name ?? team;

// Nom d'adversaire → fac suivie (quand deux facs de la liste s'affrontent).
function trackedTeamFor(name, espnId) {
  if (espnId && byEspnTeam.has(espnId)) return byEspnTeam.get(espnId);
  const best = teamNames.map((t) => [t, teamSimilarity(t, name)]).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 0.9 ? best[0] : null;
}

const adapterFor = (src) => (src.platform === 'wmt' ? wmt : src.platform?.startsWith('sidearm') ? sidearm : null);

// ---------- calendriers ----------
const calendars = {};
for (const team of teamNames) {
  const src = sources[team] ?? {};
  const cal = { espn: [], fac: [], facOk: false };
  if (src.espn_team_id && !NO_ESPN) {
    try {
      cal.espn = await espn.teamSchedule(src.espn_team_id);
    } catch (e) {
      errors.push(`ESPN calendrier ${team} : ${e.message}`);
    }
  }
  const ad = adapterFor(src);
  if (src.enabled !== false && ad) {
    try {
      cal.fac = (await ad.schedule(src)).filter((g) => !g.exhibition && g.date_local);
      cal.facOk = true;
    } catch (e) {
      errors.push(`Calendrier site fac ${team} (${src.schedule_url}) : ${e.message}`);
    }
  } else if (src.enabled === false) {
    errors.push(`Site fac ${team} désactivé (${src.platform}) : ${src.note || ''}`);
  }
  calendars[team] = cal;
}

// Associe les matchs ESPN et site fac d'une même fac (même date, ou ±1 jour pour les fuseaux).
function pairGames(team) {
  const { espn: E, fac: F } = calendars[team];
  const pairs = [];
  const usedF = new Set();
  for (const e of E) {
    const cands = F.filter((f) => !usedF.has(f) && Math.abs(Date.parse(f.date_local) - Date.parse(e.date_et)) <= 86400000);
    let best = null;
    let bestScore = 0;
    for (const f of cands) {
      const s = teamSimilarity(e.opp.name, f.opponent) + (f.date_local === e.date_et ? 0.3 : 0);
      if (s > bestScore) [best, bestScore] = [f, s];
    }
    const sameDay = cands.filter((f) => f.date_local === e.date_et);
    if (!best || bestScore < 0.5) best = sameDay.length === 1 && E.filter((x) => x.date_et === e.date_et).length === 1 ? sameDay[0] : null;
    if (best) usedF.add(best);
    pairs.push({ espn: e, fac: best, date_et: e.date_et });
  }
  for (const f of F) if (!usedF.has(f)) pairs.push({ espn: null, fac: f, date_et: f.date_local });
  return pairs;
}

// ---------- enregistrement des matchs ----------
function findRecord(team, date, espnId, oppName) {
  for (const g of games.values()) if (espnId && g.espn_event_id === espnId) return g;
  const sameDay = [...games.values()].filter((g) => g.date_et === date && g.teams.includes(team));
  if (sameDay.length === 1) return sameDay[0];
  return sameDay.find((g) => teamSimilarity(g.home.team === team ? g.away.name : g.home.name, oppName) >= 0.5) ?? null;
}

function upsertGame(team, pair) {
  const e = pair.espn;
  const f = pair.fac;
  const oppName = e?.opp.name ?? f.opponent;
  const oppTracked = trackedTeamFor(oppName, e?.opp.espn_id);
  let g = findRecord(team, pair.date_et, e?.espn_event_id, oppName);
  const ha = e?.home_away ?? f.home_away;
  const us = { name: displayName(team), team, score: e?.us.score ?? f?.us_score ?? null, espn_id: e?.us.espn_id ?? sources[team]?.espn_team_id ?? null };
  const them = {
    name: oppTracked ? displayName(oppTracked) : oppName,
    team: oppTracked,
    score: e?.opp.score ?? f?.opp_score ?? null,
    espn_id: e?.opp.espn_id ?? (oppTracked ? sources[oppTracked]?.espn_team_id : null),
  };
  const [home, away] = ha === 'A' ? [them, us] : [us, them];
  if (!g) {
    g = {
      id: `${pair.date_et}-${slugify(away.name)}-at-${slugify(home.name)}`,
      date_et: pair.date_et,
      tipoff_utc: e?.tipoff_utc ?? f?.tipoff_utc ?? null,
      time_local: f?.time_local ?? '',
      neutral: ha === 'N',
      home,
      away,
      teams: [team, oppTracked].filter(Boolean),
      espn_event_id: e?.espn_event_id ?? null,
      links: {},
      lines: {},
    };
    games.set(g.id, g);
  }
  // Compléter sans écraser ce qu'une source prioritaire a déjà fourni.
  if (e) {
    g.espn_event_id = e.espn_event_id;
    g.tipoff_utc = e.tipoff_utc;
    g.links.espn_box = espn.espnBoxUrl(e.espn_event_id);
    g.links.espn_pbp = espn.espnPbpUrl(e.espn_event_id);
    const side = g.home.team === team ? 'home' : 'away';
    const other = side === 'home' ? 'away' : 'home';
    if (e.us.score != null) g[side].score = e.us.score;
    if (e.opp.score != null) g[other].score = e.opp.score;
  } else if (f && g.home.score == null) {
    const side = g.home.team === team ? 'home' : 'away';
    g[side].score = f.us_score;
    g[side === 'home' ? 'away' : 'home'].score = f.opp_score;
  }
  if (!g.teams.includes(team)) g.teams.push(team);
  return g;
}

// ---------- extraction des lignes ----------
const espnBoxCache = new Map();
async function espnBox(id) {
  if (!espnBoxCache.has(id)) {
    try {
      espnBoxCache.set(id, await espn.boxscore(id));
    } catch (e) {
      errors.push(`ESPN box score ${id} : ${e.message}`);
      espnBoxCache.set(id, null);
    }
  }
  return espnBoxCache.get(id);
}

async function facBox(team, f) {
  const src = sources[team];
  try {
    if (src.platform === 'wmt') return await wmt.boxscore(f);
    if (f.box_url) return await sidearm.boxscore(f.box_url, src);
  } catch (e) {
    errors.push(`Box score site fac ${team} (${f.box_url}) : ${e.message}`);
  }
  return null;
}

const rosterJersey = new Map();
async function jerseyOf(p) {
  if (!p.espn_team_id || !p.espn_athlete_id) return null;
  if (!rosterJersey.has(p.espn_team_id)) {
    try {
      const r = await fetchJSON(
        `https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/teams/${p.espn_team_id}/roster`,
        { ttl: 86400 },
      );
      rosterJersey.set(p.espn_team_id, new Map(r.athletes.map((a) => [a.id, a.jersey])));
    } catch {
      rosterJersey.set(p.espn_team_id, new Map());
    }
  }
  return rosterJersey.get(p.espn_team_id).get(p.espn_athlete_id) ?? null;
}

const COMPARE = ['pts', 'min', 'reb', 'ast', 'fgm', 'fga', 'tpm', 'ftm', 'stl', 'blk', 'to', 'pf'];
function diff(a, b) {
  return COMPARE.filter((k) => (k === 'min' ? Math.abs(a[k] - b[k]) >= 1.5 : a[k] !== b[k])).map((k) => ({ stat: k, espn: a[k], fac: b[k] }));
}

function toLine(p, team, row, source, url, jersey) {
  return {
    player_id: p.id,
    team,
    jersey: row?.jersey ?? jersey ?? null,
    status: row ? (row.dnp || !row.line ? 'dnp' : 'played') : 'absent',
    starter: row ? !!row.starter : false,
    reason: row?.reason ?? '',
    stats: row && !row.dnp ? row.line : null,
    source,
    source_url: url,
  };
}

async function processTeamGame(team, pair, g) {
  const roster = players.filter((p) => p.team === team);
  const e = pair.espn;
  const f = pair.fac;
  const eb = e?.completed ? await espnBox(e.espn_event_id) : null;
  const fb = f?.completed ? await facBox(team, f) : null;
  if (fb) {
    g.links.fac = g.links.fac ?? {};
    g.links.fac[team] = { box: f.box_url ?? f.wmt_v2 ?? f.wmt_v1, pbp: fb.pbp_url };
    if (!g.links.official_box) g.links.official_box = f.box_url;
  }
  if (!eb && !fb) return false;
  const facRows = fb ? fb.teams.flatMap((t) => t.players) : [];
  const espnRows = eb ? eb.players.filter((x) => x.team_id === sources[team]?.espn_team_id) : [];

  // Contrôle de complétude : la somme des points du box score fac doit égaler le score de la fac.
  let facComplete = true;
  const ours = fb && pickTeam(fb.teams, [team, displayName(team)]);
  if (ours && f.us_score != null) {
    const sum = ours.players.reduce((a, x) => a + (x.line?.pts ?? 0), 0);
    if (sum !== f.us_score) {
      facComplete = false;
      errors.push(`Box score site fac ${team} incomplet (${g.id}) : ${sum} points listés pour un score de ${f.us_score}. ${g.links.fac?.[team]?.box}`);
    }
  }

  for (const p of roster) {
    let eRow = espnRows.find((x) => p.espn_athlete_id && x.espn_id === p.espn_athlete_id);
    if (!eRow && !p.espn_athlete_id) eRow = espnRows.find((x) => normalizeName(x.name) === normalizeName(p.name));
    const jersey = await jerseyOf(p);
    const fRow = fb ? findInFacBox(p, facRows, jersey) : null;

    let line;
    if (eb && (eRow || !fRow)) line = toLine(p, team, eRow, 'espn', g.links.espn_box, jersey);
    else if (fRow || facComplete) line = toLine(p, team, fRow, 'fac', g.links.fac?.[team]?.box, jersey);
    else continue; // box fac incomplet et pas d'ESPN : on ne déclare pas la joueuse absente

    if (eRow?.line && fRow?.line && !eRow.dnp && !fRow.dnp) {
      const d = diff(eRow.line, fRow.line);
      if (d.length) line.discrepancy = { fac_url: g.links.fac?.[team]?.box, diffs: d };
    }
    // Joue selon ESPN mais introuvable sur le site de la fac : souvent un nom écrit autrement.
    if (eRow?.line && !eRow.dnp && fb && !fRow)
      line.discrepancy = { fac_url: g.links.fac?.[team]?.box, diffs: [{ stat: 'présence', espn: 'a joué', fac: 'introuvable (nom différent ?)' }] };
    const old = g.lines[p.id];
    if (!old || PRIORITY[line.source] >= PRIORITY[old.source]) g.lines[p.id] = { ...line, updated: new Date().toISOString() };
  }
  g.sources = [...new Set([...(g.sources ?? []), ...(eb ? ['espn'] : []), ...(fb ? ['fac'] : [])])];
  return true;
}

// ---------- rattrapage automatique ----------
// Sans dates explicites, on reprend aussi les matchs terminés des 10 derniers jours encore sans stats.
if (!arg('--date') && !arg('--from')) {
  for (const team of teamNames)
    for (const pair of pairGames(team)) {
      const d = pair.date_et;
      if (d < addDays(today, -10) || d < SEASON_START || dates.includes(d)) continue;
      if (!(pair.espn?.completed || pair.fac?.completed)) continue;
      const rec = findRecord(team, d, pair.espn?.espn_event_id, pair.espn?.opp.name ?? pair.fac?.opponent);
      if (!rec || !players.some((p) => p.team === team && rec.lines[p.id])) dates.push(d);
    }
  dates.sort();
}

// ---------- boucle principale ----------
let processed = 0;
for (const team of teamNames) {
  for (const pair of pairGames(team)) {
    if (!dates.includes(pair.date_et)) continue;
    const done = pair.espn?.completed || pair.fac?.completed;
    if (!done) continue;
    const g = upsertGame(team, pair);
    if (await processTeamGame(team, pair, g)) processed++;
  }
}

// ---------- vidéo YouTube ----------
// On cherche le match sur la chaîne de référence (config/site.json → youtube.channels).
// Trouvé : lien direct vers la vidéo. Sinon le site affiche la recherche YouTube générale,
// et on retente chaque jour pendant 10 jours (les vidéos sont souvent publiées le lendemain).
const channel = siteConfig.youtube?.channels?.[0];
let ytFound = 0;
if (channel) {
  const alias = siteConfig.team_names ?? {};
  const namesOf = (side) => {
    const n = [side.team ? sources[side.team]?.youtube_name : null, alias[side.name], side.name, side.team];
    return [...new Set(n.filter(Boolean))];
  };
  for (const g of games.values()) {
    // vidéos trouvées avant le classement match complet / résumé : classement d'après le titre
    if (g.youtube?.url && !g.youtube.kind) g.youtube.kind = youtube.videoKind(g.youtube.title, g.youtube.duration_s);
    if (g.youtube?.url) continue;
    if (g.date_et < addDays(today, -10) && !dates.includes(g.date_et)) continue;
    try {
      const hit = await youtube.findOnChannel(channel, g, { home: namesOf(g.home), away: namesOf(g.away) });
      g.youtube = hit ? { ...hit, channel: channel.label } : { url: null, checked: today };
      if (hit) ytFound++;
    } catch (e) {
      errors.push(`Recherche YouTube ${channel.label} (${g.id}) : ${e.message}`);
    }
  }
}

// ---------- écriture ----------
const all = [...games.values()].sort((a, b) => a.date_et.localeCompare(b.date_et) || a.id.localeCompare(b.id));
fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), season: '2026-27', games: all }, null, 1) + '\n');

// ---------- rapports ----------
if (OUT !== 'data/games.json') {
  console.log(`Écrit dans ${OUT} (${all.length} matchs), rapports non régénérés.`);
  process.exit(0);
}
const playerName = new Map(players.map((p) => [p.id, p.name]));
const fmtDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Écarts ESPN / site fac
let disc = `# Écarts entre ESPN et les sites des facs\n\nMis à jour le ${today}. La valeur ESPN est celle retenue sur le site.\n\n`;
let nDisc = 0;
for (const g of all)
  for (const l of Object.values(g.lines))
    if (l.discrepancy) {
      nDisc++;
      disc += `- **${playerName.get(l.player_id) ?? l.player_id}**, ${g.away.name} @ ${g.home.name} (${fmtDate(g.date_et)}) : `;
      disc += l.discrepancy.diffs.map((d) => `${d.stat.toUpperCase()} ESPN ${d.espn} / site ${d.fac}`).join(', ');
      disc += ` — [ESPN](${g.links.espn_box}) · [site fac](${l.discrepancy.fac_url})\n`;
    }
if (!nDisc) disc += '_Aucun écart._\n';
fs.writeFileSync('data/discrepancies.md', disc);

// Matchs joués sans stats : le calendrier de chaque fac fait référence.
const missing = [];
for (const team of teamNames) {
  const cal = calendars[team];
  const src = sources[team] ?? {};
  const useFac = cal.facOk && cal.fac.length;
  const ref = useFac ? cal.fac : cal.espn;
  for (const x of ref) {
    const date = useFac ? x.date_local : x.date_et;
    if (date < SEASON_START || date > today) continue;
    const completed = x.completed;
    const opp = useFac ? x.opponent : x.opp.name;
    const rec = findRecord(team, date, useFac ? null : x.espn_event_id, opp) ??
      (useFac ? null : null);
    const hasLines = rec && players.filter((p) => p.team === team).some((p) => rec.lines[p.id]);
    if (completed && hasLines) continue;
    if (!completed && date >= addDays(today, -1)) continue; // pas encore joué ou résultat pas encore publié
    missing.push({
      team, date, opp,
      reason: !completed ? 'date passée mais aucun résultat publié sur le calendrier' : rec ? 'match enregistré sans ligne de stats' : 'aucun box score trouvé',
      cal: useFac ? src.schedule_url : `https://www.espn.com/womens-college-basketball/team/schedule/_/id/${src.espn_team_id}`,
      box: useFac ? x.box_url : null,
    });
  }
}
let mm = `# Matchs joués sans stats\n\nMis à jour le ${today}. Référence : calendrier officiel de chaque fac (ou calendrier ESPN quand le site est illisible). Les matchs d'exhibition sont exclus.\n\n`;
if (!missing.length) mm += '_Aucun match manquant._\n';
for (const m of missing.sort((a, b) => a.date.localeCompare(b.date)))
  mm += `- ${fmtDate(m.date)} — **${m.team}** vs ${m.opp} : ${m.reason}. [Calendrier](${m.cal})${m.box ? ` · [box score](${m.box})` : ''}\n`;
if (errors.length) mm += `\n## Sources en échec ou désactivées\n\n${[...new Set(errors)].map((e) => `- ${e}`).join('\n')}\n`;
fs.writeFileSync('data/missing-games.md', mm);

console.log(`Dates : ${dates[0]} → ${dates.at(-1)} · matchs traités : ${processed} · total games.json : ${all.length} · manquants : ${missing.length} · écarts : ${nDisc} · vidéos trouvées : ${ytFound} · erreurs : ${errors.length}`);
