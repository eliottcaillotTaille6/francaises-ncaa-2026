// Convertit l'onglet « Joueuses » du fichier Excel en data/players.json.
// Usage : node scripts/import-players.mjs [chemin.xlsx]
// Conserve les champs ESPN déjà remplis si players.json existe.
import fs from 'node:fs';
import XLSX from 'xlsx';
import { slugify } from './lib/normalize.mjs';

const src = process.argv[2] ?? 'data/source-joueuses.xlsx';
const out = 'data/players.json';

const wb = XLSX.readFile(src);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Joueuses'], { defval: '' });

const previous = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : [];
const prevById = new Map(previous.map((p) => [p.id, p]));

// Joueuses retirées définitivement du site (config/site.json → excluded_players).
const excluded = new Set(JSON.parse(fs.readFileSync('config/site.json', 'utf8')).excluded_players ?? []);

const players = rows.filter((r) => !excluded.has(slugify(r['Joueuse']))).map((r) => {
  const id = slugify(r['Joueuse']);
  const prev = prevById.get(id) ?? {};
  return {
    id,
    name: r['Joueuse'],
    team: r['Fac (2026-27)'],
    position: r['Poste'],
    height: r['Taille (ft-in)'],
    class: r['Année'],
    hometown: r["Ville d'origine"],
    background: r['Parcours avant la fac actuelle'],
    status: r['Statut'],
    note: r['Note'],
    source: r['Source'],
    active: prev.active ?? true,
    espn_athlete_id: prev.espn_athlete_id ?? '',
    espn_team_id: prev.espn_team_id ?? '',
  };
});

const ids = new Set();
for (const p of players) {
  if (ids.has(p.id)) throw new Error(`Identifiant en double : ${p.id}`);
  ids.add(p.id);
}

fs.writeFileSync(out, JSON.stringify(players, null, 2) + '\n');
console.log(`${players.length} joueuses écrites dans ${out}`);
