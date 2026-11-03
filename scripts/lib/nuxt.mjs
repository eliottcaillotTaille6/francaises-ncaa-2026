// Décodage du bloc <script id="__NUXT_DATA__"> (format « devalue » de Nuxt 3) :
// un tableau plat où les objets référencent les autres valeurs par leur index.

const WRAPPERS = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'NuxtError']);

export function extractNuxtData(html) {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  return decodeDevalue(JSON.parse(m[1]));
}

export function decodeDevalue(arr) {
  const cache = new Map();
  const resolve = (i) => {
    if (typeof i !== 'number' || i < 0) return i === -1 ? undefined : i;
    if (cache.has(i)) return cache.get(i);
    const v = arr[i];
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && WRAPPERS.has(v[0])) {
        const out = resolve(v[1]);
        cache.set(i, out);
        return out;
      }
      if (v[0] === 'Date') return new Date(v[1]).toISOString();
      if (v[0] === 'Set') return v.slice(1).map(resolve);
      if (v[0] === 'Map') return Object.fromEntries(chunk(v.slice(1)).map(([k, x]) => [resolve(k), resolve(x)]));
      const out = [];
      cache.set(i, out);
      for (const x of v) out.push(resolve(x));
      return out;
    }
    if (v && typeof v === 'object') {
      const out = {};
      cache.set(i, out);
      for (const [k, x] of Object.entries(v)) out[k] = resolve(x);
      return out;
    }
    return v;
  };
  return resolve(0);
}

const chunk = (a) => a.reduce((acc, x, i) => (i % 2 ? acc[acc.length - 1].push(x) : acc.push([x]), acc), []);
