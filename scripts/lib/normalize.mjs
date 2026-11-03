// Normalisation des noms de joueuses et d'équipes pour l'appariement.

export function normalizeName(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'") // apostrophes typographiques
    .replace(/[‐-―]/g, '-') // tirets typographiques
    .replace(/[.']/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Clé compacte : sans espaces, pour rapprocher « Le Guen » / « LeGuen ».
export const compactName = (s) => normalizeName(s).replace(/ /g, '');

export function slugify(s) {
  return normalizeName(s).replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
}

// Découpe un nom de box score : « NOM, Prénom », « P. Nom », « Prénom Nom ».
export function parseBoxName(raw) {
  const s = String(raw ?? '').trim();
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((x) => x.trim());
    return { first: normalizeName(first), last: normalizeName(last) };
  }
  const parts = s.split(/\s+/);
  return { first: normalizeName(parts[0]), last: normalizeName(parts.slice(1).join(' ')) };
}
