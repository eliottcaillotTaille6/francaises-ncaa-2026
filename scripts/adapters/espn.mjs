// Source 1 : API publique (non officielle) d'ESPN.
import { fetchJSON } from '../lib/http.mjs';
import { etDate } from '../lib/time.mjs';
import { makeLine } from '../lib/statline.mjs';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball';
export const SEASON_YEAR = 2027; // saison 2026-27 chez ESPN

export const espnBoxUrl = (id) => `https://www.espn.com/womens-college-basketball/boxscore/_/gameId/${id}`;
export const espnPbpUrl = (id) => `https://www.espn.com/womens-college-basketball/playbyplay/_/gameId/${id}`;

/** Calendrier ESPN d'une équipe (saison régulière + postseason). */
export async function teamSchedule(teamId) {
  const games = [];
  for (const type of [2, 3]) {
    let j;
    try {
      j = await fetchJSON(`${BASE}/teams/${teamId}/schedule?season=${SEASON_YEAR}&seasontype=${type}`, { ttl: 2 * 3600 });
    } catch {
      continue;
    }
    for (const e of j.events ?? []) {
      const c = e.competitions?.[0];
      if (!c) continue;
      const us = c.competitors.find((x) => x.team.id === String(teamId));
      const them = c.competitors.find((x) => x.team.id !== String(teamId));
      if (!us || !them) continue;
      games.push({
        espn_event_id: e.id,
        date_et: etDate(e.date),
        tipoff_utc: e.date,
        neutral: !!c.neutralSite,
        home_away: c.neutralSite ? 'N' : us.homeAway === 'home' ? 'H' : 'A',
        us: { espn_id: us.team.id, name: us.team.location, score: us.score?.value ?? null },
        opp: { espn_id: them.team.id, name: them.team.location ?? them.team.displayName, score: them.score?.value ?? null },
        home_side: us.homeAway === 'home' ? 'us' : 'opp',
        completed: !!c.status?.type?.completed,
        status: c.status?.type?.name,
      });
    }
  }
  return games;
}

const KEYMAP = {
  minutes: 'min', points: 'pts', rebounds: 'reb', assists: 'ast', turnovers: 'to', steals: 'stl', blocks: 'blk',
  offensiveRebounds: 'oreb', defensiveRebounds: 'dreb', fouls: 'pf',
};

/**
 * Box score ESPN d'un match. Renvoie null si ESPN n'a pas de stats joueuses pour ce match.
 * players : [{ espn_id, name, jersey, team_id, starter, dnp, reason, line }]
 */
export async function boxscore(eventId, { completed = true } = {}) {
  const j = await fetchJSON(`${BASE}/summary?event=${eventId}`, { ttl: completed ? 12 * 3600 : 0 });
  const status = j.header?.competitions?.[0]?.status?.type;
  const teams = j.boxscore?.players ?? [];
  const players = [];
  for (const t of teams) {
    const block = t.statistics?.[0];
    if (!block) continue;
    const keys = block.keys ?? [];
    for (const a of block.athletes ?? []) {
      const raw = {};
      keys.forEach((k, i) => {
        const v = a.stats?.[i];
        if (KEYMAP[k]) raw[KEYMAP[k]] = v;
        else if (k.startsWith('fieldGoalsMade')) [raw.fgm, raw.fga] = String(v).split('-');
        else if (k.startsWith('threePoint')) [raw.tpm, raw.tpa] = String(v).split('-');
        else if (k.startsWith('freeThrows')) [raw.ftm, raw.fta] = String(v).split('-');
      });
      players.push({
        espn_id: a.athlete?.id,
        name: a.athlete?.displayName,
        jersey: a.athlete?.jersey,
        team_id: t.team?.id,
        starter: !!a.starter,
        dnp: !!a.didNotPlay || !a.stats?.length,
        reason: a.reason ?? '',
        line: a.stats?.length ? makeLine(raw) : null,
      });
    }
  }
  if (!players.some((p) => p.line)) return null;
  return { final: !!status?.completed, players };
}
