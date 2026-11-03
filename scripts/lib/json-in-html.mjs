// Extraction d'un objet JSON littéral embarqué dans du JavaScript inline.

// Renvoie l'objet JSON qui commence à l'index `start` (un « { »), en respectant chaînes et échappements.
export function readJsonObject(text, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < text.length; j++) {
    const c = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, j + 1));
  }
  return null;
}

// Sidearm « Vue » : le calendrier est passé au composant sous la forme `schedule : {...}`.
export function extractSidearmVueSchedule(html) {
  const m = /schedule\s*:\s*\{"id"/.exec(html);
  if (!m) return null;
  return readJsonObject(html, html.indexOf('{', m.index));
}
