// Sonde la page calendrier de chaque fac et détecte la plateforme du site.
// Usage : node scripts/probe-sources.mjs [domaines.json]  → affiche un JSON de diagnostic.
import fs from 'node:fs';

const UA = 'Taille6-NCAA-Tracker/1.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const domains = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

function detect(html) {
  const marks = [];
  if (/sidearm/i.test(html)) marks.push('sidearm');
  if (/wmt\.(digital|games)|wmt-|"wmt"|wmtstatic|wmt_/i.test(html)) marks.push('wmt');
  if (/prestosports/i.test(html)) marks.push('presto');
  if (/__NEXT_DATA__/.test(html)) marks.push('nextjs');
  if (/__NUXT__/.test(html)) marks.push('nuxt');
  return marks;
}

const out = [];
for (const [team, domain] of Object.entries(domains)) {
  const url = `https://${domain}/sports/womens-basketball/schedule/2026-27`;
  const row = { team, domain, url };
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const html = await res.text();
    row.status = res.status;
    row.final = res.url;
    row.size = html.length;
    row.marks = detect(html);
    row.boxLinks = (html.match(/boxscore/gi) ?? []).length;
    row.title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim().slice(0, 80);
  } catch (e) {
    row.error = String(e.message ?? e);
  }
  out.push(row);
  console.error(`${row.status ?? 'ERR'} ${team} ${row.final ?? row.error} ${row.marks ?? ''} box=${row.boxLinks ?? ''}`);
  await sleep(800);
}
console.log(JSON.stringify(out, null, 2));
