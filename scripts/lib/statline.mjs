// Ligne de stats commune à toutes les sources.

const num = (v) => {
  if (v === null || v === undefined || v === '' || v === '-' || v === '--') return 0;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
};

// « 4-9 » ou « 4 - 9 » → [4, 9]
export const pair = (v) => {
  const m = /(\d+)\s*-\s*(\d+)/.exec(String(v ?? ''));
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
};

// « 25:32 » → 25.5 ; « 22 » → 22
export const minutes = (v) => {
  const s = String(v ?? '').trim();
  const m = /^(\d+):(\d{2})$/.exec(s);
  if (m) return Math.round((Number(m[1]) + Number(m[2]) / 60) * 10) / 10;
  return num(s);
};

export function makeLine(o) {
  const line = {
    min: minutes(o.min),
    pts: num(o.pts),
    fgm: num(o.fgm), fga: num(o.fga),
    tpm: num(o.tpm), tpa: num(o.tpa),
    ftm: num(o.ftm), fta: num(o.fta),
    oreb: num(o.oreb), dreb: num(o.dreb), reb: num(o.reb),
    ast: num(o.ast), stl: num(o.stl), blk: num(o.blk), to: num(o.to), pf: num(o.pf),
  };
  if (!line.reb && (line.oreb || line.dreb)) line.reb = line.oreb + line.dreb;
  return line;
}

export const isEmptyLine = (l) => !l.min && !l.pts && !l.fga && !l.fta && !l.reb && !l.ast && !l.pf && !l.to;
