// Source 2 : sites WMT Digital (API « website-api » + stats WMT v1 en XML ou v2 sur wmt.games).
import { fetchJSON, fetchText } from '../lib/http.mjs';
import { extractNuxtData } from '../lib/nuxt.mjs';
import { etDate } from '../lib/time.mjs';
import { makeLine, pair } from '../lib/statline.mjs';

const cleanOpp = (s) => String(s ?? '').replace(/^#\d+\s+/, '').replace(/\s*\(Exhibition\)\s*$/i, '').trim();

export async function schedule(src) {
  const url = `https://${src.domain}/website-api/schedule-events?filter%5Bschedule_id%5D=${src.wmt_schedule_id}&per_page=100&sort=datetime&include=scheduleEventResult`;
  const j = await fetchJSON(url, { ttl: 2 * 3600 });
  return j.data.map((e) => {
    const r = e.schedule_event_result;
    const hi = r?.winning_score != null ? Math.round(Number(r.winning_score)) : null;
    const lo = r?.losing_score != null ? Math.round(Number(r.losing_score)) : null;
    const won = r?.result === 'win';
    const res = hi === null ? null : { team_score: won ? hi : lo, opponent_score: won ? lo : hi };
    return {
      fac_game_id: String(e.id),
      date_local: e.datetime ? etDate(e.datetime) : null,
      tipoff_utc: e.datetime ?? null,
      time_local: '',
      home_away: e.venue_type === 'neutral' ? 'N' : e.venue_type === 'away' ? 'A' : 'H',
      opponent: cleanOpp(e.opponent_name),
      completed: e.status === 'completed' && !!res,
      exhibition: !!e.is_exhibition,
      us_score: res?.team_score ?? null,
      opp_score: res?.opponent_score ?? null,
      box_url: e.box_score_url,
      wmt_v1: e.wmt_stats_iframe_url,
      wmt_v2: e.wmt_stats2_iframe_url,
    };
  });
}

/**
 * Box score : v2 → wmt.games (__NUXT_DATA__), prioritaire ; v1 → XML StatCrew/Genius.
 * Quand les deux existent, le XML v1 peut être une saisie partielle (constaté le 2 novembre 2026).
 */
export async function boxscore(game) {
  if (game.wmt_v2) {
    const html = await fetchText(game.wmt_v2, { ttl: 12 * 3600 });
    const data = extractNuxtData(html)?.data ?? {};
    const match = Object.entries(data).find(([k]) => k.startsWith('match-full-'))?.[1];
    if (!match) throw new Error('match wmt.games introuvable');
    const box = match.tabs.find((t) => /box/i.test(t.title)) ?? match.tabs[0];
    const tables = box.children.flatMap((c) => c.tables ?? []);
    const teams = tables
      .filter((t) => t.body?.some((row) => row.some((c) => c.key === 'sPoints')))
      .map((t) => ({ name: t.title, players: t.body.map(wmtRow).filter(Boolean) }));
    return { pbp_url: game.wmt_v2, teams };
  }
  if (game.wmt_v1) {
    const u = new URL(game.wmt_v1);
    const id = u.pathname.split('/').pop();
    const xml = await fetchText(`${u.origin}/api/v1/game/xml/${id}`, { ttl: 12 * 3600 });
    return { pbp_url: game.wmt_v1, teams: parseBbgame(xml) };
  }
  return null;
}

function wmtRow(row) {
  const v = Object.fromEntries(row.map((c) => [c.key, c.value]));
  if (!v.name || /^(totals?|team)$/i.test(v.name)) return null;
  const [fgm, fga] = pair(v.sFieldGoals);
  const [tpm, tpa] = pair(v.sThreePointFieldGoals);
  const [ftm, fta] = pair(v.sFreeThrows);
  const [oreb, dreb] = pair(v.sRebounds);
  const dnp = !v.sMinutesPlayed || v.sMinutesPlayed === '-' || /dnp/i.test(String(v.sMinutesPlayed));
  return {
    name: v.name,
    jersey: v.jersey,
    roster_id: null,
    starter: v.sGamesStarted === '*',
    dnp,
    line: dnp ? null : makeLine({
      min: v.sMinutesPlayed, pts: v.sPoints, fgm, fga, tpm, tpa, ftm, fta, oreb, dreb, reb: v.sTotalRebounds,
      ast: v.sAssists, stl: v.sSteals, blk: v.sBlockedShots, to: v.sTurnovers, pf: v.sPersonalFouls,
    }),
  };
}

const attrs = (s) => Object.fromEntries([...s.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

function parseBbgame(xml) {
  const teams = [];
  for (const tm of xml.matchAll(/<team ([^>]*)>([\s\S]*?)<\/team>/g)) {
    const ta = attrs(tm[1]);
    const players = [];
    for (const pm of tm[2].matchAll(/<player ([^>]*)>([\s\S]*?)<\/player>/g)) {
      const pa = attrs(pm[1]);
      if (/^team$/i.test(pa.name ?? '') || pa.uni === 'TM') continue;
      const st = attrs(/<stats ([^>]*)\/?>/.exec(pm[2])?.[1] ?? '');
      const played = pa.gp === '1' && Object.keys(st).length > 0;
      players.push({
        name: pa.name,
        jersey: pa.uni,
        roster_id: null,
        starter: pa.gs === '1',
        dnp: !played,
        line: played ? makeLine({
          min: st.min, pts: st.tp, fgm: st.fgm, fga: st.fga, tpm: st.fgm3, tpa: st.fga3, ftm: st.ftm, fta: st.fta,
          oreb: st.oreb, dreb: st.dreb, reb: st.treb, ast: st.ast, stl: st.stl, blk: st.blk, to: st.to, pf: st.pf,
        }) : null,
      });
    }
    teams.push({ name: ta.name, players });
  }
  return teams;
}
