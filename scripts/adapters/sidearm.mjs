// Source 2 : sites Sidearm (classique HTML, nouvelle génération Nuxt, variante Vue).
import { fetchText } from '../lib/http.mjs';
import { extractNuxtData } from '../lib/nuxt.mjs';
import { extractSidearmVueSchedule } from '../lib/json-in-html.mjs';
import { parseMonthDay } from '../lib/time.mjs';
import { makeLine, pair } from '../lib/statline.mjs';

const SEASON = '2026-27';
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const abs = (domain, u) => (!u ? null : u.startsWith('http') ? u : `https://${domain}${u.startsWith('/') ? '' : '/'}${u}`);
const cleanOpp = (s) => strip(s).replace(/^#\d+\s+/, '').replace(/\s*\((?:Exhibition|Exh\.?)\)\s*$/i, '').replace(/\s+-\s+Exhibition$/i, '').trim();

/** Calendrier normalisé : [{ fac_game_id, date_local, time_local, home_away, opponent, completed, exhibition, us_score, opp_score, box_url }] */
export async function schedule(src) {
  const html = await fetchText(src.schedule_url, { ttl: 2 * 3600 });
  if (src.platform === 'sidearm-nuxt') {
    const nuxt = extractNuxtData(html);
    const games = nuxt?.pinia?.schedule?.schedules?.[`schedules-womens-basketball,${SEASON}`]?.games;
    if (!games) throw new Error('calendrier Nuxt introuvable');
    return games.map((g) => fromJsonGame(g, src.domain));
  }
  if (src.platform === 'sidearm-vue') {
    const s = extractSidearmVueSchedule(html);
    if (!s?.games) throw new Error('calendrier Vue introuvable');
    return s.games.map((g) => fromJsonGame(g, src.domain));
  }
  return classicSchedule(html, src.domain);
}

function fromJsonGame(g, domain) {
  const r = g.result ?? {};
  const opponent = cleanOpp(g.opponent?.title ?? g.opponent?.name ?? '');
  const scored = /^[WLT]$/.test(r.status ?? '') && r.team_score !== '' && r.team_score != null;
  return {
    fac_game_id: String(g.id),
    date_local: String(g.date ?? '').slice(0, 10),
    time_local: g.time ?? '',
    home_away: g.location_indicator === 'N' ? 'N' : g.location_indicator === 'A' ? 'A' : 'H',
    opponent,
    completed: scored,
    exhibition: g.type === 'S' || /exhibition/i.test(g.opponent?.title ?? ''),
    us_score: scored ? Number(r.team_score) : null,
    opp_score: scored ? Number(r.opponent_score) : null,
    box_url: abs(domain, r.boxscore?.url),
  };
}

function classicSchedule(html, domain) {
  const starts = [...html.matchAll(/<li[^>]*class="sidearm-schedule-game [^"]*"[^>]*>/g)].map((m) => m.index);
  if (!starts.length) throw new Error('calendrier Sidearm classique introuvable');
  starts.push(html.length);
  const out = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const s = html.slice(starts[i], starts[i + 1]);
    const cls = /class="([^"]*)"/.exec(s)[1];
    const id = /data-game-id="(\d+)"/.exec(s)?.[1];
    // Deux gabarits : date et heure dans deux <span> consécutifs, ou date seule (heure ailleurs).
    const di = s.indexOf('sidearm-schedule-game-opponent-date');
    const dateBlock = di >= 0 ? s.slice(di, di + 500) : '';
    const dateSpans = [null, ...[...dateBlock.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]).filter((x) => x.trim() !== '/')];
    const oppRaw = /sidearm-schedule-game-opponent-name[^>]*>([\s\S]*?)<\/(?:div|span)>/.exec(s)?.[1] ?? '';
    const resultBlock = /class="sidearm-schedule-game-result\s[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(s)?.[1] ?? '';
    const resultSpans = [...resultBlock.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1].trim());
    const score = resultSpans.map((x) => /^(\d+)-(\d+)/.exec(x)).find(Boolean);
    const box = /href="([^"]*\/boxscore\/\d+[^"]*)"/.exec(s)?.[1];
    out.push({
      fac_game_id: id,
      date_local: parseMonthDay(dateSpans?.[1]),
      time_local: strip(dateSpans?.[2]),
      home_away: /neutral-game/.test(cls) ? 'N' : /away-game/.test(cls) ? 'A' : 'H',
      opponent: cleanOpp(oppRaw),
      completed: /game-completed/.test(cls) && !!score,
      exhibition: /exhibition|\(exh\.?\)/i.test(strip(oppRaw)) || />\s*Exhibition\s*</i.test(s),
      us_score: score ? Number(score[1]) : null,
      opp_score: score ? Number(score[2]) : null,
      box_url: abs(domain, box),
    });
  }
  return out;
}

/**
 * Box score d'un match Sidearm.
 * Renvoie { pbp_url, teams: [{ name, players: [{ name, jersey, roster_id, starter, dnp, line }] }] }
 */
export async function boxscore(url, src) {
  const html = await fetchText(url, { ttl: 12 * 3600 });
  const nuxt = /id="__NUXT_DATA__"/.test(html) ? extractNuxtData(html) : null;
  const b = nuxt?.pinia?.boxscore?.boxscore && Object.values(nuxt.pinia.boxscore.boxscore)[0];
  if (b?.homeTeam) {
    const team = (t) => ({
      name: t.name,
      players: (t.players ?? [])
        .filter((p) => p.rosterPlayerId || (p.name && p.name !== 'TEAM'))
        .filter((p) => p.name !== 'TEAM')
        .map((p) => {
          const st = p.stats ?? {};
          const played = p.gamePlayed === '1';
          return {
            name: p.name,
            jersey: p.uniform,
            roster_id: p.rosterPlayerId ?? null,
            starter: p.gameStarted === '1',
            dnp: !played,
            line: played
              ? makeLine({
                  min: st.minutesPlayed, pts: st.totalPointsScored,
                  fgm: st.totalFieldGoalsMade, fga: st.totalFieldGoalsAttempted,
                  tpm: st.threePointFieldGoalsMade, tpa: st.threePointFieldGoalsAttempted,
                  ftm: st.freeThrowsMade, fta: st.freeThrowsAttempted,
                  oreb: st.offensiveRebounds, dreb: st.defensiveRebounds, reb: st.totalRebounds,
                  ast: st.assists, stl: st.steals, blk: st.blockedShots, to: st.turnovers, pf: st.personalFouls,
                })
              : null,
          };
        }),
    });
    // L'onglet play-by-play des sites Nuxt n'a pas d'URL propre : on renvoie le box score.
    return { pbp_url: url, teams: [team(b.visitingTeam), team(b.homeTeam)] };
  }
  return classicBox(html, url);
}

function classicBox(html, url) {
  const teams = [];
  for (const m of html.matchAll(/<table class="sidearm-table overall-stats[\s\S]*?<\/table>/g)) {
    const t = m[0];
    const caption = strip(/<caption[^>]*>([\s\S]*?)<\/caption>/.exec(t)?.[1]).replace(/\s+\d+$/, '');
    const players = [];
    for (const row of t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const r = row[1];
      if (!/data-label="PTS"/.test(r)) continue;
      const tds = [...r.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)];
      const nameCell = tds[1]?.[2] ?? '';
      const name = strip(/<a[^>]*>([\s\S]*?)<\/a>/.exec(nameCell)?.[1] ?? nameCell.replace(/<span[^>]*mobile-jersey-number[^>]*>[^<]*<\/span>/, ''));
      if (!name || /^(totals?|team)$/i.test(name)) continue;
      const cell = (label) => strip(tds.find((x) => new RegExp(`data-label="${label}"`).test(x[1]))?.[2]);
      const [oreb, dreb] = pair(cell('ORB-DRB'));
      const [fgm, fga] = pair(cell('FG'));
      const [tpm, tpa] = pair(cell('3PT'));
      const [ftm, fta] = pair(cell('FT'));
      const minRaw = cell('MIN');
      const dnp = /dnp|did not play/i.test(r) || minRaw === '' || minRaw === '-';
      players.push({
        name,
        jersey: strip(tds[0]?.[2]),
        roster_id: /\/roster\/[^/"']+\/(\d+)/.exec(nameCell)?.[1] ?? null,
        starter: strip(tds[2]?.[2]) === '*',
        dnp: dnp && !Number(cell('PTS')),
        line: makeLine({
          min: minRaw, pts: cell('PTS'), fgm, fga, tpm, tpa, ftm, fta, oreb, dreb, reb: cell('REB'),
          ast: cell('A'), stl: cell('STL'), blk: cell('BLK'), to: cell('TO'), pf: cell('PF'),
        }),
      });
    }
    teams.push({ name: caption, players });
  }
  if (!teams.length) throw new Error('aucun tableau de box score');
  const hasPbp = /id="play-by-play"/.test(html);
  return { pbp_url: hasPbp ? `${url}#play-by-play` : url, teams };
}
