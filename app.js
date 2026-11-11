// Felucca Tree — loads data/tree.json (built by scripts/build-data.mjs) and draws
// the lineage as a phylogram, like an evolutionary tree or a browser family timeline:
//   • time runs left → right; each project is a line from creation to its last update
//   • rows come from a depth-first walk, so every family stays together
//   • within a family the newest fork sits closest to its parent, which means
//     a fork's vertical connector never crosses another project's line
// Smaller projects fold into "Other N" by an invisible weight (stars + forks over the subtree).

import { LANGS, t, setLanguage, getLang, locale, translatePage } from './i18n.js';
const DATA_URL = 'data/tree.json';
const MAIN_COUNT = 30;   // projects shown individually in "Main" mode
const HEAVY_COUNT = 8;   // heaviest projects get a bolder name

// ---------- Helpers ----------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svgNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => { const e = document.createElementNS(svgNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
// Fukiai icon font glyphs (Private Use code points from hugelton/Fukiai glyphs.json).
const GLYPH = { checkmark: 0xEA2E, link: 0xEB02, star_fill: 0xEA64, send: 0xEB2E, clock: 0xEA42, home: 0xEB3D, person: 0xEADD, download: 0xEAD4, play: 0xEA08, tag: 0xEAE0, sparkles: 0xEAFF, upload: 0xEAD5 };
// GitHub has no Fukiai glyph: its mark as inline SVG.
const githubMark = () => { const s = svgEl('svg', { class: 'gh-mark', viewBox: '0 0 16 16', 'aria-hidden': 'true' }); s.append(svgEl('path', { d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z' })); return s; };
const fi = name => { const i = document.createElement('i'); i.className = 'fi'; i.setAttribute('aria-hidden', 'true'); i.textContent = String.fromCodePoint(GLYPH[name]); return i; };
const icon = d => { const s = svgEl('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' }); s.append(svgEl('path', { d })); return s; };
const store = {
  get(k) { try { return localStorage.getItem('felucca-tree:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('felucca-tree:' + k, v); } catch {} }
};
const mqNarrow = matchMedia('(max-width: 680px)');
const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
const DAY = 86400000;
// Language: saved choice, else the browser's, else English.
const guessLang = () => {
  let saved = null;
  try { saved = localStorage.getItem('felucca-tree:lang'); } catch {}
  if (LANGS.includes(saved)) return saved;
  const nav = (navigator.languages || [navigator.language]).map(l => (l || '').slice(0, 2));
  return nav.find(l => LANGS.includes(l)) || 'en';
};
setLanguage(guessLang());
translatePage();
const fmtLong = ms => new Date(ms).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtDay = ms => new Date(ms).toLocaleDateString(locale(), { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtMonth = ms => new Date(ms).toLocaleDateString(locale(), { month: 'short', timeZone: 'UTC' });
const fmtNum = n => Number(n).toLocaleString(locale());
const numericId = (a, b) => a.localeCompare(b, 'en', { numeric: true });

// ---------- Load ----------
const statusEl = $('#status');
let raw;
try {
  const res = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  raw = await res.json();
} catch (err) {
  statusEl.classList.add('error');
  statusEl.textContent = t('loadError', { url: DATA_URL, error: err.message });
  throw err;
}
statusEl.remove();

// ---------- Model ----------
const projects = raw.projects.map(p => ({ ...p }));
const byId = new Map(projects.map(p => [p.id, p]));
for (const p of projects) if (p.parent && !byId.has(p.parent)) delete p.parent;
// "Built on" (split from / runs on a platform) hangs a parentless project under that platform.
// It is not lineage in the database, so it is drawn dotted and labelled as such.
for (const p of projects) if (!p.parent && p.builtOn && byId.has(p.builtOn)) { p.parent = p.builtOn; p.platform = p.builtOnRelation || 'component'; }
const children = new Map(projects.map(p => [p.id, []]));
for (const p of projects) if (p.parent) children.get(p.parent).push(p);
const parentOf = p => p.parent ? byId.get(p.parent) : null;
const ancestors = id => { const out = []; let p = byId.get(id); while ((p = parentOf(p))) out.push(p.id); return out; };
const descendants = id => { const out = []; const st = [...children.get(id)]; while (st.length) { const c = st.pop(); out.push(c.id); st.push(...children.get(c.id)); } return out; };

// Time: GitHub creation time. Undated projects start just after their parent
// (or at the very beginning) and are drawn hollow / dashed.
const firstMs = Math.min(...projects.filter(p => p.created).map(p => Date.parse(p.created)));
const timeOf = new Map();
const resolveTime = p => {
  if (timeOf.has(p.id)) return timeOf.get(p.id);
  const t = p.created ? Date.parse(p.created) : (parentOf(p) ? resolveTime(parentOf(p)) + 3600000 : firstMs);
  timeOf.set(p.id, t);
  return t;
};
projects.forEach(resolveTime);
const updatedMs = p => p.updated ? Date.parse(p.updated) : null;
// Versions = GitHub releases (oldest first), never before the project itself.
const versionsOf = new Map(projects.map(p => [p.id, (p.versions || [])
  .map(v => ({ name: v.name, t: Math.max(Date.parse(v.date), timeOf.get(p.id)), pre: !!v.pre || /alpha|beta|(^|[^a-z])rc\d*($|[^a-z])|preview|pre/i.test(v.name) }))
  .sort((a, b) => a.t - b.t)]));
// A line runs to the last update, and at least to its last fork so connectors attach.
const endOf = new Map();
const resolveEnd = p => {
  if (endOf.has(p.id)) return endOf.get(p.id);
  // Research prototypes and stock-firmware mods get no activity line, only their releases:
  // their dot (and the line down to any fork of theirs).
  // Their releases (recorded by hand for Groove OS and Baud Girl) still extend the line.
  const lastRelease = versionsOf.get(p.id).at(-1)?.t ?? 0;
  const activity = p.noLine || ['research', 'stock-mod'].includes(p.group) ? lastRelease : Math.max(updatedMs(p) ?? 0, lastRelease);
  const e = Math.max(timeOf.get(p.id), activity, ...children.get(p.id).map(c => timeOf.get(c.id)));
  endOf.set(p.id, e);
  return e;
};
projects.forEach(resolveEnd);
// The FM-1 went on sale at the end of June 2026 (orders open by June 30; announced June 14).
const FM1_ON_SALE = Date.parse('2026-06-30T00:00:00Z');
const minT = Math.min(...timeOf.values(), FM1_ON_SALE);
const maxT = Math.max(...endOf.values(), Date.now());
// Display time: proportional to real time, except quiet stretches longer than two days
// (e.g. the months of prehistory before Felucca) are shortened to two days.
const QUIET_CAP = 2 * DAY;
const evTimes = [...new Set([...timeOf.values(), ...endOf.values(), ...[...versionsOf.values()].flat().map(v => v.t), Date.now(), FM1_ON_SALE])].sort((a, b) => a - b);
const evDisp = [0];
for (let i = 1; i < evTimes.length; i++) evDisp.push(evDisp[i - 1] + Math.min(evTimes[i] - evTimes[i - 1], QUIET_CAP));
const segOf = (arr, v) => { let lo = 0, hi = arr.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m; else hi = m; } return lo; };
const dispOf = t => {
  if (t <= evTimes[0]) return t - evTimes[0];
  const last = evTimes.length - 1;
  if (t >= evTimes[last]) return evDisp[last] + (t - evTimes[last]);
  const k = segOf(evTimes, t), gap = evTimes[k + 1] - evTimes[k];
  return evDisp[k] + (t - evTimes[k]) * (Math.min(gap, QUIET_CAP) / gap);
};
const timeOfDisp = d => {
  if (d <= 0) return evTimes[0] + d;
  const last = evDisp.length - 1;
  if (d >= evDisp[last]) return evTimes[last] + (d - evDisp[last]);
  const k = segOf(evDisp, d), gap = evTimes[k + 1] - evTimes[k];
  return evTimes[k] + (d - evDisp[k]) * (gap / Math.min(gap, QUIET_CAP));
};
const statusOf = p => {
  const u = updatedMs(p);
  if (!u) return 'unknown';
  const d = (Date.now() - u) / DAY;
  return d < 0 ? 'unknown' : d <= 14 ? 'active' : 'inactive';
};

// Weight: stars + forks (GitHub forks or forks recorded here, whichever is larger),
// summed over the subtree, so a parent always outweighs its children.
// The Forks / Stars emphasis weighs by that count alone, so the shown set changes with it.
const ownWeight = {
  off: p => (p.stars || 0) + Math.max(p.forks || 0, children.get(p.id).length),
  forks: p => Math.max(p.forks || 0, children.get(p.id).length),
  stars: p => p.stars || 0
};
const weights = {}, thresholds = {};
for (const [kind, own] of Object.entries(ownWeight)) {
  // Off: summed over the subtree. Forks / Stars: the largest single count in the subtree,
  // so the top projects by that count show (with the line leading to them) and the rest fold.
  const m = new Map(), sum = kind === 'off';
  const weigh = p => {
    if (m.has(p.id)) return m.get(p.id);
    const kids = children.get(p.id).map(weigh);
    const w = sum ? own(p) + kids.reduce((a, b) => a + b, 0) : Math.max(own(p), ...kids);
    m.set(p.id, w);
    return w;
  };
  projects.forEach(weigh);
  const r = sum ? [...projects].map(p => m.get(p.id)) : projects.map(own);
  r.sort((a, b) => b - a);
  weights[kind] = m;
  thresholds[kind] = Math.max(1, r[Math.min(MAIN_COUNT, r.length) - 1]);
}
let weight = weights.off, threshold = thresholds.off;
const ranked = [...projects].sort((a, b) => weight.get(b.id) - weight.get(a.id));
const heavy = new Set(ranked.slice(0, HEAVY_COUNT).map(p => p.id));
const roots = projects.filter(p => !p.parent);
// Not custom firmware in itself (a BSP, platform, template or library): names in italics.
const NOT_CFW = new Set(['bsp', 'platform', 'component', 'tool', 'record']);
const isBase = p => NOT_CFW.has(p.kind);
// Code exchange between lines: uptake (code copied in), shared code, influence, merge back.
// Data update dates (UTC midnight of each): a faint dated line for each.
const SNAPS = (raw.snapshots || []).map(d => Date.parse(d + 'T00:00:00Z')).filter(Number.isFinite);
// About: how many firmware have actually been released (at least one release), and as of when.
const releasedFirmware = projects.filter(p => !isBase(p) && versionsOf.get(p.id).length).length;
// Headline counts roll up from zero when they come into view.
const countUp = (node, to, dur = 900) => {
  const fmt = n => fmtNum(Math.round(n));
  if (mqReduce.matches) { node.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    node.textContent = fmt(to * e);
    if (p < 1) requestAnimationFrame(step);
  };
  node.textContent = '0';
  requestAnimationFrame(step);
};
// The same numbers seen another way. The FM-1 price is the usual street price (about $70).
const FM1_PRICE = 70;
const otherAngles = () => {
  const fw = projects.filter(p => !isBase(p));
  const authors = new Set(fw.map(p => (p.author || '').toLowerCase()).filter(Boolean)).size;
  const since = timeOf.get('F:1'), until = SNAPS.at(-1) ?? Date.now();
  const hours = Math.max(1, (until + DAY - since) / 3600000);
  const born = fw.filter(p => p.created && timeOf.get(p.id) >= since).length;
  const releases = fw.flatMap(p => versionsOf.get(p.id)).filter(v => v.t >= since).length;
  const code = fw.reduce((n, p) => n + (p.codeBytes || 0), 0);
  const num = n => fmtNum(Math.round(n));
  const one = n => n.toLocaleString(locale(), { maximumFractionDigits: 1 });
  // [value, what it means]
  return [
    [t('angleDays', one(releasedFirmware / 24)), t('angleDaysText')],
    [`$${num(authors * FM1_PRICE)}`, t('angleMoneyText', num(authors))],
    [t('angleHours', one(hours / born)), t('angleHoursText')],
    [t('angleMinutes', num(hours * 60 / releases)), t('angleMinutesText')],
    code ? [t('angleLines', code / 30), t('angleLinesText')] : null
  ].filter(Boolean);
};
const angleTiles = () => {
  const box = el('div', 'angles');
  for (const [v, label] of otherAngles()) {
    const t = el('div', 'angle');
    t.append(el('b', null, v), el('span', null, label));
    box.append(t);
  }
  return box;
};
const exchanges = (raw.exchanges || []).filter(x => byId.has(x.from) && byId.has(x.to));
const codeFrom = new Map(), codeTo = new Map();
for (const x of exchanges) {
  if (!codeFrom.has(x.to)) codeFrom.set(x.to, []);
  if (!codeTo.has(x.from)) codeTo.set(x.from, []);
  codeFrom.get(x.to).push(x);
  codeTo.get(x.from).push(x);
}

const relationText = p => {
  const par = parentOf(p);
  if (!par) return p.summary ?? {
    research: t('research'),
    'stock-mod': t('stockMod'),
    official: t('official'),
    bsp: t('bsp'),
    unplaced: null
  }[p.group] ?? (children.get(p.id).length ? t('original') : null);
  // [key of the relation, parent]: keys are i18n keys (splitFrom, builtOn, forkOf...).
  if (p.platform) return [p.platform === 'extraction' ? 'splitFrom' : 'builtOn', par];
  if (p.tentative) return ['possiblyFrom', par];
  return [{ fork: 'forkOf', port: 'portOf', variant: 'variantOf' }[p.relation] ?? 'basedOn', par];
};

// ---------- Lineage colors ----------
// A few projects have fixed colors; every other project inherits its parent's color,
// mixed with the projects it took code from or was influenced by (lateral relations),
// and siblings are nudged apart in hue. Mixing happens in OKLab so blends stay natural.
const ANCHORS = {
  //        dark mode    light mode
  'F:1': ['#22d3ee', '#0891b2'],   // Felucca: cyan
  'P:6': ['#ff453a', '#d70015'],   // Groove OS: red
  'F:3': ['#ff8a75', '#e05a45'],   // Melodee: salmon
  'F:5': ['#39ff14', '#1fa80a'],   // X0X: neon green
  'S:1': ['#ffffff', '#2c2c2e'],   // SLOOP: white (ink on a light background)
  'T:3': ['#ff9f0a', '#c93400'],   // IND-1: orange
  'Z:2': ['#ffe9a8', '#a8862a']    // AMB-1: cream yellow
};
const MIX_WEIGHT = { uptake: 0.35, 'shared-code': 0.35, influence: 0.2, component: 0.15, extraction: 0.6 };

const srgbToLin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const linToSrgb = c => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
function hexToOklab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => srgbToLin(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function oklabToCss([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return '#' + rgb.map(c => Math.round(clamp(linToSrgb(clamp(c, 0, 1)), 0, 1) * 255).toString(16).padStart(2, '0')).join('');
}
const toLch = ([L, a, b]) => [L, Math.hypot(a, b), Math.atan2(b, a)];
const fromLch = ([L, C, h]) => [L, C * Math.cos(h), C * Math.sin(h)];

function lineageColors(mode) {
  const col = mode === 'dark' ? 0 : 1;
  const out = new Map(), busy = new Set();
  const rootList = projects.filter(p => !p.parent);
  const colorOf = p => {
    if (out.has(p.id)) return out.get(p.id);
    if (ANCHORS[p.id]) { const c = hexToOklab(ANCHORS[p.id][col]); out.set(p.id, c); return c; }
    if (busy.has(p.id)) return null;   // a cycle through lateral relations
    busy.add(p.id);
    const parts = [];
    const par = parentOf(p);
    if (par) parts.push([colorOf(par), 1]);
    for (const [src, rel] of p.mix || []) {
      const c = byId.has(src) ? colorOf(byId.get(src)) : null;
      if (c) parts.push([c, MIX_WEIGHT[rel] ?? 0.2]);
    }
    let lab;
    if (parts.length) {
      const w = parts.reduce((s, [, k]) => s + k, 0);
      lab = [0, 1, 2].map(i => parts.reduce((s, [c, k]) => s + c[i] * k, 0) / w);
    } else {
      // Unrelated roots: spread around the hue circle (golden angle).
      const i = rootList.indexOf(p);
      lab = fromLch([mode === 'dark' ? 0.74 : 0.56, 0.11, (i * 137.5 + 40) * Math.PI / 180]);
    }
    // Projects without a parent that only borrow from others: give each its own hue turn.
    if (!par && parts.length) {
      const [L, C, h] = toLch(lab), i = rootList.indexOf(p);
      lab = fromLch([L, Math.max(C, 0.05), h + (i * 47 + 20) * Math.PI / 180]);
    }
    // Siblings drift apart a little in hue (and lightness for near-greys).
    // Children are a touch less saturated than their parent, so the shift stays visible
    // even next to colors at the edge of the screen's range (neon green, pure red).
    if (par) {
      const sibs = children.get(par.id), k = sibs.indexOf(p), n = sibs.length;
      let [L, C, h] = toLch(lab);
      C *= 0.86;
      if (C < 0.03) { C = 0.035; h = (k * 137.5) * Math.PI / 180; }
      // Spread siblings over at most ±28° of hue; an only child still shifts a little.
      h += (n === 1 ? 10 : (k - (n - 1) / 2) / ((n - 1) / 2) * Math.min(28, 7 * (n - 1))) * Math.PI / 180;
      L += ((k % 3) - 1) * 0.025;
      if (mode === 'light') L = Math.min(L, 0.66);
      lab = fromLch([clamp(L, 0.25, 0.98), C, h]);
    }
    busy.delete(p.id);
    out.set(p.id, lab);
    return lab;
  };
  projects.forEach(colorOf);
  return new Map([...out].map(([id, lab]) => [id, oklabToCss(lab)]));
}
const colorDark = lineageColors('dark'), colorLight = lineageColors('light');
// Sets --lc-d / --lc-l on an element; CSS picks one for the current color scheme.
const paintColor = (node, id) => {
  if (!colorDark.has(id)) return;
  node.style.setProperty('--lc-d', colorDark.get(id));
  node.style.setProperty('--lc-l', colorLight.get(id));
};

// ---------- State ----------
// List columns that can be sorted. Text columns start A→Z, numbers and dates start high→low.
// Missing values always go last.
const COLUMNS = {
  name:     { text: true, get: p => p.name },
  releases: { get: p => versionsOf.get(p.id).length || null },
  stars:    { get: p => p.stars || null },
  license:  { text: true, get: p => p.license || null },
  created:  { get: p => p.created ? timeOf.get(p.id) : null },
  updated:  { get: p => updatedMs(p) }
};
// Presets offered in the filter panel.
const SORTS = {
  'created:desc': t('sortNewest'),
  'created:asc':  t('sortOldest'),
  'updated:desc': t('sortUpdated'),
  'stars:desc':   t('sortStars'),
  'name:asc':     t('sortName')
};
const DEFAULT_SORT = 'created:desc';
const validSort = s => { const [c, d] = (s || '').split(':'); return COLUMNS[c] && (d === 'asc' || d === 'desc'); };
const state = {
  view: ['family', 'timeline', 'list', 'insight'].includes(store.get('view')) ? store.get('view') : 'family',
  sort: validSort(store.get('sort')) ? store.get('sort') : DEFAULT_SORT,
  status: ['all', 'active', 'inactive'].includes(store.get('status')) ? store.get('status') : 'all',
  mode: store.get('mode') === 'all' ? 'all' : 'main',
  emphasis: ['forks', 'stars'].includes(store.get('emphasis')) ? store.get('emphasis') : 'off',
  arcs: store.get('arcs') !== 'off',   // code-exchange arcs are on unless turned off
  query: '',
  selected: null,
  open: new Set(),   // parents whose "Other" was expanded ('' = top level)
  pinned: new Set()  // projects revealed by selecting them
};
const isTree = () => state.view === 'family' || state.view === 'timeline';
const sorter = () => {
  const [key, dir] = state.sort.split(':'), col = COLUMNS[key], sign = dir === 'asc' ? 1 : -1;
  return (a, b) => {
    const x = col.get(a), y = col.get(b);
    if (x == null || y == null) return (x == null) - (y == null) || a.name.localeCompare(b.name);
    const r = col.text ? String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' }) : x - y;
    return r * sign || a.name.localeCompare(b.name);
  };
};
const haystack = new Map(projects.map(p => [p.id, [p.name, p.author, p.hardware, ...(p.aliases || [])].filter(Boolean).join('\n').toLowerCase()]));
const matchesQuery = p => !state.query || haystack.get(p.id).includes(state.query);
const passStatus = p => state.status === 'all' || (state.status === 'active' ? statusOf(p) === 'active' : statusOf(p) !== 'active');
const passes = p => matchesQuery(p) && passStatus(p);

// ---------- Elements ----------
const bar = $('#bar'), world = $('#world'), viewport = $('#viewport'), edgesSvg = $('#edges'), axis = $('#axis');
const rail = $('#rail'), info = $('#info'), searchInput = $('#search');
const panelBtn = $('#panelBtn'), panel = $('#panel');
const treeView = $('#treeView'), listView = $('#listView'), listBody = $('#listBody');
const itemEls = new Map(), btnEls = new Map(), lifeEls = new Map(), connEls = new Map(), rowEls = new Map();
const verEls = new Map();   // project id -> [{ el, v }]
const tailEls = new Map();  // project id -> path after its last release

// ---------- Layout ----------
// Items are visible projects plus "Other N" groups, in depth-first order.
let layout = { items: [], byItem: new Map(), rowOf: new Map() };

const earlyRank = it => it.kind === 'project' && ['research', 'stock-mod'].includes(it.p.group) ? 0 : 1;
function computeLayout() {
  const forced = new Set(state.pinned);
  if (state.query) for (const p of projects) if (matchesQuery(p)) forced.add(p.id);
  for (const id of [...forced]) for (const a of ancestors(id)) forced.add(a);
  const items = [];
  const walk = (parentId, kids, topLevel) => {
    const key = parentId ?? '';
    const shown = [], hidden = [];
    for (const c of kids) {
      // Every independent line (the top level) is always shown; folding only happens inside a family.
      const show = topLevel || state.mode === 'all' || state.open.has(key) || forced.has(c.id) || weight.get(c.id) >= threshold;
      (show ? shown : hidden).push(c);
    }
    if (hidden.length === 1) shown.push(hidden.pop());
    const entries = shown.map(c => ({ id: c.id, kind: 'project', p: c, parent: parentId, time: timeOf.get(c.id), end: endOf.get(c.id) }));
    if (hidden.length) {
      const t = Math.min(...hidden.map(c => timeOf.get(c.id)));
      entries.push({
        id: 'g:' + key, kind: 'group', parent: parentId, key, time: t, end: t,
        members: hidden.map(c => c.id),
        count: hidden.reduce((n, c) => n + 1 + descendants(c.id).length, 0)
      });
    }
    // Top level: heaviest family first. Inside a family: newest closest to the parent.
    entries.sort(topLevel
      // Top level: the early work (research, stock-firmware mods) first in date order, then the heaviest families.
      ? (a, b) => (a.kind === 'group') - (b.kind === 'group') || earlyRank(a) - earlyRank(b) || (earlyRank(a) === 0 ? a.time - b.time : (weight.get(b.id) ?? 0) - (weight.get(a.id) ?? 0))
      : (a, b) => b.time - a.time || numericId(a.id, b.id));
    for (const it of entries) {
      items.push(it);
      if (it.kind === 'project') walk(it.id, children.get(it.id), false);
    }
  };
  walk(null, roots, true);
  // Timeline: same items, rows simply in creation order (lines may cross).
  if (state.view === 'timeline') items.sort((a, b) => a.time - b.time || (a.kind === 'group') - (b.kind === 'group') || numericId(a.id, b.id));
  return { items, byItem: new Map(items.map(it => [it.id, it])), rowOf: new Map(items.map((it, i) => [it.id, i])) };
}

// ---------- Geometry ----------
// Family:   time → right, one row per item (depth-first).
// Timeline: time ↓ down,  one column per item (creation order), so it steps down to the right.
let ROW_H = 30, COL_W = 24, TOP = 48, LEFT = 28, PX_DAY = 40, LABEL_ROOM = 200;
let worldW = 0, worldH = 0;
const cssPx = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
const isTimeline = () => state.view === 'timeline';
const xOfTime = t => LEFT + dispOf(t) / DAY * PX_DAY;
const yOfRow = r => TOP + r * ROW_H;
const xOfCol = c => LEFT + c * COL_W;
// Timeline y: proportional to time, but items created within hours of each other
// get a minimum gap so their names don't collide. `shifts` keeps the mapping monotonic.
let shifts = [];   // [{ t, y, shift }] in time order
const linY = t => TOP + dispOf(t) / DAY * PX_DAY;
function buildShifts() {
  const MIN_GAP = mqNarrow.matches ? 26 : 22;
  shifts = [];
  let prevY = -Infinity, shift = 0;
  for (const it of layout.items) {
    const y = Math.max(linY(it.time) + shift, prevY + MIN_GAP);
    shift = y - linY(it.time);
    shifts.push({ t: it.time, y, shift });
    prevY = y;
  }
}
const shiftAt = t => { let s = 0; for (const p of shifts) { if (p.t <= t) s = p.shift; else break; } return s; };
const yOfTime = t => linY(t) + shiftAt(t);
const timeAtY = y => { let s = 0; for (const p of shifts) { if (p.y <= y) s = p.shift; else break; } return timeOfDisp((y - s - TOP) / PX_DAY * DAY); };

function computeGeometry() {
  const narrow = mqNarrow.matches;
  const avail = innerWidth - cssPx('--rail-w');
  const span = Math.max(1, dispOf(maxT) / DAY);
  const n = Math.max(1, layout.items.length);
  LEFT = narrow ? 16 : 28;
  LABEL_ROOM = narrow ? 150 : 210;
  if (isTimeline()) {
    TOP = 24;
    COL_W = clamp((avail - LEFT - LABEL_ROOM) / n, narrow ? 14 : 16, 40);
    PX_DAY = narrow ? 44 : 56;
    buildShifts();
    worldW = LEFT + (n - 1) * COL_W + LABEL_ROOM;
    worldH = Math.max(yOfTime(maxT), shifts.at(-1)?.y ?? 0) + 60;
  } else {
    TOP = 48;
    ROW_H = narrow ? 34 : 30;
    PX_DAY = clamp((avail - LEFT - LABEL_ROOM) / span, narrow ? 14 : 18, 90);
    worldW = LEFT + span * PX_DAY + LABEL_ROOM;
    worldH = yOfRow(n - 1) + 48;
  }
  world.style.width = worldW + 'px';
  world.style.height = worldH + 'px';
  edgesSvg.setAttribute('width', worldW);
  edgesSvg.setAttribute('height', worldH);
  // FM-1 on sale: a faint line with a star and a label at its start.
  const fx = isTimeline() ? LEFT - 12 : xOfTime(FM1_ON_SALE), fy = isTimeline() ? yOfTime(FM1_ON_SALE) : TOP - 20;
  fm1Line.setAttribute('d', isTimeline() ? `M ${fx} ${fy} H ${worldW}` : `M ${fx} ${fy} V ${worldH}`);
  fm1Mark.style.transform = `translate(${fx}px, ${fy}px)`;
  fm1Mark.hidden = !isTimeline();
  SNAPS.forEach((t, i) => snapLines[i].setAttribute('d', isTimeline()
    ? `M ${LEFT - 12} ${yOfTime(t)} H ${worldW}`
    : `M ${xOfTime(t)} ${TOP - 20} V ${worldH}`));
  document.body.classList.toggle('vertical', isTimeline());
  buildAxis();
}
const snapLines = SNAPS.map(() => svgEl('path', { class: 'snap' }));
const fm1Line = svgEl('path', { class: 'snap fm1' });
edgesSvg.prepend(fm1Line, ...snapLines);
const fm1Mark = el('div', 'fm1-mark');
fm1Mark.append(fi('star_fill'), el('span', null, t('fm1OnSale', { date: fmtLong(FM1_ON_SALE) })));
fm1Mark.title = t('fm1Title', { announced: fmtLong(Date.parse('2026-06-14T00:00:00Z')), sale: fmtLong(FM1_ON_SALE) });
world.append(fm1Mark);
// Arcs for code exchange sit above the lines; their arrowhead is a small chevron.
const arcDefs = svgEl('defs', {});
const arrow = svgEl('marker', { id: 'arcHead', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '5.5', markerHeight: '5.5', markerUnits: 'userSpaceOnUse', orient: 'auto' });
arrow.append(svgEl('path', { d: 'M 1 1 L 8 5 L 1 9', class: 'arc-head' }));
arcDefs.append(arrow);
const arcLayer = svgEl('g', { class: 'arc-layer' });
edgesSvg.append(arcDefs);
// An arc that runs down the tree (ancestor → descendant) repeats what the lines already show,
// so only back-ports and exchange between separate families get one.
const arcExchanges = exchanges.filter(x => !ancestors(x.to).includes(x.from));
const arcEls = arcExchanges.map(x => {
  const back = ancestors(x.from).includes(x.to);
  const p = svgEl('path', { class: `arc ${x.relation}${back ? ' back' : ''}`, 'marker-end': 'url(#arcHead)' });
  paintColor(p, x.from);
  const label = { uptake: 'code from', 'shared-code': 'shared code with', influence: 'inspired', 'upstream-merge': 'merged back into' }[x.relation];
  const from = byId.get(x.from).name, to = byId.get(x.to).name;
  const tip = svgEl('title', {});
  tip.textContent = x.relation === 'upstream-merge' ? t('mergedBack', { from, to })
    : x.relation === 'shared-code' ? t('shareCode', { a: from, b: to })
    : t('tookCode', { from, to }) + (back ? t('backPort') : '');
  p.append(tip);
  arcLayer.append(p);
  return { x, el: p, back, label };
});

// Where an item's line starts/ends and where its connector leaves the parent.
function targetGeom(it, i, parentGeom) {
  if (isTimeline()) {
    const x = xOfCol(i), y0 = shifts[i]?.y ?? yOfTime(it.time), y1 = Math.max(y0, yOfTime(it.end));
    return { x0: x, y0, x1: x, y1, cx: parentGeom ? parentGeom.x0 : x, cy: y0 };
  }
  const y = yOfRow(i), x0 = xOfTime(it.time), x1 = Math.max(x0, xOfTime(it.end));
  return { x0, y0: y, x1, y1: y, cx: x0, cy: parentGeom ? parentGeom.y0 : y };
}
const KEYS = ['x0', 'y0', 'x1', 'y1', 'cx', 'cy'];

// Drawn geometry animates between layouts and orientations.
let current = new Map();
let targetMap = new Map();   // final geometry of the current layout
function drawArcs() {
  if (!edgesSvg.contains(arcLayer)) edgesSvg.append(arcLayer);
  for (const { x, el: p } of arcEls) {
    const a = current.get(x.from), b = current.get(x.to);
    if (!a || !b) { p.setAttribute('d', ''); p._drawn = false; continue; }
    // From one project's start to the other's, bowed to the side so arcs don't sit on the lines.
    const x1 = a.x0, y1 = a.y0, x2 = b.x0, y2 = b.y0;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(120, 24 + len * 0.18);
    const cx = (x1 + x2) / 2 - dy / len * bow, cy = (y1 + y2) / 2 + dx / len * bow;
    // Stop short of both dots (they're drawn above the lines), so the arrowhead shows.
    const pull = (px, py, toward, d) => { const ux = toward[0] - px, uy = toward[1] - py, l = Math.hypot(ux, uy) || 1; return [px + ux / l * d, py + uy / l * d]; };
    const [sx, sy] = pull(x1, y1, [cx, cy], 7), [ex, ey] = pull(x2, y2, [cx, cy], 9);
    p.setAttribute('d', `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`);
    if (!p._drawn) { p._drawn = true; if (state.arcs) growArc(p); }
  }
}
// An arc draws itself in from its source when it appears (pathLength=1 makes one dash cover it).
function growArc(p, delay = 0) {
  if (mqReduce.matches) return;
  clearTimeout(p._grow);
  p.setAttribute('pathLength', '1');
  p.style.animationDelay = `${delay}ms`;
  p.classList.remove('grow'); void p.getBoundingClientRect(); p.classList.add('grow');
  p._grow = setTimeout(() => { p.classList.remove('grow'); p.removeAttribute('pathLength'); p.style.animationDelay = ''; }, 900 + delay);
}
function draw() {
  for (const it of layout.items) {
    const g = current.get(it.id);
    itemEls.get(it.id).style.transform = `translate(${g.x0}px, ${g.y0}px)`;
    const life = lifeEls.get(it.id);
    const tail = tailEls.get(it.id);
    if (life && tail) {
      // Solid up to the last release, faded after it (pushes and forks since then).
      const tg = targetMap.get(it.id), lastT = versionsOf.get(it.id).at(-1).t;
      const f = clamp(isTimeline()
        ? (tg.y1 - tg.y0 > 0 ? (yOfTime(lastT) - tg.y0) / (tg.y1 - tg.y0) : 1)
        : (tg.x1 - tg.x0 > 0 ? (xOfTime(lastT) - tg.x0) / (tg.x1 - tg.x0) : 1), 0, 1);
      const mx = g.x0 + (g.x1 - g.x0) * f, my = g.y0 + (g.y1 - g.y0) * f;
      life.setAttribute('d', Math.hypot(mx - g.x0, my - g.y0) > 1 ? `M ${g.x0} ${g.y0} L ${mx} ${my}` : '');
      tail.setAttribute('d', Math.hypot(g.x1 - mx, g.y1 - my) > 1 ? `M ${mx} ${my} L ${g.x1} ${g.y1}` : '');
    } else if (life) life.setAttribute('d', Math.hypot(g.x1 - g.x0, g.y1 - g.y0) > 1 ? `M ${g.x0} ${g.y0} L ${g.x1} ${g.y1}` : '');
    const conn = connEls.get(it.id);
    if (conn) conn.setAttribute('d', `M ${g.cx} ${g.cy} L ${g.x0} ${g.y0}`);
    const vers = verEls.get(it.id);
    if (vers) {
      // Where each release sits along the line, measured in the target layout,
      // then applied to the (possibly animating) current line.
      const tg = targetMap.get(it.id);
      for (const { el: ve, v } of vers) {
        const f = isTimeline()
          ? (tg.y1 - tg.y0 > 0 ? (yOfTime(v.t) - tg.y0) / (tg.y1 - tg.y0) : 0)
          : (tg.x1 - tg.x0 > 0 ? (xOfTime(v.t) - tg.x0) / (tg.x1 - tg.x0) : 0);
        const k = clamp(f, 0, 1);
        ve.style.transform = `translate(${g.x0 + (g.x1 - g.x0) * k}px, ${g.y0 + (g.y1 - g.y0) * k}px)`;
      }
    }
  }
  drawArcs();
  positionInfo();
}
// Hovering a project's name or one of its release dots lights up its whole line.
function hoverLine(id, on) {
  lifeEls.get(id)?.classList.toggle('is-hover', on);
  tailEls.get(id)?.classList.toggle('is-hover', on);
  connEls.get(id)?.classList.toggle('is-hover', on);
  itemEls.get(id)?.classList.toggle('is-hover', on);
  for (const { el: ve } of verEls.get(id) || []) ve.classList.toggle('is-hover', on);
  // Its code-exchange arcs light up; the others step back while hovering.
  let any = false;
  for (const { x: ex, el: p } of arcEls) { const t = on && (ex.from === id || ex.to === id); p.classList.toggle('is-hover', t); any ||= t; }
  document.body.classList.toggle('arc-hovering', any);
}

// ---------- Build / update DOM ----------
function makeItem(it, index) {
  const wrap = el('div', 'item');
  if (it.kind === 'project') paintColor(wrap, it.id);
  wrap.style.setProperty('--i', Math.min(index, 40));
  const btn = el('button', 'name');
  btn.type = 'button';
  if (it.kind === 'project') {
    const p = it.p;
    if (!p.created) wrap.classList.add('undated');
    if (p.stage === 'beta') wrap.classList.add('beta');   // never released: hollow, like a pre-release
    if (heavy.has(p.id)) wrap.classList.add('heavy');
    if (isBase(p)) { wrap.classList.add('base'); btn.title = t('notFirmware', { name: p.name, kind: p.kind }); }
    btn.textContent = p.name;
    btn.addEventListener('click', () => state.selected === p.id ? clearSelection(false) : selectNode(p.id));
    btn.addEventListener('focus', () => { if (!panning) ensureVisible(p.id); });
  } else {
    wrap.classList.add('group');
    btn.addEventListener('click', () => expandGroup(it.id));
  }
  btn.addEventListener('keydown', e => onItemKey(e, it.id));
  if (it.kind === 'project') {
    wrap.addEventListener('pointerenter', () => hoverLine(it.id, true));
    wrap.addEventListener('pointerleave', () => hoverLine(it.id, false));
  }
  wrap.append(el('span', 'mark'), btn);
  return { wrap, btn };
}

let tweenRaf = 0, introDone = false;
let afterRelayout = () => {};   // set by the toolbar (emphasis on newly drawn items)
function relayout({ animate = true, from = null, duration = 420 } = {}) {
  const firstRun = !layout.items.length;
  const prev = new Map(current);
  layout = computeLayout();
  computeGeometry();
  for (const [id, wrap] of itemEls) {
    if (layout.byItem.has(id)) continue;
    itemEls.delete(id); btnEls.delete(id);
    lifeEls.get(id)?.remove(); lifeEls.delete(id);
    tailEls.get(id)?.remove(); tailEls.delete(id);
    connEls.get(id)?.remove(); connEls.delete(id);
    for (const { el: ve } of verEls.get(id) || []) ve.remove();
    verEls.delete(id);
    if (animate && !mqReduce.matches) { wrap.classList.add('leaving'); setTimeout(() => wrap.remove(), 250); } else wrap.remove();
  }
  layout.items.forEach((it, i) => {
    if (!itemEls.has(it.id)) {
      const { wrap, btn } = makeItem(it, firstRun ? i : 0);
      world.append(wrap);
      itemEls.set(it.id, wrap); btnEls.set(it.id, btn);
    }
    if (it.kind === 'project' && !verEls.has(it.id) && versionsOf.get(it.id).length) {
      // Release points sit under the names (inserted right after the lines).
      const list = versionsOf.get(it.id).map(v => {
        const ve = el('button', 'ver' + (v.pre ? ' pre' : ''));
        paintColor(ve, it.id);
        ve.type = 'button';
        ve.tabIndex = -1;
        ve.style.setProperty('--i', Math.min(i, 40));
        ve.title = `${it.p.name} ${v.name} · ${fmtLong(v.t)}${v.pre ? ' (pre-release)' : ''}`;
        ve.append(el('span', 'ver-dot'), el('span', 'ver-name', v.name));
        ve.addEventListener('click', () => selectNode(it.id));
        ve.addEventListener('pointerenter', () => hoverLine(it.id, true));
        ve.addEventListener('pointerleave', () => hoverLine(it.id, false));
        edgesSvg.after(ve);
        return { el: ve, v };
      });
      verEls.set(it.id, list);
    }
    if (!lifeEls.has(it.id) && it.kind === 'project') {
      const l = svgEl('path', { class: 'life' + (it.p.created ? '' : ' undated') });
      paintColor(l, it.id);
      l.style.setProperty('--i', Math.min(i, 40));
      edgesSvg.append(l); lifeEls.set(it.id, l);
      if (versionsOf.get(it.id).length) {
        const t = svgEl('path', { class: 'life tail' });
        paintColor(t, it.id);
        t.style.setProperty('--i', Math.min(i, 40));
        edgesSvg.append(t); tailEls.set(it.id, t);
      }
    }
    if (!connEls.has(it.id) && it.parent) {
      const c = svgEl('path', { class: 'conn' + (it.kind === 'project' && it.p.tentative ? ' tentative' : '') + (it.kind === 'project' && it.p.platform ? ' platform' : '') });
      if (it.kind === 'project') paintColor(c, it.id);
      c.style.setProperty('--i', Math.min(i, 40));
      edgesSvg.append(c); connEls.set(it.id, c);
    }
    if (it.kind === 'group') {
      const btn = btnEls.get(it.id);
      btn.textContent = t('other', { n: it.count });
      btn.title = it.members.map(id => byId.get(id).name).join(', ');
      btn.setAttribute('aria-label', t('showMore', { n: it.count }));
    }
  });
  if (firstRun && !introDone && !mqReduce.matches) {
    // Lines grow in once: pathLength=1 lets one dash cover any length.
    introDone = true;
    for (const p of [...lifeEls.values(), ...connEls.values()]) p.setAttribute('pathLength', '1');
    edgesSvg.classList.add('intro');
    setTimeout(() => {
      edgesSvg.classList.remove('intro');
      for (const p of edgesSvg.querySelectorAll('[pathLength]')) p.removeAttribute('pathLength');
    }, 2200);
  }
  // Targets: parents come before children in Family; in Timeline too (created earlier).
  const targets = new Map();
  const index = new Map(layout.items.map((it, i) => [it.id, i]));
  const geomOf = it => {
    if (targets.has(it.id)) return targets.get(it.id);
    const parent = it.parent ? layout.byItem.get(it.parent) : null;
    const g = targetGeom(it, index.get(it.id), parent ? geomOf(parent) : null);
    targets.set(it.id, g);
    return g;
  };
  layout.items.forEach(geomOf);
  targetMap = targets;
  afterRelayout();
  // New items start where they came from: the "Other" they were folded into, or their parent.
  const collapsed = g => ({ ...g, x1: g.x0, y1: g.y0, cx: g.x0, cy: g.y0 });
  const startOf = it => prev.get(it.id) ?? (from && prev.get(from) && collapsed(prev.get(from))) ?? (it.parent && prev.get(it.parent) && collapsed(prev.get(it.parent))) ?? targets.get(it.id);
  const starts = new Map(layout.items.map(it => [it.id, startOf(it)]));
  cancelAnimationFrame(tweenRaf);
  if (!animate || mqReduce.matches || firstRun) { current = targets; draw(); return; }
  const t0 = performance.now();
  const step = now => {
    const t = Math.min(1, (now - t0) / duration), e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    current = new Map(layout.items.map(it => {
      const a = starts.get(it.id), b = targets.get(it.id), g = {};
      for (const k of KEYS) g[k] = a[k] + (b[k] - a[k]) * e;
      return [it.id, g];
    }));
    draw();
    if (t < 1) tweenRaf = requestAnimationFrame(step);
  };
  tweenRaf = requestAnimationFrame(step);
}

function expandGroup(gid) {
  const it = layout.byItem.get(gid);
  if (!it) return;
  state.open.add(it.key);
  relayout({ from: gid });
  paint();
  updateRail();
  requestAnimationFrame(() => btnEls.get(it.members[0])?.focus({ preventScroll: true }));
}

// ---------- Paint state ----------
function paint() {
  const sel = state.selected;
  const chain = sel ? new Set([sel, ...ancestors(sel)]) : null;
  const family = sel ? new Set([...chain, ...descendants(sel)]) : null;
  const subtreePasses = id => passes(byId.get(id)) || descendants(id).some(d => passes(byId.get(d)));
  for (const it of layout.items) {
    const isProject = it.kind === 'project';
    const pass = isProject ? passes(it.p) : it.members.some(subtreePasses);
    const inFamily = isProject ? family?.has(it.id) : family && it.members.some(m => family.has(m));
    const dim = sel ? !inFamily : !pass;
    const wrap = itemEls.get(it.id);
    wrap.classList.toggle('is-dim', dim);
    wrap.classList.toggle('is-selected', it.id === sel);
    if (isProject) btnEls.get(it.id).setAttribute('aria-pressed', String(it.id === sel));
    const life = lifeEls.get(it.id);
    for (const l of [life, tailEls.get(it.id)]) if (l) { l.classList.toggle('is-path', !!sel && chain.has(it.id)); l.classList.toggle('is-dim', dim); }
    for (const { el: ve } of verEls.get(it.id) || []) { ve.classList.toggle('is-dim', dim); ve.classList.toggle('is-path', it.id === sel); }
    const conn = connEls.get(it.id);
    if (conn) { conn.classList.toggle('is-path', !!sel && isProject && chain.has(it.id)); conn.classList.toggle('is-dim', dim); }
  }
  for (const { x, el: p } of arcEls) {
    const touches = sel && (x.from === sel || x.to === sel);
    p.classList.toggle('is-path', !!touches);
    p.classList.toggle('is-dim', !!sel && !touches);
  }
  for (const [id, tr] of rowEls) tr.classList.toggle('is-selected', id === sel);
}

// ---------- View transform ----------
const view = { x: 0, y: 0, k: 1 };
const K_MIN = 0.3, K_MAX = 2.5;
let viewReady = false, userMoved = false;
const safeRect = () => ({ left: 0, top: bar.offsetHeight, right: innerWidth - rail.offsetWidth, bottom: innerHeight });
function clampView(v) {
  const r = safeRect();
  v.k = clamp(v.k, K_MIN, K_MAX);
  const w = worldW * v.k, h = worldH * v.k, aw = r.right - r.left, ah = r.bottom - r.top;
  v.x = w <= aw ? r.left : clamp(v.x, r.right - w, r.left);
  v.y = h <= ah ? r.top : clamp(v.y, r.bottom - h, r.top);
  return v;
}
function applyView() {
  if (!isTree()) return;
  clampView(view);
  world.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})`;
  updateAxis();
  updateRail();
  positionInfo();
}
let viewRaf = 0;
const stopViewAnim = () => { cancelAnimationFrame(viewRaf); viewRaf = 0; userMoved = true; };
function animateTo(t, dur = 340) {
  stopViewAnim();
  clampView(t);
  if (mqReduce.matches) { Object.assign(view, t); applyView(); return; }
  const f = { ...view }, t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    view.k = f.k + (t.k - f.k) * e; view.x = f.x + (t.x - f.x) * e; view.y = f.y + (t.y - f.y) * e;
    applyView();
    viewRaf = p < 1 ? requestAnimationFrame(step) : 0;
  };
  viewRaf = requestAnimationFrame(step);
}
// Momentum after a flick.
function glide(vx, vy) {
  stopViewAnim();
  if (mqReduce.matches) return;
  let last = performance.now();
  const step = now => {
    const dt = Math.min(32, now - last); last = now;
    view.x += vx * dt; view.y += vy * dt;
    const f = Math.pow(0.94, dt / 16); vx *= f; vy *= f;
    applyView();
    viewRaf = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : 0;
  };
  viewRaf = requestAnimationFrame(step);
}
const zoomTarget = (factor, cx, cy) => {
  const k = clamp(view.k * factor, K_MIN, K_MAX), s = k / view.k;
  return { x: cx - (cx - view.x) * s, y: cy - (cy - view.y) * s, k };
};
const centerOn = (wx, wy, k = view.k) => {
  const r = safeRect();
  return { x: (r.left + r.right) / 2 - wx * k, y: (r.top + r.bottom) / 2 - wy * k, k };
};
const itemPoint = id => { const g = targetMap.get(id); return { x: g.x0, y: g.y0 }; };
const centerOnItem = (id, k) => { const p = itemPoint(id); return centerOn(p.x + 80, p.y, k); };
function fitView() {
  const r = safeRect();
  const k = clamp(Math.min((r.right - r.left) / worldW, (r.bottom - r.top) / worldH), K_MIN, 1);
  return { x: r.left, y: r.top, k };
}
function initViewOnce() {
  if (viewReady || innerWidth < 50 || innerHeight < 50) return;
  viewReady = true;
  const r = safeRect();
  Object.assign(view, { x: r.left, y: r.top, k: 1 });
  if (state.selected && layout.byItem.has(state.selected)) Object.assign(view, centerOnItem(state.selected));
  clampView(view);
}
function ensureVisible(id) {
  if (!isTree() || !layout.byItem.has(id)) return;
  const btn = btnEls.get(id);
  const r = safeRect(), m = 24, b = btn.getBoundingClientRect();
  const top = r.top + (isTimeline() ? 0 : 30); // below the date axis
  const inside = b.left >= r.left + m && b.top >= top + m && b.right <= r.right - m && b.bottom <= r.bottom - m;
  if (!inside) animateTo(centerOnItem(id));
}
function centerY(wy, animate = true) {
  const r = safeRect();
  const t = { x: view.x, y: (r.top + r.bottom) / 2 - wy * view.k, k: view.k };
  if (animate) animateTo(t, 300); else { stopViewAnim(); Object.assign(view, t); applyView(); }
}

// ---------- Date axis ----------
let ticks = [];
function buildAxis() {
  axis.replaceChildren();
  ticks = [];
  const startDay = Math.floor(minT / DAY), endDay = Math.ceil(maxT / DAY);
  const snapDays = new Set(SNAPS.map(t => Math.floor(t / DAY)));
  for (let d = startDay; d <= endDay; d++) {
    const t = new Date(d * DAY);
    const month = t.getUTCDate() === 1;
    const today = snapDays.has(d);   // an update date: always labelled with its date
    const span = el('span', 'tick' + (month ? ' month' : '') + (today ? ' snap' : ''),
      today || !month ? fmtDay(d * DAY) : fmtMonth(d * DAY));
    axis.append(span);
    ticks.push({ el: span, x: xOfTime(d * DAY), weekday: t.getUTCDay(), date: t.getUTCDate(), month, today });
  }
  // The FM-1 going on sale: a starred tick, first claim on space.
  const star = el('span', 'tick fm1');
  star.append(fi('star_fill'), el('span', null, 'FM-1'));
  star.title = fm1Mark.title;
  axis.append(star);
  ticks.unshift({ el: star, x: xOfTime(FM1_ON_SALE), today: true, month: false });
}
function updateAxis() {
  if (isTimeline()) return;
  const px = PX_DAY * view.k;
  const every = [1, 2, 7, 14].find(s => s * px >= 52) ?? 30;
  const shown = [];
  // Month starts and today get first claim on space, then the regular ticks.
  const ordered = [...ticks.filter(t => t.today), ...ticks.filter(t => t.month && !t.today), ...ticks.filter(t => !t.month && !t.today)];
  for (const t of ordered) {
    const sx = view.x + t.x * view.k;
    const wanted = t.month || t.today || (every === 1) || (every === 2 && t.date % 2 === 1) ||
      (every === 7 && t.weekday === 1) || (every === 14 && t.weekday === 1 && t.date <= 14) || (every === 30 && t.month);
    const free = shown.every(x => Math.abs(x - sx) > 44);
    const on = wanted && free && sx > -40 && sx < innerWidth + 40;
    t.el.hidden = !on;
    if (on) { shown.push(sx); t.el.style.left = sx + 'px'; }
  }
}

// ---------- Gestures ----------
const pointers = new Map();
let gesture = null, panning = false, suppressClick = false, samples = [];
viewport.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  stopViewAnim();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    suppressClick = false;
    samples = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    gesture = { type: 'pending', sx: e.clientX, sy: e.clientY, view: { ...view } };
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, view: { ...view } };
    for (const id of pointers.keys()) try { viewport.setPointerCapture(id); } catch {}
    suppressClick = true;
  }
});
viewport.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture.type === 'pending' && Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 5) {
    gesture.type = 'pan'; panning = true; suppressClick = true;
    viewport.classList.add('is-panning');
    try { viewport.setPointerCapture(e.pointerId); } catch {}
  }
  if (gesture.type === 'pan') {
    const now = performance.now();
    samples.push({ x: e.clientX, y: e.clientY, t: now });
    while (samples.length > 2 && now - samples[0].t > 90) samples.shift();
    view.x = gesture.view.x + e.clientX - gesture.sx;
    view.y = gesture.view.y + e.clientY - gesture.sy;
    applyView();
  } else if (gesture.type === 'pinch' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()], g = gesture.view;
    const k = clamp(g.k * Math.hypot(a.x - b.x, a.y - b.y) / gesture.dist, K_MIN, K_MAX);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    view.k = k;
    view.x = mx - (gesture.mx - g.x) / g.k * k;
    view.y = my - (gesture.my - g.y) / g.k * k;
    applyView();
  }
});
const endPointer = e => {
  if (!pointers.delete(e.pointerId)) return;
  if (pointers.size === 1) {
    const [p] = pointers.values();
    gesture = { type: 'pan', sx: p.x, sy: p.y, view: { ...view } };
    samples = [];
  } else if (!pointers.size) {
    if (gesture?.type === 'pan' && samples.length > 1) {
      const a = samples[0], b = samples.at(-1), dt = b.t - a.t;
      if (dt > 0 && performance.now() - b.t < 60) {
        const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
        if (Math.hypot(vx, vy) > 0.25) glide(vx, vy);
      }
    }
    gesture = null;
    viewport.classList.remove('is-panning');
    setTimeout(() => { panning = false; }, 0);
  }
};
viewport.addEventListener('pointerup', endPointer);
viewport.addEventListener('pointercancel', endPointer);
viewport.addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
viewport.addEventListener('click', e => { if (!e.target.closest('.item') && state.selected) clearSelection(false); });
viewport.addEventListener('wheel', e => {
  e.preventDefault();
  stopViewAnim();
  if (e.ctrlKey || e.metaKey) Object.assign(view, zoomTarget(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY));
  else {
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    view.x -= dx; view.y -= dy;
  }
  applyView();
}, { passive: false });
rail.addEventListener('wheel', e => { e.preventDefault(); stopViewAnim(); view.y -= e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; applyView(); }, { passive: false });
let gScale = 1;
viewport.addEventListener('gesturestart', e => { e.preventDefault(); gScale = 1; });
viewport.addEventListener('gesturechange', e => {
  e.preventDefault();
  if (pointers.size) return;
  Object.assign(view, zoomTarget(e.scale / gScale, e.clientX, e.clientY));
  gScale = e.scale;
  applyView();
});

// ---------- Right-edge dots ----------
// A scroll control over the whole canvas height. Hover shows what is there:
// the date in Timeline, the project name in Family.
const dotsEl = $('#dots'), dotLabel = $('#dotLabel');
let dots = [], hoverIndex = -1, scrubbing = false, dotsKey = '';
const itemName = it => it.kind === 'project' ? it.p.name : t('other', { n: it.count });
const spanY = () => {
  const first = TOP, last = isTimeline() ? worldH - 60 : yOfRow(Math.max(0, layout.items.length - 1));
  return [first, Math.max(first + 1, last)];
};
const dayKey = t => Math.floor(t / DAY);
function dotText(wy) {
  if (isTimeline()) {
    const t = timeAtY(wy);
    return `${new Date(t).getUTCMonth() + 1}/${new Date(t).getUTCDate()}`;
  }
  const row = clamp(Math.round((wy - TOP) / ROW_H), 0, layout.items.length - 1);
  return layout.items[row] ? itemName(layout.items[row]) : '';
}
function buildDots() {
  const h = dotsEl.clientHeight;
  if (!h) return;
  const [y0, y1] = spanY();
  const count = clamp(Math.floor(h / 18) + 1, 2, 80);
  const key = `${count}|${y0}|${y1}`;
  if (key === dotsKey) return;
  dotsKey = key;
  dotsEl.replaceChildren();
  dots = Array.from({ length: count }, (_, i) => {
    const d = el('span', 'dot');
    dotsEl.append(d);
    return { el: d, wy: y0 + (y1 - y0) * i / (count - 1) };
  });
}
const indexAt = clientY => {
  const r = dotsEl.getBoundingClientRect();
  return Math.round(clamp((clientY - r.top) / r.height, 0, 1) * (dots.length - 1));
};
function showLabel(i) {
  hoverIndex = i;
  dots.forEach((d, j) => d.el.classList.toggle('is-hover', j === i));
  if (i < 0 || !dots[i]) { dotLabel.classList.remove('show'); return; }
  dotLabel.textContent = dotText(dots[i].wy);
  dotLabel.style.top = (dots[i].el.offsetTop + dots[i].el.offsetHeight / 2 + dotsEl.offsetTop) + 'px';
  dotLabel.classList.add('show');
}
function updateRail() {
  buildDots();
  if (!dots.length || !layout.items.length) return;
  const r = safeRect();
  const v0 = (r.top - view.y) / view.k, v1 = (r.bottom - view.y) / view.k;
  const [y0, y1] = spanY();
  const half = (y1 - y0) / (dots.length - 1) / 2;
  for (const d of dots) d.el.classList.toggle('in-view', d.wy + half >= v0 && d.wy - half <= v1);
  const mid = clamp((v0 + v1) / 2, y0, y1);
  dotsEl.setAttribute('aria-valuenow', String(Math.round((mid - y0) / (y1 - y0) * 100)));
  dotsEl.setAttribute('aria-valuetext', dotText(mid));
  if (scrubbing || document.activeElement === dotsEl) showLabel(Math.round((mid - y0) / (y1 - y0) * (dots.length - 1)));
}
dotsEl.addEventListener('pointerdown', e => {
  e.preventDefault();
  try { dotsEl.setPointerCapture(e.pointerId); } catch {}
  scrubbing = true;
  const i = indexAt(e.clientY);
  showLabel(i);
  centerY(dots[i].wy, true);
});
dotsEl.addEventListener('pointermove', e => {
  if (!dots.length) return;
  const i = indexAt(e.clientY);
  if (scrubbing) { if (i !== hoverIndex) { showLabel(i); centerY(dots[i].wy, false); } }
  else if (e.pointerType === 'mouse' && i !== hoverIndex) showLabel(i);
});
const endScrub = () => { scrubbing = false; };
dotsEl.addEventListener('pointerup', endScrub);
dotsEl.addEventListener('pointercancel', endScrub);
dotsEl.addEventListener('pointerleave', () => { if (!scrubbing && document.activeElement !== dotsEl) showLabel(-1); });
dotsEl.addEventListener('blur', () => showLabel(-1));
dotsEl.addEventListener('focus', updateRail);
dotsEl.addEventListener('keydown', e => {
  const r = safeRect(), page = (r.bottom - r.top) * 0.8, step = 90 * view.k;
  const moves = { ArrowUp: step, ArrowDown: -step, PageUp: page, PageDown: -page };
  if (e.key in moves) { e.preventDefault(); animateTo({ ...view, y: view.y + moves[e.key] }, 200); }
  else if (e.key === 'Home') { e.preventDefault(); centerY(spanY()[0]); }
  else if (e.key === 'End') { e.preventDefault(); centerY(spanY()[1]); }
});

// ---------- Popover ----------
// Sits right next to the selected name (or list row): right, else left, else below/above.
function positionInfo() {
  if (!state.selected || !info.classList.contains('is-open')) return;
  const anchor = isTree() ? btnEls.get(state.selected) : rowEls.get(state.selected);
  if (!anchor) { info.classList.add('is-away'); return; }
  const a = anchor.getBoundingClientRect();
  const gap = 10, left = 8, top = bar.offsetHeight + 8, bottom = innerHeight - 8;
  const right = innerWidth - (isTree() ? rail.offsetWidth : 0) - 8;
  const away = a.bottom < top || a.top > bottom || a.right < left || a.left > right;
  info.classList.toggle('is-away', away);
  if (away) return;
  const w = info.offsetWidth, h = info.offsetHeight;
  let x, y, ox, oy;
  if (a.right + gap + w <= right) { x = a.right + gap; y = a.top - 8; ox = '0'; oy = '20px'; }
  else if (a.left - gap - w >= left) { x = a.left - gap - w; y = a.top - 8; ox = '100%'; oy = '20px'; }
  else if (a.bottom + gap + h <= bottom) { x = a.left; y = a.bottom + gap; ox = '20px'; oy = '0'; }
  else { x = a.left; y = a.top - gap - h; ox = '20px'; oy = '100%'; }
  x = clamp(x, left, Math.max(left, right - w));
  y = clamp(y, top, Math.max(top, bottom - h));
  info.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  info.style.setProperty('--ox', ox);
  info.style.setProperty('--oy', oy);
}
// The panel: name, then short icon rows (no labels where an icon says it).
function fillInfo(p) {
  $('#infoName').textContent = p.name;
  $('#infoPick').hidden = !p.pick;
  const rows = $('#infoRows');
  rows.replaceChildren();
  const jump = id => { const b = el('button', 'jump', byId.get(id).name); b.type = 'button'; b.addEventListener('click', () => selectNode(id, { navigate: true })); return b; };
  const row = (glyph, title, ...content) => {
    const r = el('div', 'info-row');
    const i = fi(glyph); i.title = title;
    // Icon in its own column; the text wraps under itself, not under the icon.
    const body = el('span', 'row-body');
    body.append(...content);
    r.append(i, body);
    r.title = title;
    rows.append(r);
    return r;
  };
  const list = ids => ids.flatMap((id, i) => i ? [', ', jump(id)] : [jump(id)]);
  // Where it comes from: built on / split from get the send icon; lineage words stay as words.
  const rel = relationText(p);
  if (typeof rel === 'string') rows.append(el('div', 'info-row note', rel));
  else if (rel) {
    const [label, par] = rel;
    if (p.platform) row('send', t(label), jump(par.id));
    else {
      // Home = where it comes from; the kind of link (fork, port...) follows quietly.
      const kind = { forkOf: 'kFork', portOf: 'kPort', variantOf: 'kVariant', possiblyFrom: 'kUnconfirmed' }[label];
      row('home', t(label), jump(par.id), ...(kind ? [el('span', 'row-kind', t(kind))] : []));
    }
  }
  if (p.author) {
    const who = p.authorUrl ? Object.assign(el('a', null, p.author), { href: p.authorUrl, target: '_blank', rel: 'noopener noreferrer' }) : p.author;
    row('person', t('author'), who);
  }
  const date = row('clock', t('released'), p.created ? fmtLong(timeOf.get(p.id)) : t('dateUnknown'));
  if (p.stars) { const st = el('span', 'stars'); st.append(fi('star_fill'), fmtNum(p.stars)); st.title = t('githubStars'); date.append(st); }
  const vs = versionsOf.get(p.id), latest = vs.at(-1);
  const tagText = [latest ? `${latest.name} · ${t('releases', vs.length)}` : (p.stage || null),
    hardwareOf(p).join(', ') !== 'FM-1' ? hardwareOf(p).join(', ') || null : null, p.archived ? t('archived') : null].filter(Boolean).join(' · ');
  if (tagText) row('tag', t('versionHardware'), tagText);
  // Code exchange.
  const inc = codeFrom.get(p.id) || [], out = codeTo.get(p.id) || [];
  const took = inc.filter(x => x.relation !== 'influence').map(x => x.from);
  const gave = out.filter(x => x.relation !== 'influence').map(x => x.to);
  const insp = [...inc.filter(x => x.relation === 'influence').map(x => x.from)];
  if (took.length) row('download', t('codeFrom'), ...list(took));
  if (gave.length) row('upload', t('codeWentTo'), ...list(gave));
  if (insp.length) row('sparkles', 'Inspired by', ...list(insp));
  // Links, each with its own icon.
  const links = $('#infoLinks');
  links.replaceChildren();
  for (const [label, url] of linksOf(p)) {
    const link = el('a', 'link press');
    link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.append(label === 'GitHub' ? githubMark() : fi(label === 'Installer' ? 'download' : label === 'Simulator' ? 'play' : 'link'), el('span', null, linkText(label)));
    links.append(link);
  }
  links.hidden = !links.children.length;
}

// Link labels shown in the interface language (service names stay as they are).
const linkText = label => ({ Website: t('website'), Installer: t('installer'), Simulator: t('simulator') })[label] ?? label;
// Pages only: never link straight to a file download.
const isFile = url => /\.(zip|tar|gz|tgz|7z|bin|uf2|hex|dfu)$/i.test(url || '');
function linksOf(p) {
  const repoUrl = isFile(p.repo) || p.repo === p.website ? null : p.repo;
  const repoLabel = /^https:\/\/github\.com\//.test(repoUrl || '') ? 'GitHub' : 'Website';
  // Order: where the project lives, how to install it, where to try it, how to support its author.
  const seen = new Set();
  return [['Website', p.website], [repoLabel, repoUrl], ['Installer', p.installer], ['Simulator', p.simulator],
    ...(p.support ?? []).map(s => [s.name, s.url])]
    .filter(([, url]) => url && !isFile(url) && !seen.has(url) && seen.add(url));
}
// Shown without parenthetical notes, e.g. "SMK-37 Pro (Elite/MKE-P37 builds untested)" → "SMK-37 Pro".
const hardwareOf = p => (p.hardware || '').replace(/\s*\([^)]*\)/g, '').replace(/^M-VAVE FM-1$/, 'FM-1').split(/,\s*/).filter(Boolean);
const latestVersion = p => versionsOf.get(p.id).at(-1) ?? null;
// Kept on the tree, left out of the list: the BSP.
const NOT_IN_LIST = new Set(['Z:18']);

// ---------- Selection ----------
function selectNode(id, { navigate = false } = {}) {
  const p = byId.get(id);
  if (!p) return;
  const changed = state.selected !== id;
  state.selected = id;
  if (!layout.byItem.has(id)) {
    // Folded into an "Other": reveal just this one, sliding out of that row.
    const group = layout.items.find(it => it.kind === 'group' && it.members.some(m => m === id || descendants(m).includes(id)));
    state.pinned.add(id);
    relayout({ from: group?.id });
    navigate = true;
  }
  fillInfo(p);
  if (changed) { info.classList.remove('is-open'); void info.offsetWidth; } // replay the pop-in
  info.classList.add('is-open');
  paint();
  setHash(id);
  positionInfo();
  if (isTree() && viewReady) {
    requestAnimationFrame(() => {
      if (navigate) animateTo(centerOnItem(id, Math.max(view.k, 0.8)));
      else ensureVisible(id);
    });
  } else if (state.view === 'list') rowEls.get(id)?.scrollIntoView({ block: 'nearest', behavior: mqReduce.matches ? 'auto' : 'smooth' });
}
function clearSelection(restoreFocus = true) {
  const prev = state.selected;
  state.selected = null;
  info.classList.remove('is-open');
  paint();
  setHash(null);
  if (restoreFocus && prev) (isTree() ? btnEls.get(prev) : rowEls.get(prev))?.focus({ preventScroll: true });
}
function setHash(id) {
  try { history.replaceState(null, '', id ? '#' + encodeURIComponent(id) : location.pathname + location.search); } catch {}
}
function onItemKey(e, id) {
  const row = layout.rowOf.get(id), it = layout.byItem.get(id);
  let next = null;
  if (e.key === 'ArrowUp') next = layout.items[row - 1]?.id;
  else if (e.key === 'ArrowDown') next = layout.items[row + 1]?.id;
  else if (e.key === 'ArrowLeft') next = it?.parent;
  else if (e.key === 'ArrowRight') next = layout.items[row + 1]?.parent === id ? layout.items[row + 1].id : null;
  else return;
  e.preventDefault();
  if (!next || !btnEls.has(next)) return;
  btnEls.get(next).focus();
  if (state.selected && byId.has(next)) selectNode(next);
}

// ---------- List (every project except NOT_IN_LIST) ----------
function renderList() {
  const rows = projects.filter(p => !NOT_IN_LIST.has(p.id) && passes(p)).sort(sorter());
  listBody.replaceChildren();
  rowEls.clear();
  if (!rows.length) {
    const tr = el('tr'), td = el('td', 'empty', t('noMatches'));
    td.colSpan = 11; tr.append(td); listBody.append(tr);
  }
  const outLink = (cls, text, url) => {
    const a = el('a', cls, text);
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.addEventListener('click', e => e.stopPropagation());   // don't select the row
    return a;
  };
  const frag = document.createDocumentFragment();
  for (const p of rows) {
    const tr = el('tr');
    paintColor(tr, p.id);
    tr.tabIndex = 0;
    tr.classList.toggle('is-selected', p.id === state.selected);
    const name = el('td', 'col-name');
    const title = el('div', 'row-title' + (isBase(p) ? ' base' : ''), p.name);
    name.append(title);
    if (p.aliases?.length) name.append(el('div', 'row-sub', 'formerly ' + p.aliases.join(', ')));
    // Base: the parent project and how it relates (fork, port, ...), or the root's group.
    const base = el('td', 'col-base');
    const rel = relationText(p);
    if (!rel) base.append('—');
    else if (typeof rel === 'string') base.append(el('span', 'muted', rel));
    else {
      const [label, par] = rel;
      const b = el('button', 'row-base', par.name);
      b.type = 'button';
      b.title = t('show', { name: par.name });
      b.addEventListener('click', e => { e.stopPropagation(); selectNode(par.id); });
      const kind = { forkOf: 'kFork', portOf: 'kPort', variantOf: 'kVariant', basedOn: 'kDerived', possiblyFrom: 'kUnconfirmed', builtOn: 'kBuiltOn', splitFrom: 'kSplitFrom' }[label];
      base.append(b, el('div', 'row-sub', kind ? t(kind) : ''));
    }
    const author = el('td', 'col-author');
    author.append(p.author && p.authorUrl ? outLink('row-link', p.author, p.authorUrl) : (p.author || '—'));
    const hw = el('td', 'col-hw');
    const hws = hardwareOf(p);
    if (hws.length) for (const h of hws) hw.append(el('span', 'tag', h)); else hw.append('—');
    const v = latestVersion(p);
    const ver = el('td', 'col-ver');
    if (v) {
      const s = el('span', v.pre ? 'ver-tag pre' : 'ver-tag', v.name);
      s.title = v.name + (v.pre ? ' (pre-release)' : '');
      ver.append(s, el('div', 'row-sub', fmtLong(v.t)));
    }
    else if (p.stage) ver.append(el('span', 'ver-tag pre', p.stage));
    else ver.append('—');
    const links = el('td', 'col-links');
    for (const [label, url] of linksOf(p)) links.append(outLink('row-link', linkText(label), url));
    const vs = versionsOf.get(p.id);
    tr.append(
      name,
      base,
      author,
      hw,
      ver,
      el('td', 'col-rel num muted', vs.length ? String(vs.length) : '—'),
      el('td', 'col-stars num muted', p.stars ? fmtNum(p.stars) : '—'),
      el('td', 'col-license muted', p.license || '—'),
      el('td', 'col-released muted', p.created ? fmtLong(timeOf.get(p.id)) : '—'),
      el('td', 'col-updated muted', updatedMs(p) ? fmtLong(updatedMs(p)) : '—'),
      links
    );
    tr.addEventListener('click', () => state.selected === p.id ? clearSelection(false) : selectNode(p.id));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNode(p.id); } });
    frag.append(tr);
    rowEls.set(p.id, tr);
  }
  listBody.append(frag);
  const [col, dir] = state.sort.split(':');
  for (const th of $$('th[data-col]')) th.dataset.col === col ? th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending') : th.removeAttribute('aria-sort');
  positionInfo();
}
for (const th of $$('th[data-col]')) {
  th.querySelector('button').addEventListener('click', () => {
    // Same column: flip the direction. New column: its natural first direction.
    const c = th.dataset.col, [cur, dir] = state.sort.split(':');
    setSort(`${c}:${cur === c ? (dir === 'asc' ? 'desc' : 'asc') : COLUMNS[c].text ? 'asc' : 'desc'}`);
  });
}
listView.addEventListener('scroll', positionInfo, { passive: true });

// ---------- Segmented controls ----------
function syncSeg(seg) {
  const on = seg.querySelector('button[aria-pressed="true"]'), thumb = seg.querySelector('.seg-thumb');
  if (!on || !thumb || !on.offsetWidth) return;
  thumb.style.width = on.offsetWidth + 'px';
  thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  if (!seg.classList.contains('ready')) requestAnimationFrame(() => seg.classList.add('ready'));
}

// ---------- Views ----------
function setView(v) {
  const wasTree = isTree();
  const switching = state.view !== v;
  state.view = v;
  store.set('view', v);
  document.body.dataset.view = v;
  treeView.hidden = !isTree();
  listView.hidden = v !== 'list';
  insightView.hidden = v !== 'insight';
  const shown = v === 'list' ? listView : v === 'insight' ? insightView : treeView;
  if (v === 'insight') { renderInsight(); if (switching) for (const b of $$('.ins-stat b')) countUp(b, +b.dataset.to, 1100); }
  // Family ⇄ Timeline: rows slide to their new places instead of a crossfade.
  if (switching && wasTree && isTree()) {
    relayout({ duration: 700 });
    paint();
    const r = safeRect();
    animateTo(state.selected && layout.byItem.has(state.selected) ? centerOnItem(state.selected) : { x: r.left, y: r.top, k: view.k }, 700);
  }
  else if (switching) { shown.classList.remove('view-in'); void shown.offsetWidth; shown.classList.add('view-in'); }
  for (const b of $$('#viewSeg button')) b.setAttribute('aria-pressed', String(b.dataset.view === v));
  syncSeg($('#viewSeg'));
  $('#sortGroup').hidden = v !== 'list';
  const modeRow = $('#modeSeg').closest('.panel-row');
  modeRow.hidden = modeRow.previousElementSibling.hidden = !isTree();
  if (isTree()) { if (!wasTree) relayout({ animate: false }), paint(); initViewOnce(); applyView(); }
  requestAnimationFrame(positionInfo);
}
for (const b of $$('#viewSeg button')) b.addEventListener('click', () => setView(b.dataset.view));

// ---------- Insight ----------
// A few plain counts over the whole database: what has been made, by whom, on what, and when.
const insightView = $('#insightView');
let insightDone = false;
function renderInsight() {
  if (insightDone) return;
  insightDone = true;
  const inner = $('#insightInner'), tip = $('#insightTip');
  const fw = projects.filter(p => !isBase(p));
  const openProject = id => { setView('family'); selectNode(id, { navigate: true }); };
  const card = (title, sub, wide) => {
    const c = el('section', 'ins-card' + (wide ? ' wide' : ''));
    c.append(el('h2', null, title));
    if (sub) c.append(el('p', 'ins-sub', sub));
    inner.append(c);
    return c;
  };
  const showTip = (e, text) => { tip.textContent = text; tip.hidden = false; tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; };
  const hideTip = () => { tip.hidden = true; };
  // Ranked bars. rows: [{ label, value, id?, color? }]
  const bars = (c, rows, fmt = v => fmtNum(v)) => {
    const max = Math.max(1, ...rows.map(r => r.value));
    const box = el('div', 'ins-bars');
    for (const r of rows) {
      const row = el('div', 'ins-bar' + (r.id && colorDark.has(r.id) ? ' lineage' : ''));
      let nm;
      if (r.id) { nm = el('button', 'nm', r.label); nm.type = 'button'; nm.addEventListener('click', () => openProject(r.id)); }
      else nm = el('span', 'nm', r.label);
      nm.title = r.label;
      const track = el('div', 'track'), fill = el('i');
      fill.style.width = (r.value / max * 100).toFixed(1) + '%';
      if (r.id) paintColor(row, r.id);
      track.append(fill);
      row.append(nm, track, el('span', 'val', fmt(r.value)));
      box.append(row);
    }
    c.append(box);
  };
  // Columns over days (one series). counts: Map(dayIndex -> n)
  // Both day charts share one range, from the first firmware to today, so they line up.
  const columns = (c, counts, unit) => {
    const d0 = firstDay, d1 = Math.max(lastDay, ...counts.keys());
    const max = Math.max(1, ...counts.values());
    const box = el('div', 'ins-cols');
    for (let d = d0; d <= d1; d++) {
      const n = counts.get(d) || 0;
      const col = el('div', 'ins-col' + (n ? '' : ' zero')), bar = el('i');
      bar.style.height = (n / max * 100).toFixed(1) + '%';
      col.append(bar);
      const label = `${fmtLong(d * DAY)} · ${t(unit, n)}`;
      col.addEventListener('pointermove', e => showTip(e, label));
      col.addEventListener('pointerleave', hideTip);
      col.setAttribute('aria-label', label);
      box.append(col);
    }
    c.append(box);
    const ax = el('div', 'ins-axis');
    ax.append(el('span', null, fmtLong(d0 * DAY)), el('span', null, fmtLong(d1 * DAY)));
    c.append(ax);
  };
  const dayOf = t => Math.floor(t / DAY);
  const firstDay = Math.min(...fw.filter(p => p.created).map(p => dayOf(timeOf.get(p.id)))), lastDay = dayOf(Date.now());
  const tally = (list, key) => { const m = new Map(); for (const x of list) for (const k of [key(x)].flat()) if (k) m.set(k, (m.get(k) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
  const topWithOther = (pairs, n) => {
    const top = pairs.slice(0, n).map(([label, value]) => ({ label, value }));
    const rest = pairs.slice(n).reduce((a, [, v]) => a + v, 0);
    if (rest) top.push({ label: t('otherN', { n: pairs.length - n }), value: rest, other: true });
    return top;
  };

  // Headline numbers.
  const stats = el('div', 'ins-stats');
  const allReleases = fw.reduce((n, p) => n + versionsOf.get(p.id).length, 0);
  const authors = new Set(fw.map(p => (p.author || '').toLowerCase()).filter(Boolean));
  for (const [v, label] of [[releasedFirmware, t('statReleased')], [authors.size, t('statAuthors')], [allReleases, t('statReleases')], [fw.reduce((n, p) => n + (p.stars || 0), 0), t('statStars')]]) {
    const s = el('div', 'ins-stat');
    const num = el('b', null, fmtNum(v));
    num.dataset.to = v;
    s.append(num, el('span', null, label));
    stats.append(s);
  }
  inner.append(stats);

  // The same numbers, another way.
  {
    card(t('angleTitle'), null, true).append(angleTiles());
  }

  // New firmware per day, and releases per day.
  const born = new Map();
  for (const p of fw) if (p.created) { const d = dayOf(timeOf.get(p.id)); born.set(d, (born.get(d) || 0) + 1); }
  columns(card(t('newPerDay'), t('newPerDaySub'), true), born, 'nProjects');
  const rel = new Map();
  for (const p of fw) for (const v of versionsOf.get(p.id)) { const d = dayOf(v.t); rel.set(d, (rel.get(d) || 0) + 1); }
  columns(card(t('relPerDay'), t('relPerDaySub'), true), rel, 'nReleases');

  // Largest families: every project counted under the line it comes from.
  const size = p => children.get(p.id).reduce((n, c) => n + 1 + size(c), 0);
  bars(card(t('families'), t('familiesSub')),
    projects.map(p => ({ id: p.id, label: p.name, value: size(p) })).filter(r => r.value).sort((a, b) => b.value - a.value).slice(0, 10));
  bars(card(t('mostStarred'), t('mostStarredSub')),
    fw.filter(p => p.stars).sort((a, b) => b.stars - a.stars).slice(0, 10).map(p => ({ id: p.id, label: p.name, value: p.stars })));
  bars(card(t('mostForked'), t('mostForkedSub')),
    fw.map(p => ({ id: p.id, label: p.name, value: Math.max(p.forks || 0, children.get(p.id).length) })).filter(r => r.value).sort((a, b) => b.value - a.value).slice(0, 10));
  bars(card(t('hardware'), t('hardwareSub')), topWithOther(tally(fw, p => hardwareOf(p)), 6));
  bars(card(t('licenses')), topWithOther(tally(fw, p => p.license || t('notStated')), 6));
  bars(card(t('topAuthors'), null, true), topWithOther(tally(fw, p => p.author), 10).filter(r => !r.other));
}

// ---------- Sort & filter panel ----------
const sortOptions = $('#sortOptions');
for (const [key, label] of Object.entries(SORTS)) {
  const b = el('button', 'opt');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.dataset.sort = key;
  b.append(el('span', null, label), fi('checkmark'));
  b.addEventListener('click', () => setSort(key));
  sortOptions.append(b);
}
function syncPanel() {
  for (const b of sortOptions.children) b.setAttribute('aria-checked', String(b.dataset.sort === state.sort));
  for (const b of $$('#statusSeg button')) b.setAttribute('aria-pressed', String(b.dataset.status === state.status));
  for (const b of $$('#modeSeg button')) b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
  syncSeg($('#statusSeg'));
  syncSeg($('#modeSeg'));
  $('#panelBadge').hidden = state.status === 'all' && state.mode === 'main';
}
function setSort(key) { state.sort = key; store.set('sort', key); syncPanel(); renderList(); }
function setStatus(s) { state.status = s; store.set('status', s); syncPanel(); paint(); renderList(); }
function setMode(m) {
  queueMicrotask(syncTools);
  state.mode = m;
  store.set('mode', m);
  if (m === 'main') { state.open.clear(); state.pinned.clear(); if (state.selected) state.pinned.add(state.selected); }
  syncPanel();
  relayout();
  paint();
  applyView();
}
for (const b of $$('#statusSeg button')) b.addEventListener('click', () => setStatus(b.dataset.status));
for (const b of $$('#modeSeg button')) b.addEventListener('click', () => setMode(b.dataset.mode));
function openPanel() {
  panel.hidden = false;
  panelBtn.setAttribute('aria-expanded', 'true');
  syncSeg($('#statusSeg'));
  syncSeg($('#modeSeg'));
  (panel.querySelector('#sortGroup:not([hidden]) [aria-checked="true"]') || panel.querySelector('.seg button[aria-pressed="true"]'))?.focus({ preventScroll: true });
}
function closePanel(focusBtn) {
  panel.hidden = true;
  panelBtn.setAttribute('aria-expanded', 'false');
  if (focusBtn) panelBtn.focus();
}
panelBtn.addEventListener('click', () => panel.hidden ? openPanel() : closePanel(false));
document.addEventListener('pointerdown', e => {
  if (!panel.hidden && !panel.contains(e.target) && !panelBtn.contains(e.target)) closePanel(false);
});

// ---------- Search ----------
let matchCursor = -1;
searchInput.addEventListener('input', () => {
  state.query = searchInput.value.trim().toLowerCase();
  matchCursor = -1;
  const n = state.query ? projects.filter(matchesQuery).length : 0;
  $('#searchCount').textContent = state.query ? String(n) : '';
  $('#searchClear').classList.toggle('show', !!searchInput.value);
  relayout();   // matches come out of "Other" while searching
  paint();
  applyView();
  renderList();
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const hits = layout.items.filter(it => it.kind === 'project' && passes(it.p));
    if (!hits.length) return;
    matchCursor = (matchCursor + 1) % hits.length;
    selectNode(hits[matchCursor].id, { navigate: true });
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    if (searchInput.value) { searchInput.value = ''; searchInput.dispatchEvent(new Event('input')); }
    else searchInput.blur();
  }
});
$('#searchClear').addEventListener('click', () => { searchInput.value = ''; searchInput.dispatchEvent(new Event('input')); searchInput.focus(); });

// ---------- Global ----------
$('#closeInfo').addEventListener('click', () => clearSelection());
document.addEventListener('keydown', e => {
  const typing = e.target.matches('input, textarea');
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); searchInput.focus(); searchInput.select(); return; }
  if (e.key === 'Escape') {
    if (!panel.hidden) { closePanel(true); return; }
    if (state.selected) { clearSelection(); return; }
  }
  if (typing || !isTree() || e.metaKey || e.ctrlKey || e.altKey) return;
  const r = safeRect(), cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
  if (e.key === '+' || e.key === '=') animateTo(zoomTarget(1.25, cx, cy), 200);
  else if (e.key === '-' || e.key === '_') animateTo(zoomTarget(1 / 1.25, cx, cy), 200);
  else if (e.key === '0') animateTo(fitView());
});
// On resize: reflow, then keep the same row in the middle (or the selection in view).
let resizeRaf = 0;
addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    const r0 = safeRect();
    const midY = viewReady ? ((r0.top + r0.bottom) / 2 - view.y) / view.k : 0;
    relayout({ animate: false });
    syncSeg($('#viewSeg'));
    if (!isTree()) { positionInfo(); return; }
    if (!viewReady || !userMoved) { viewReady = false; initViewOnce(); }
    else if (state.selected && layout.byItem.has(state.selected)) Object.assign(view, centerOnItem(state.selected));
    else { const r = safeRect(); view.y = (r.top + r.bottom) / 2 - midY * view.k; }
    applyView();
  });
});
addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (byId.has(id) && id !== state.selected) selectNode(id, { navigate: true });
});

// ---------- About ----------
const about = $('#about'), langSeg = $('#langSeg');
function showAboutLang(lang) {
  for (const b of langSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  for (const d of about.querySelectorAll('.about-body > [lang]')) d.classList.toggle('on', d.lang === lang);
  $('#aboutTitle').textContent = t('about');
  syncSeg(langSeg);
}
// Choosing a language here switches the whole site; the page reloads with the About open.
for (const b of langSeg.querySelectorAll('button')) b.addEventListener('click', () => {
  if (b.dataset.lang === getLang()) return;
  store.set('lang', b.dataset.lang);
  try { sessionStorage.setItem('felucca-tree:reopen-about', '1'); } catch {}
  location.reload();
});
$('#aboutBtn').addEventListener('click', () => {
  closePanel(false);
  about.showModal();
  showAboutLang(getLang());
});
about.querySelector('[data-close]').addEventListener('click', () => about.close());
// After a language change from the About tabs, open it again.
try { if (sessionStorage.getItem('felucca-tree:reopen-about')) { sessionStorage.removeItem('felucca-tree:reopen-about'); setTimeout(() => $('#aboutBtn').click(), 0); } } catch {}
about.addEventListener('click', e => { if (e.target === about) about.close(); }); // click on the backdrop
about.addEventListener('close', () => $('#aboutBtn').focus({ preventScroll: true }));

// ---------- Tree toolbar ----------
// Expand all = the "All" projects mode. Emphasis scales each project by forks or stars
// (log scale, 0..1 as --w), so big projects read strong and small ones step back.
const forkCount = p => Math.max(p.forks || 0, children.get(p.id).length);
function applyEmphasis() {
  const kind = state.emphasis;
  document.body.classList.toggle('emph', kind !== 'off');
  for (const b of $$('#emphSeg button')) b.setAttribute('aria-pressed', String(b.dataset.emph === kind));
  syncSeg($('#emphSeg'));
  if (kind === 'off') return;
  const value = p => kind === 'forks' ? forkCount(p) : (p.stars || 0);
  const max = Math.max(1, ...projects.map(value));
  for (const p of projects) {
    const w = Math.log10(value(p) + 1) / Math.log10(max + 1);
    const wrap = itemEls.get(p.id);
    for (const node of [wrap, lifeEls.get(p.id), tailEls.get(p.id), ...(verEls.get(p.id) || []).map(v => v.el)]) node?.style.setProperty('--w', w.toFixed(3));
    if (wrap) { wrap.classList.toggle('w2', w >= .55 && w < .8); wrap.classList.toggle('w3', w >= .8); }
  }
}
function setArcs(on) {
  state.arcs = on;
  store.set('arcs', on ? 'on' : 'off');
  document.body.classList.toggle('show-arcs', on);
  $('#arcsBtn').setAttribute('aria-pressed', String(on));
  drawArcs();
  if (on) arcEls.forEach(({ el: p }, i) => { if (p.getAttribute('d')) growArc(p, Math.min(i, 30) * 18); });
}
$('#arcsBtn').addEventListener('click', () => setArcs(!state.arcs));
function syncTools() {
  $('#expandAll').setAttribute('aria-pressed', String(state.mode === 'all'));
  $('#expandAll .label').textContent = state.mode === 'all' ? t('collapse') : t('expandAll');
  $('#expandAll').title = state.mode === 'all' ? t('collapseTitle') : t('expandTitle');
}
afterRelayout = applyEmphasis;
$('#expandAll').addEventListener('click', () => { setMode(state.mode === 'all' ? 'main' : 'all'); syncTools(); });
for (const b of $$('#emphSeg button')) b.addEventListener('click', () => {
  state.emphasis = b.dataset.emph;
  store.set('emphasis', state.emphasis);
  useWeights();
  relayout({ animate: true });
  applyEmphasis();
});

function useWeights() { weight = weights[state.emphasis] || weights.off; threshold = thresholds[state.emphasis] || thresholds.off; }
useWeights();

// ---------- Start ----------
const initial = decodeURIComponent(location.hash.slice(1));
if (byId.has(initial)) state.pinned.add(initial);
relayout({ animate: false });
syncPanel();
paint();
renderList();
setView(state.view);
if (byId.has(initial)) selectNode(initial);
requestAnimationFrame(() => { syncSeg($('#viewSeg')); syncSeg($('#statusSeg')); syncSeg($('#modeSeg')); });
syncTools();
applyEmphasis();
requestAnimationFrame(() => syncSeg($('#emphSeg')));
setArcs(state.arcs);
