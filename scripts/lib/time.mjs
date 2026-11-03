// Dates : la référence d'un match est sa date US Eastern (YYYY-MM-DD).

const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

export const etDate = (d) => etFmt.format(new Date(d));

export function todayET() {
  return etDate(Date.now());
}

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// « Nov 2 (Mon) » → 2026-11-02, l'année étant déduite de la saison 2026-27.
export function parseMonthDay(text, seasonStartYear = 2026) {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/.exec(text ?? '');
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const year = month >= 8 ? seasonStartYear : seasonStartYear + 1;
  return `${year}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}
