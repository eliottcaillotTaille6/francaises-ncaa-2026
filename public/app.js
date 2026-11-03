// Les Françaises en NCAA — site statique, sans framework.
// Données : data/games.json, data/players.json, data/sources.json, config/site.json.

const $main = document.getElementById('main');
const $tip = document.getElementById('tooltip');

const state = { players: [], byId: new Map(), games: [], sources: {}, config: {}, updated: null };

// ---------- utilitaires ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt1 = (n) => (Number.isFinite(n) ? n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–');
const pct = (m, a) => (a ? `${((100 * m) / a).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '–');
const noon = (ymd) => new Date(`${ymd}T12:00:00Z`);

const dateFR = (ymd, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) =>
  noon(ymd).toLocaleDateString('fr-FR', { ...opts, timeZone: 'UTC' });
const dateShortFR = (ymd) => noon(ymd).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const timeParis = (utc) =>
  new Date(utc).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', ' h ');
const dateParis = (utc) => new Date(utc).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });

// Heure du match en heure de Paris (le jour peut différer de la date US).
function kickoff(g) {
  if (g.tipoff_utc) {
    const sameDay = dateParis(g.tipoff_utc) === dateFR(g.date_et, { weekday: 'long', day: 'numeric', month: 'long' });
    return sameDay ? `${timeParis(g.tipoff_utc)} (Paris)` : `${dateParis(g.tipoff_utc)} à ${timeParis(g.tipoff_utc)} (Paris)`;
  }
  return g.time_local ? `${g.time_local} heure locale` : '';
}

const teamName = (n) => state.config.team_names?.[n] ?? n;

// Mode éditeur : activé une fois par appareil en ouvrant le site avec ?admin (désactivé avec ?admin=0).
const params = new URLSearchParams(location.search);
const ADMIN = (() => {
  try {
    if (params.has('admin')) params.get('admin') === '0' ? localStorage.removeItem('ncaa-admin') : localStorage.setItem('ncaa-admin', '1');
    return localStorage.getItem('ncaa-admin') === '1';
  } catch {
    return params.has('admin') && params.get('admin') !== '0';
  }
})();

// ---------- liens ----------
function youtubeLinks(g) {
  const yt = state.config.youtube ?? {};
  const date = noon(g.date_et).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const fill = (q) => q.replace('{home}', teamName(g.home.name)).replace('{away}', teamName(g.away.name)).replace('{date}', date);
  const query = fill(yt.query ?? '{home} vs {away} women\'s basketball {date}');
  // Un seul bouton : la vidéo trouvée sur la chaîne de référence par le pipeline, sinon la recherche générale.
  if (g.youtube?.url) return [{ label: yt.label ?? 'YouTube', url: g.youtube.url, title: g.youtube.title }];
  return [{ label: yt.label ?? 'YouTube', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, title: 'Recherche YouTube' }];
}

// Bouton « Clipper » (mode éditeur) : ouvre l'outil de clipping local avec la vidéo du match complet,
// le play-by-play ESPN, le nom et le numéro de la joueuse. Seulement si la vidéo est un match complet.
function clipLink(g, l) {
  const clip = state.config.clipping;
  if (!ADMIN || !clip?.url || !l || l.status !== 'played') return null;
  if (!g.youtube?.url || g.youtube.kind !== 'full' || !g.links?.espn_pbp) return null;
  const q = new URLSearchParams({
    video: g.youtube.url,
    pbp: g.links.espn_pbp,
    name: state.byId.get(l.player_id)?.name ?? '',
    number: l.jersey ?? '',
    team: g.home.team === l.team ? '1' : '2', // play-by-play ESPN : équipe 1 = à domicile
    t: Date.now().toString(36), // adresse unique : Chrome ne ressert jamais une ancienne page de l'outil
  });
  return { label: clip.label ?? 'Clipper', url: `${clip.url}?${q}`, title: 'Ouvrir dans l\'outil de clipping (vidéo, play-by-play et joueuse préremplis)' };
}

function gameLinks(g, team, line) {
  // Une seule source de liens par match : ESPN s'il a le match, sinon le site de la fac.
  const fac = g.links?.fac?.[team] ?? Object.values(g.links?.fac ?? {})[0];
  const src = g.links?.espn_box
    ? { pbp: g.links.espn_pbp, box: g.links.espn_box, name: 'ESPN' }
    : { pbp: fac?.pbp, box: fac?.box ?? g.links?.official_box, name: 'site de la fac' };
  const out = [];
  // Sidearm « Nuxt » : le play-by-play est un onglet sans URL propre, même page que le box score.
  if (src.pbp && src.pbp === src.box) out.push({ label: 'Box score + play-by-play (onglet)', url: src.box, title: `Ouvrir puis cliquer sur l'onglet « Play-by-play » (${src.name})` });
  else {
    if (src.pbp) out.push({ label: 'Play-by-play', url: src.pbp, title: `Play-by-play (${src.name})` });
    if (src.box) out.push({ label: 'Box score', url: src.box, title: `Box score (${src.name})` });
  }
  const clip = clipLink(g, line);
  return [...out, ...youtubeLinks(g), ...(clip ? [clip] : [])];
}
const linksHTML = (g, team, line) =>
  `<div class="links">${gameLinks(g, team, line).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener"${l.title ? ` title="${esc(l.title)}"` : ''}>${esc(l.label)}</a>`).join('')}</div>`;

// ---------- calculs ----------
function perspective(g, team) {
  const us = g.home.team === team ? g.home : g.away;
  const them = us === g.home ? g.away : g.home;
  const where = g.neutral ? 'vs' : us === g.home ? 'vs' : 'à';
  const res = us.score != null && them.score != null ? (us.score > them.score ? 'V' : us.score < them.score ? 'D' : 'N') : '';
  return { us, them, where, res };
}

function isBig(s) {
  if (!s) return { big: false, tags: [] };
  const tens = ['pts', 'reb', 'ast', 'stl', 'blk'].filter((k) => s[k] >= 10).length;
  const tags = [];
  if (s.pts >= (state.config.highlight?.points ?? 20)) tags.push(`${s.pts} pts`);
  if (tens >= 3) tags.push('Triple-double');
  else if (tens === 2) tags.push('Double-double');
  return { big: tags.length > 0, tags };
}

// Toutes les lignes d'une joueuse, du plus ancien au plus récent.
function playerLog(id) {
  return state.games
    .filter((g) => g.lines?.[id])
    .map((g) => ({ g, l: g.lines[id] }))
    .sort((a, b) => a.g.date_et.localeCompare(b.g.date_et));
}

function averages(id) {
  const played = playerLog(id).filter((x) => x.l.status === 'played' && x.l.stats);
  const n = played.length;
  const sum = (k) => played.reduce((a, x) => a + (x.l.stats[k] ?? 0), 0);
  const avg = (k) => (n ? sum(k) / n : NaN);
  return {
    gp: n,
    gs: played.filter((x) => x.l.starter).length,
    min: avg('min'), pts: avg('pts'), reb: avg('reb'), oreb: avg('oreb'), dreb: avg('dreb'),
    ast: avg('ast'), stl: avg('stl'), blk: avg('blk'), to: avg('to'), pf: avg('pf'),
    fgm: sum('fgm'), fga: sum('fga'), tpm: sum('tpm'), tpa: sum('tpa'), ftm: sum('ftm'), fta: sum('fta'),
  };
}

// ---------- composants ----------
const srcBadge = (l) => `<span class="badge src" title="Source des stats">${l.source === 'espn' ? 'ESPN' : l.source === 'fac' ? 'Site fac' : 'NCAA'}</span>`;
const statusText = (l) => (l.status === 'dnp' ? `N'a pas joué${l.reason ? ` (${esc(l.reason)})` : ''}` : 'Absente de la feuille de match');

function statlineHTML(s) {
  const cell = (k, v, sub = '') => `<div><dt>${k}</dt><dd>${v}${sub ? ` <span>${sub}</span>` : ''}</dd></div>`;
  return `<dl class="statline">
    ${cell('MIN', Math.round(s.min))}
    ${cell('REB', s.reb, `${s.oreb}/${s.dreb}`)}
    ${cell('PD', s.ast)}
    ${cell('INT', s.stl)}
    ${cell('CTR', s.blk)}
    ${cell('BP', s.to)}
    ${cell('FTE', s.pf)}
    ${cell('TIRS', `${s.fgm}-${s.fga}`)}
    ${cell('3 PTS', `${s.tpm}-${s.tpa}`)}
    ${cell('LF', `${s.ftm}-${s.fta}`)}
  </dl>`;
}

function gameMeta(g, team) {
  const { them, where, res, us } = perspective(g, team);
  const score = us.score != null ? `<span class="${res === 'V' ? 'res-w' : 'res-l'}">${res} ${us.score}-${them.score}</span>` : '';
  return `<div class="game-meta">${where} ${esc(teamName(them.name))}${g.neutral ? ' (terrain neutre)' : ''} · ${score}<br>${esc(dateFR(g.date_et))}${kickoff(g) ? ` · ${esc(kickoff(g))}` : ''}</div>`;
}

function cardHTML(g, l) {
  const p = state.byId.get(l.player_id);
  const s = l.stats;
  const { big, tags } = isBig(s);
  return `<article class="card${big ? ' big' : ''}">
    <div class="card-head">
      <div>
        <h3><a href="#/joueuse/${esc(l.player_id)}">${esc(p?.name ?? l.player_id)}</a></h3>
        <div class="team">${esc(l.team)}</div>
      </div>
      <div class="pts">${s.pts}<small>PTS</small></div>
    </div>
    ${gameMeta(g, l.team)}
    ${statlineHTML(s)}
    <div class="badges">${tags.map((t) => `<span class="badge accent">${esc(t)}</span>`).join('')}${l.starter ? '<span class="badge">Titulaire</span>' : '<span class="badge">Remplaçante</span>'}${srcBadge(l)}</div>
    ${linksHTML(g, l.team, l)}
  </article>`;
}

// ---------- pages ----------
function pageHome() {
  const days = [...new Set(state.games.filter((g) => Object.values(g.lines ?? {}).some((l) => l.status === 'played')).map((g) => g.date_et))].sort();
  const day = days.at(-1);
  if (!day) return `<h1>Derniers matchs</h1><p class="empty">Aucun match pour l'instant.</p>`;
  return dayView(day, { title: 'Derniers matchs', days });
}

function dayView(day, { title, days }) {
  const games = state.games.filter((g) => g.date_et === day);
  const lines = games.flatMap((g) => Object.values(g.lines ?? {}).map((l) => ({ g, l })));
  const played = lines.filter((x) => x.l.status === 'played' && x.l.stats).sort((a, b) => b.l.stats.pts - a.l.stats.pts || b.l.stats.reb - a.l.stats.reb);
  const others = lines.filter((x) => x.l.status !== 'played');
  const i = days.indexOf(day);
  return `<h1>${esc(title)}</h1>
    <p class="page-sub">${esc(dateFR(day))} (date US) · ${played.length} joueuse${played.length > 1 ? 's' : ''} sur le terrain</p>
    <div class="day-nav">
      ${i > 0 ? `<a class="btn ghost" href="#/calendrier/${days[i - 1]}">← ${esc(dateShortFR(days[i - 1]))}</a>` : ''}
      <a class="btn ghost" href="#/calendrier/${day}">Voir la journée au calendrier</a>
    </div>
    <div class="cards">${played.map(({ g, l }) => cardHTML(g, l)).join('') || '<p class="empty">Aucune Française n\'a joué ce jour-là.</p>'}</div>
    ${others.length ? `<div class="absents"><h2>N'ont pas joué</h2><ul>${others.map(({ g, l }) => `<li><a href="#/joueuse/${esc(l.player_id)}">${esc(state.byId.get(l.player_id)?.name ?? l.player_id)}</a> (${esc(l.team)}, ${perspective(g, l.team).where} ${esc(teamName(perspective(g, l.team).them.name))}) : ${statusText(l)}</li>`).join('')}</ul></div>` : ''}`;
}

function pagePlayer(id) {
  const p = state.byId.get(id);
  if (!p) return `<h1>Joueuse introuvable</h1><p><a href="#/tableau">Retour au tableau</a></p>`;
  const a = averages(id);
  const log = playerLog(id);
  const src = state.sources[p.team] ?? {};
  const bio = [
    ['Fac', `${p.team}${src.conference ? ` (${src.conference})` : ''}`],
    ['Poste', p.position], ['Taille', p.height ? `${p.height} (${toCm(p.height)})` : ''], ['Année', p.class],
    ['Ville d\'origine', p.hometown], ['Parcours', p.background], ['Note', p.note],
  ].filter(([, v]) => v);
  const av = (k, v) => `<div class="avg"><div class="v">${v}</div><div class="k">${k}</div></div>`;
  return `<p><a href="#/tableau">← Tableau général</a></p>
    <h1>${esc(p.name)}</h1>
    <dl class="bio">${bio.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${p.espn_athlete_id ? `<p class="links"><a href="https://www.espn.com/womens-college-basketball/player/_/id/${esc(p.espn_athlete_id)}" target="_blank" rel="noopener">Fiche ESPN</a></p>` : ''}
    <h2>Moyennes de la saison</h2>
    <div class="averages">
      ${av('Matchs (tit.)', `${a.gp} (${a.gs})`)}${av('Points', fmt1(a.pts))}${av('Rebonds', fmt1(a.reb))}
      ${av('Passes', fmt1(a.ast))}${av('Minutes', fmt1(a.min))}${av('Tirs', pct(a.fgm, a.fga))}
      ${av('3 pts', pct(a.tpm, a.tpa))}${av('LF', pct(a.ftm, a.fta))}${av('Interceptions', fmt1(a.stl))}
      ${av('Contres', fmt1(a.blk))}${av('Balles perdues', fmt1(a.to))}${av('Fautes', fmt1(a.pf))}
    </div>
    <h2>Points match par match</h2>
    ${log.length ? `<div class="chart-wrap">${pointsChart(log)}</div>` : '<p class="empty">Aucun match pour l\'instant.</p>'}
    <h2>Game log</h2>
    ${log.length ? gameLogTable(log) : '<p class="empty">Aucun match pour l\'instant.</p>'}`;
}

function toCm(h) {
  const m = /(\d+)-(\d+)/.exec(h);
  return m ? `${Math.round((Number(m[1]) * 12 + Number(m[2])) * 2.54)} cm` : '';
}

function pointsChart(log) {
  const W = Math.round(Math.min(900, Math.max(300, $main.clientWidth - 58))), H = 200, padL = 28, padB = 26, padT = 12;
  const max = Math.max(10, ...log.map((x) => x.l.stats?.pts ?? 0));
  const top = Math.ceil(max / 10) * 10;
  const n = log.length;
  const step = (W - padL - 8) / n;
  const bw = Math.min(28, step * 0.6);
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const ticks = [0, top / 2, top];
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Points marqués par match">`;
  for (const t of ticks) svg += `<line class="grid" x1="${padL}" x2="${W - 4}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${t.toLocaleString('fr-FR')}</text>`;
  log.forEach(({ g, l }, i) => {
    const x = padL + step * i + (step - bw) / 2;
    const v = l.status === 'played' ? l.stats.pts : 0;
    const { them, where } = perspective(g, l.team);
    const label = `${dateShortFR(g.date_et)} ${where} ${teamName(them.name)} : ${l.status === 'played' ? `${v} pts, ${l.stats.reb} reb, ${l.stats.ast} pd` : statusText(l)}`;
    const h = Math.max(0, y(0) - y(v));
    svg += `<rect class="bar-hit" x="${padL + step * i}" y="${padT}" width="${step}" height="${H - padT - padB}" data-tip="${esc(label)}"/>`;
    if (l.status === 'played' && h > 0) {
      const r = Math.min(4, bw / 2, h);
      svg += `<path class="bar" d="M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + bw - r} Q${x + bw},${y(v)} ${x + bw},${y(v) + r} V${y(0)} Z"/>`;
    } else {
      svg += `<rect class="zero" x="${x}" y="${y(0) - 2}" width="${bw}" height="2"/>`;
    }
    if (n <= 12 || i % Math.ceil(n / 12) === 0) svg += `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(dateShortFR(g.date_et))}</text>`;
  });
  return svg + '</svg>';
}

function gameLogTable(log) {
  const rows = [...log].reverse().map(({ g, l }) => {
    const { them, where, res, us } = perspective(g, l.team);
    const s = l.stats;
    const { big } = isBig(s);
    const links = gameLinks(g, l.team, l).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a>`).join(' · ');
    const stats = s
      ? `<td>${l.starter ? 'oui' : ''}</td><td>${Math.round(s.min)}</td><td class="hl">${s.pts}</td><td>${s.reb} <span class="muted">(${s.oreb}/${s.dreb})</span></td><td>${s.ast}</td><td>${s.stl}</td><td>${s.blk}</td><td>${s.to}</td><td>${s.pf}</td><td>${s.fgm}-${s.fga}</td><td>${s.tpm}-${s.tpa}</td><td>${s.ftm}-${s.fta}</td>`
      : `<td colspan="12" class="l muted">${statusText(l)}</td>`;
    return `<tr class="${big ? 'big' : ''}"><td class="first-col">${esc(dateShortFR(g.date_et))}</td><td class="l">${where} ${esc(teamName(them.name))}</td><td class="l">${us.score != null ? `${res} ${us.score}-${them.score}` : ''}</td>${stats}<td class="l">${srcBadge(l)}</td><td class="l">${links}</td></tr>`;
  });
  return `<div class="table-wrap"><table>
    <thead><tr><th class="first-col">Date</th><th class="l">Adversaire</th><th class="l">Score</th><th>Tit.</th><th>MIN</th><th>PTS</th><th>REB (O/D)</th><th>PD</th><th>INT</th><th>CTR</th><th>BP</th><th>FTE</th><th>TIRS</th><th>3 PTS</th><th>LF</th><th class="l">Source</th><th class="l">Liens</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>`;
}

// ---------- tableau général ----------
const tableState = { sort: 'pts', dir: -1, fac: '', conf: '', pos: '' };
const COLS = [
  ['name', 'Joueuse', 'l'], ['gp', 'MJ'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'PD'], ['min', 'MIN'],
  ['stl', 'INT'], ['blk', 'CTR'], ['to', 'BP'], ['fgp', 'Tirs %'], ['tpp', '3 pts %'], ['ftp', 'LF %'],
  ['team', 'Fac', 'l'], ['conf', 'Conf.', 'l'], ['position', 'Poste', 'l'],
];

const posGroup = (p) => {
  const s = String(p ?? '').toUpperCase();
  if (/AILI|^F$|^F\//.test(s) || s === 'F') return 'Ailière (F)';
  if (s.startsWith('G')) return s.includes('F') ? 'Arrière/ailière (G/F)' : 'Arrière (G)';
  if (s.startsWith('C')) return 'Pivot (C)';
  return s ? s : 'Non précisé';
};

function tableRows() {
  return state.players.map((p) => {
    const a = averages(p.id);
    return {
      id: p.id, name: p.name, team: p.team, conf: state.sources[p.team]?.conference ?? '', position: p.position, pos: posGroup(p.position),
      gp: a.gp, min: a.min, pts: a.pts, reb: a.reb, ast: a.ast, stl: a.stl, blk: a.blk, to: a.to,
      fgp: a.fga ? a.fgm / a.fga : NaN, tpp: a.tpa ? a.tpm / a.tpa : NaN, ftp: a.fta ? a.ftm / a.fta : NaN,
    };
  });
}

function pageTable() {
  const all = tableRows();
  const opts = (vals, cur) => [...new Set(vals)].filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr')).map((v) => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const { fac, conf, pos, sort, dir } = tableState;
  const rows = all
    .filter((r) => (!fac || r.team === fac) && (!conf || r.conf === conf) && (!pos || r.pos === pos))
    .sort((a, b) => {
      const x = a[sort], y = b[sort];
      if (typeof x === 'string') return dir * x.localeCompare(y, 'fr');
      const nx = Number.isFinite(x) ? x : -Infinity, ny = Number.isFinite(y) ? y : -Infinity;
      return dir * (nx - ny) || a.name.localeCompare(b.name, 'fr');
    });
  const val = (r, k) => {
    if (['fgp', 'tpp', 'ftp'].includes(k)) return Number.isFinite(r[k]) ? `${(r[k] * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}` : '–';
    if (['name'].includes(k)) return `<a href="#/joueuse/${esc(r.id)}">${esc(r.name)}</a>`;
    if (typeof r[k] === 'string') return esc(r[k]);
    if (k === 'gp') return r.gp;
    return r.gp ? fmt1(r[k]) : '–';
  };
  return `<h1>Tableau général</h1>
    <p class="page-sub">${state.players.length} joueuses · moyennes par match joué</p>
    <div class="filters" role="group" aria-label="Filtres">
      <label>Fac<select data-filter="fac" class="${fac ? 'active' : ''}"><option value="">Toutes</option>${opts(all.map((r) => r.team), fac)}</select></label>
      <label>Conférence<select data-filter="conf" class="${conf ? 'active' : ''}"><option value="">Toutes</option>${opts(all.map((r) => r.conf), conf)}</select></label>
      <label>Poste<select data-filter="pos" class="${pos ? 'active' : ''}"><option value="">Tous</option>${opts(all.map((r) => r.pos), pos)}</select></label>
      ${fac || conf || pos ? '<button class="btn ghost" data-reset>Réinitialiser</button>' : ''}
    </div>
    <div class="table-wrap"><table>
      <thead><tr>${COLS.map(([k, label, cls], i) => `<th class="${cls ?? ''}${i === 0 ? ' first-col' : ''}" aria-sort="${k === sort ? (dir < 0 ? 'descending' : 'ascending') : 'none'}"><button data-sort="${k}">${label}</button></th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${COLS.map(([k, , cls], i) => `<td class="${cls ?? ''}${i === 0 ? ' first-col' : ''}">${val(r, k)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
}

$main.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sort]');
  if (b) {
    const k = b.dataset.sort;
    tableState.dir = tableState.sort === k ? -tableState.dir : ['name', 'team', 'conf', 'position'].includes(k) ? 1 : -1;
    tableState.sort = k;
    render();
    document.querySelector(`[data-sort="${k}"]`)?.focus();
  }
  if (e.target.closest('[data-reset]')) {
    Object.assign(tableState, { fac: '', conf: '', pos: '' });
    render();
  }
});
$main.addEventListener('change', (e) => {
  const f = e.target.dataset?.filter;
  if (f) {
    tableState[f] = e.target.value;
    render();
    document.querySelector(`[data-filter="${f}"]`)?.focus();
  }
  if (e.target.id === 'day-picker' && e.target.value) location.hash = `#/calendrier/${e.target.value}`;
});

// ---------- calendrier ----------
function pageCalendar(day) {
  const days = [...new Set(state.games.map((g) => g.date_et))].sort();
  const d = day ?? days.at(-1) ?? new Date().toISOString().slice(0, 10);
  const games = state.games.filter((g) => g.date_et === d).sort((a, b) => (a.tipoff_utc ?? '').localeCompare(b.tipoff_utc ?? ''));
  const i = days.indexOf(d);
  const prev = i > 0 ? days[i - 1] : days.filter((x) => x < d).at(-1);
  const next = i >= 0 ? days[i + 1] : days.find((x) => x > d);
  const block = (g) => {
    const lines = Object.values(g.lines ?? {}).sort((a, b) => (b.stats?.pts ?? -1) - (a.stats?.pts ?? -1));
    const team = lines[0]?.team ?? g.teams[0];
    return `<section class="game-block">
      <h3>${esc(teamName(g.away.name))} ${g.away.score ?? ''} ${g.neutral ? 'vs' : '@'} ${esc(teamName(g.home.name))} ${g.home.score ?? ''}</h3>
      <div class="game-meta">${kickoff(g) ? esc(kickoff(g)) : ''}${g.neutral ? ' · terrain neutre' : ''}</div>
      <ul>${lines.map((l) => {
        const s = l.stats;
        const { big, tags } = isBig(s);
        return `<li><a href="#/joueuse/${esc(l.player_id)}"><strong>${esc(state.byId.get(l.player_id)?.name ?? l.player_id)}</strong></a>
          <span class="muted">${esc(l.team)}</span>
          ${s ? `<span${big ? ' style="color:var(--t6-green);font-weight:700"' : ''}>${s.pts} pts, ${s.reb} reb, ${s.ast} pd · ${Math.round(s.min)} min · ${s.fgm}-${s.fga} tirs</span>${tags.map((t) => `<span class="badge accent">${esc(t)}</span>`).join('')}` : `<span class="muted">${statusText(l)}</span>`}
          ${srcBadge(l)}${(() => { const c = clipLink(g, l); return c ? ` <a href="${esc(c.url)}" target="_blank" rel="noopener" title="${esc(c.title)}">${esc(c.label)}</a>` : ''; })()}</li>`;
      }).join('')}</ul>
      ${linksHTML(g, team)}
    </section>`;
  };
  return `<h1>Calendrier</h1>
    <div class="day-nav">
      ${prev ? `<a class="btn ghost" href="#/calendrier/${prev}" aria-label="Journée précédente">← ${esc(dateShortFR(prev))}</a>` : ''}
      <label class="filters" style="margin:0"><span class="sr">Date</span><input type="date" id="day-picker" class="active" value="${d}" min="2026-11-02" max="2027-04-30"></label>
      ${next ? `<a class="btn ghost" href="#/calendrier/${next}" aria-label="Journée suivante">${esc(dateShortFR(next))} →</a>` : ''}
    </div>
    <p class="page-sub">${esc(dateFR(d))} (date US Eastern) · ${games.length} match${games.length > 1 ? 's' : ''}</p>
    ${games.map(block).join('') || '<p class="empty">Aucun match de Française enregistré ce jour-là.</p>'}`;
}

// ---------- infobulle du graphique ----------
function showTip(e) {
  const t = e.target.closest?.('[data-tip]');
  if (!t) return hideTip();
  $tip.textContent = t.dataset.tip;
  $tip.hidden = false;
  const r = t.getBoundingClientRect();
  const x = Math.min(window.innerWidth - $tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - $tip.offsetWidth / 2));
  $tip.style.left = `${x}px`;
  $tip.style.top = `${Math.max(8, r.top - $tip.offsetHeight - 8)}px`;
  t.nextElementSibling?.classList?.add('on');
}
function hideTip() {
  $tip.hidden = true;
  document.querySelectorAll('.bar.on').forEach((b) => b.classList.remove('on'));
}
$main.addEventListener('pointerover', (e) => { hideTip(); showTip(e); });
$main.addEventListener('pointerleave', hideTip);
window.addEventListener('scroll', hideTip, { passive: true });

// ---------- routeur ----------
function render() {
  const [, page, arg] = location.hash.replace(/^#\/?/, '#/').split('/');
  let html;
  let nav = 'home';
  if (page === 'joueuse') { html = pagePlayer(decodeURIComponent(arg ?? '')); nav = ''; }
  else if (page === 'tableau') { html = pageTable(); nav = 'tableau'; }
  else if (page === 'calendrier') { html = pageCalendar(arg); nav = 'calendrier'; }
  else html = pageHome();
  $main.innerHTML = html;
  document.querySelectorAll('[data-nav]').forEach((a) => (a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const p = page === 'joueuse' ? state.byId.get(decodeURIComponent(arg ?? '')) : null;
  document.title = `${p ? `${p.name} · ` : ''}Les Françaises en NCAA`;
}

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  render();
  if (location.hash.split('/')[1] !== lastHash.split('/')[1]) window.scrollTo(0, 0);
  lastHash = location.hash;
});

async function load() {
  const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${u} : ${r.status}`);
    return r.json();
  });
  try {
    const [players, games, sources, config] = await Promise.all([
      get('data/players.json'), get('data/games.json'), get('data/sources.json'), get('config/site.json'),
    ]);
    state.players = players.filter((p) => p.active !== false);
    state.byId = new Map(players.map((p) => [p.id, p]));
    state.games = games.games ?? [];
    state.sources = sources.teams ?? {};
    state.config = config;
    state.updated = games.updated ?? null;
    if (games.updated) {
      const u = new Date(games.updated);
      document.getElementById('updated').textContent = `Mis à jour le ${updatedText(u)}`;
      $refreshInfo.textContent = `Données du ${updatedText(u)}`;
    }
    render();
  } catch (e) {
    $main.innerHTML = `<p class="empty">Les données n'ont pas pu être chargées (${esc(e.message)}).</p>`;
  }
}

const updatedText = (u) => `${u.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })} à ${timeParis(u)}`;

// ---------- bouton « Actualiser » (réservé à l'éditeur) ----------
// Il ouvre la page GitHub de l'Action (bouton « Run workflow »), puis recharge le site
// tout seul dès que les nouvelles données sont publiées.
const $refresh = document.getElementById('refresh');
const $refreshBtn = document.getElementById('refresh-btn');
const $refreshInfo = document.getElementById('refresh-info');
$refresh.hidden = !ADMIN;

let polling = null;
$refreshBtn.addEventListener('click', async () => {
  const url = state.config.update_workflow_url;
  if (url) window.open(url, '_blank', 'noopener');
  const before = state.updated;
  $refreshBtn.disabled = true;
  $refreshInfo.textContent = url
    ? 'Sur GitHub, cliquer « Run workflow ». Le site se rechargera tout seul (5 à 10 min).'
    : 'Rechargement des données…';
  await load();
  if (!url) {
    $refreshBtn.disabled = false;
    return;
  }
  clearInterval(polling);
  const started = Date.now();
  polling = setInterval(async () => {
    try {
      const r = await fetch('data/games.json', { cache: 'no-cache' }).then((x) => x.json());
      if (r.updated && r.updated !== before) {
        clearInterval(polling);
        await load();
        $refreshInfo.textContent = `Site actualisé : données du ${updatedText(new Date(r.updated))}`;
        $refreshBtn.disabled = false;
      }
    } catch { /* réessai au prochain tour */ }
    if (Date.now() - started > 20 * 60 * 1000) {
      clearInterval(polling);
      $refreshInfo.textContent = 'Pas de nouvelles données après 20 min : vérifier l\'Action sur GitHub.';
      $refreshBtn.disabled = false;
    }
  }, 30000);
});

load();
