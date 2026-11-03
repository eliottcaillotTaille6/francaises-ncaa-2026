// Assemble le site statique dans _site/ : public/ + les JSON publics + la config.
import fs from 'node:fs';

const OUT = '_site';
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync('public', OUT, { recursive: true });
fs.mkdirSync(`${OUT}/data`, { recursive: true });
fs.mkdirSync(`${OUT}/config`, { recursive: true });
for (const f of ['games.json', 'players.json', 'sources.json']) fs.copyFileSync(`data/${f}`, `${OUT}/data/${f}`);
fs.copyFileSync('config/site.json', `${OUT}/config/site.json`);
fs.writeFileSync(`${OUT}/.nojekyll`, '');
console.log(`Site prêt dans ${OUT}/`);
