// Remplit espn_team_id et espn_athlete_id dans data/players.json à partir des rosters ESPN,
// et écrit data/matching-report.md. Une correspondance n'est retenue que si elle est certaine :
// nom normalisé identique sur le roster de la bonne équipe, et un seul candidat.
// Usage : node scripts/match-players.mjs [--force]  (--force réécrit aussi les IDs déjà remplis)
import fs from 'node:fs';
import { fetchJSON } from './lib/http.mjs';
import { normalizeName, compactName } from './lib/normalize.mjs';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball';
const force = process.argv.includes('--force');

// Noms de fac du fichier Excel qui ne correspondent pas tels quels au champ « location » d'ESPN.
// Chaque alias a été vérifié à la main dans la liste des équipes ESPN.
const TEAM_ALIASES = {
  'Miami (Ohio)': 'Miami (OH)',
  UTRGV: 'UT Rio Grande Valley',
  'Louisiana-Monroe': 'UL Monroe',
  FIU: 'Florida International',
};

const players = JSON.parse(fs.readFileSync('data/players.json', 'utf8'));
const teamsRaw = await fetchJSON(`${ESPN}/teams?limit=500`, { ttl: 86400 });
const teams = teamsRaw.sports[0].leagues[0].teams.map((t) => t.team);

function findTeam(fac) {
  const target = normalizeName(TEAM_ALIASES[fac] ?? fac);
  const hits = teams.filter((t) => normalizeName(t.location) === target);
  return hits.length === 1 ? hits[0] : null;
}

const rosters = new Map();
async function roster(teamId) {
  if (!rosters.has(teamId)) {
    const j = await fetchJSON(`${ESPN}/teams/${teamId}/roster`, { ttl: 6 * 3600 });
    rosters.set(teamId, { season: j.season?.displayName, athletes: j.athletes ?? [] });
  }
  return rosters.get(teamId);
}

const confirmed = [];
const ambiguous = [];
const notFound = [];
const teamIssues = [];
const warnings = [];
const kept = [];

for (const p of players) {
  if (!force && p.espn_athlete_id && p.espn_team_id) {
    // ID déjà renseigné (éventuellement à la main) : on le garde et on l'affiche dans le rapport.
    const r = await roster(p.espn_team_id);
    const a = r.athletes.find((x) => x.id === p.espn_athlete_id);
    const team = teams.find((t) => t.id === p.espn_team_id);
    if (a) confirmed.push({ p, a, team, season: r.season });
    else warnings.push(`**${p.name}** : l'ID ESPN ${p.espn_athlete_id} n'est plus sur le roster de l'équipe ${p.espn_team_id}.`);
    kept.push(p);
    continue;
  }
  const team = findTeam(p.team);
  if (!team) {
    teamIssues.push(p);
    p.espn_team_id = '';
    p.espn_athlete_id = '';
    continue;
  }
  p.espn_team_id = team.id;
  const r = await roster(team.id);
  const full = normalizeName(p.name);
  const compact = compactName(p.name);
  const exact = r.athletes.filter(
    (a) => normalizeName(a.fullName) === full || compactName(a.fullName) === compact,
  );

  if (exact.length === 1) {
    const a = exact[0];
    p.espn_athlete_id = a.id;
    confirmed.push({ p, a, team, season: r.season });
    continue;
  }
  p.espn_athlete_id = '';

  // Candidats proches : même nom de famille, ou même prénom + nom qui commence pareil,
  // ou nom de famille de la liste contenu dans le nom ESPN (noms composés).
  const pw = full.split(' ');
  const first = pw[0];
  const lastParts = pw.slice(1);
  const cands = r.athletes.filter((a) => {
    const an = normalizeName(a.fullName);
    const al = normalizeName(a.lastName);
    const af = normalizeName(a.firstName);
    return (
      lastParts.some((w) => w.length > 2 && an.split(' ').includes(w)) ||
      (af === first && al.slice(0, 3) === (lastParts[0] ?? '').slice(0, 3)) ||
      an.includes(lastParts.join(' '))
    );
  });
  if (exact.length > 1 || cands.length) {
    ambiguous.push({ p, team, season: r.season, cands: exact.length > 1 ? exact : cands });
  } else {
    notFound.push({ p, team, season: r.season, size: r.athletes.length });
  }
}

// Contrôles de cohérence sur les correspondances confirmées.
for (const { p, a } of confirmed) {
  const country = a.birthPlace?.country;
  const place = a.birthPlace?.displayText ?? '';
  if (country && !/france|martinique|guadeloupe|guyane|r[ée]union|mayotte|caledonie|polyn/i.test(place))
    warnings.push(`**${p.name}** (${p.team}) : née hors de France selon ESPN (« ${place} »). Note Excel : ${p.note || '—'}`);
}
for (const p of players) {
  if (/lacrosse|soccer|volleyball|football/i.test(p.source))
    warnings.push(
      `**${p.name}** (${p.team}) : la source du fichier Excel pointe vers un roster d'un autre sport (${p.source})` +
        (p.espn_athlete_id ? ` ; elle figure pourtant bien sur le roster basket ESPN, la source est sans doute juste à corriger.` : '.'),
    );
}

fs.writeFileSync('data/players.json', JSON.stringify(players, null, 2) + '\n');

const espnLink = (a) => `[${a.id}](https://www.espn.com/womens-college-basketball/player/_/id/${a.id})`;
const rosterLink = (t) => `[roster ESPN](https://www.espn.com/womens-college-basketball/team/roster/_/id/${t.id})`;
const fmtA = (a) =>
  `${a.fullName} (#${a.jersey ?? '?'}, ${a.position?.abbreviation ?? '?'}, ${a.experience?.abbreviation ?? '?'}, né·e à ${a.birthPlace?.displayText ?? '?'}) — ${espnLink(a)}`;

let md = `# Rapport d'appariement ESPN — ${new Date().toISOString().slice(0, 10)}\n\n`;
md += `- Joueuses : **${players.length}**\n`;
md += `- Confirmées (nom identique sur le roster ESPN 2026-27 de la fac, ou validées à la main) : **${confirmed.length}**\n`;
md += `- Ambiguës (candidat proche, à valider) : **${ambiguous.length}**\n`;
md += `- Introuvables sur le roster ESPN : **${notFound.length}**\n`;
md += `- Fac introuvable sur ESPN : **${teamIssues.length}**\n`;
if (kept.length) md += `- Déjà renseignées, non retouchées : **${kept.length}**\n`;
md += `\nRègle : un ID n'est écrit dans \`players.json\` que si le nom normalisé (sans accents, casse, tirets ni apostrophes) est identique à un seul joueur du roster. Les cas ambigus et introuvables restent vides.\n`;

md += `\n## À valider\n\n`;
if (!ambiguous.length) md += `_Aucun._\n`;
for (const { p, team, cands } of ambiguous) {
  md += `### ${p.name} — ${p.team} (équipe ESPN ${team.id})\n`;
  md += `Candidats sur le ${rosterLink(team)} :\n`;
  for (const a of cands) md += `- ${fmtA(a)}\n`;
  md += `\nPour valider, copier l'ID dans \`espn_athlete_id\` de \`${p.id}\`.\n\n`;
}

md += `\n## Introuvables sur le roster ESPN\n\n`;
if (!notFound.length) md += `_Aucune._\n`;
for (const { p, team, size, season } of notFound)
  md += `- **${p.name}** — ${p.team} : absente du ${rosterLink(team)} (${size} joueuses, saison ${season}). Source Excel : ${p.source}\n`;

if (teamIssues.length) {
  md += `\n## Fac introuvable sur ESPN\n\n`;
  for (const p of teamIssues) md += `- **${p.name}** — « ${p.team} »\n`;
}

md += `\n## Points d'attention\n\n`;
md += warnings.length ? warnings.map((w) => `- ${w}`).join('\n') + '\n' : `_Aucun._\n`;

md += `\n## Confirmées\n\n| Joueuse | Fac | Équipe ESPN | Joueuse ESPN | Maillot | Né·e à |\n|---|---|---|---|---|---|\n`;
for (const { p, a, team } of confirmed)
  md += `| ${p.name} | ${p.team} | ${team.id} | ${a.fullName} (${espnLink(a)}) | ${a.jersey ?? ''} | ${a.birthPlace?.displayText ?? ''} |\n`;

// Notes de vérification écrites à la main, conservées d'un passage à l'autre.
if (fs.existsSync('data/matching-notes.md')) md += '\n' + fs.readFileSync('data/matching-notes.md', 'utf8');

fs.writeFileSync('data/matching-report.md', md);
console.log(
  `confirmées ${confirmed.length}, ambiguës ${ambiguous.length}, introuvables ${notFound.length}, fac KO ${teamIssues.length}`,
);
