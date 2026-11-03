// Recense le site athlétique de chaque fac et écrit data/sources.json.
// Une fac déjà présente dans sources.json n'est jamais modifiée (corrections manuelles préservées),
// sauf avec --force <Fac>. Usage : node scripts/build-sources.mjs [--force "Fac"]
import fs from 'node:fs';
import { fetchText, fetchJSON } from './lib/http.mjs';
import { extractNuxtData } from './lib/nuxt.mjs';
import { extractSidearmVueSchedule } from './lib/json-in-html.mjs';

const SEASON = '2026-27';
const OUT = 'data/sources.json';
const forceIdx = process.argv.indexOf('--force');
const forced = forceIdx > 0 ? process.argv[forceIdx + 1] : null;

const players = JSON.parse(fs.readFileSync('data/players.json', 'utf8'));
const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { teams: {} };

// Domaine : celui de la colonne Source du fichier Excel (on ignore les sites de presse).
const NOT_SCHOOL = /wiwsport|eurobasket|bebasket/;
const teams = {};
for (const p of players) {
  const host = new URL(p.source).hostname.replace(/^www\./, '');
  if (!teams[p.team]) teams[p.team] = { espn_team_id: p.espn_team_id, domain: null };
  if (!teams[p.team].domain && !NOT_SCHOOL.test(host)) teams[p.team].domain = host;
}

const conferences = new Map();
async function conference(teamId) {
  const t = await fetchJSON(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/teams/${teamId}`,
    { ttl: 7 * 86400 },
  );
  const gid = t.team?.groups?.id;
  if (!gid) return '';
  if (!conferences.has(gid)) {
    const g = await fetchJSON(
      `https://sports.core.api.espn.com/v2/sports/basketball/leagues/womens-college-basketball/seasons/2027/types/2/groups/${gid}?lang=en`,
      { ttl: 30 * 86400 },
    );
    conferences.set(gid, g.shortName ?? g.name ?? '');
  }
  return conferences.get(gid);
}

async function detect(domain) {
  const url = `https://${domain}/sports/womens-basketball/schedule/${SEASON}`;
  let html;
  try {
    html = await fetchText(url, { ttl: 6 * 3600, retries: 1 });
  } catch (e) {
    if (e.status === 403 || e.status === 401) return { platform: 'blocked', schedule_url: url, error: e.message };
    if (e.status !== 404) return { platform: 'unknown', schedule_url: url, error: e.message };
    html = null;
  }
  if (html) {
    const nuxt = /id="__NUXT_DATA__"/.test(html) ? extractNuxtData(html) : null;
    const sched = nuxt?.pinia?.schedule?.schedules?.[`schedules-womens-basketball,${SEASON}`];
    if (sched?.games) return { platform: 'sidearm-nuxt', schedule_url: url, games: sched.games.length };
    const vue = extractSidearmVueSchedule(html);
    if (vue?.games) return { platform: 'sidearm-vue', schedule_url: url, games: vue.games.length };
    const classic = html.match(/<li[^>]*class="sidearm-schedule-game /g);
    if (classic) return { platform: 'sidearm', schedule_url: url, games: classic.length };
  }
  // WMT Digital : API JSON « website-api ».
  try {
    const sports = await fetchJSON(`https://${domain}/website-api/sports?per_page=100`, { ttl: 86400, retries: 1 });
    const wbb = sports.data.find((s) => /women'?s basketball/i.test(s.name));
    if (wbb) {
      const ev = await fetchJSON(
        `https://${domain}/website-api/schedule-events?filter%5Bschedule_id%5D=${wbb.schedule_id}&per_page=100&sort=datetime`,
        { ttl: 6 * 3600, retries: 1 },
      );
      return {
        platform: 'wmt',
        schedule_url: `https://${domain}/sports/${wbb.slug}/schedule`,
        wmt_schedule_id: wbb.schedule_id,
        games: ev.data.length,
      };
    }
  } catch (e) {
    if (e.status === 403) return { platform: 'blocked', schedule_url: url, error: e.message };
  }
  return { platform: 'unknown', schedule_url: url, error: 'plateforme non reconnue' };
}

const out = { season: SEASON, updated: new Date().toISOString().slice(0, 10), teams: { ...existing.teams } };
for (const [name, t] of Object.entries(teams)) {
  if (out.teams[name] && name !== forced) continue;
  const d = await detect(t.domain);
  out.teams[name] = {
    espn_team_id: t.espn_team_id,
    conference: t.espn_team_id ? await conference(t.espn_team_id) : '',
    youtube_name: name,
    domain: t.domain,
    platform: d.platform,
    schedule_url: d.schedule_url,
    ...(d.wmt_schedule_id ? { wmt_schedule_id: d.wmt_schedule_id } : {}),
    enabled: d.platform !== 'blocked' && d.platform !== 'unknown',
    note: d.error ?? '',
  };
  console.error(`${d.platform.padEnd(13)} ${String(d.games ?? '-').padStart(3)} matchs  ${name}  ${d.schedule_url}`);
}
out.teams = Object.fromEntries(Object.entries(out.teams).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
