#!/usr/bin/env node
// Build data/tree.json for the site from the FM-1 lineage database in db/.
// Follows db/GUIDE.md: read taxonomy.json (computed, ready to render) and works.csv;
// never edit the derived files there (edit db/data.json, then db/tools/build.py).
//
// Usage:
//   node scripts/build-data.mjs            # reads db/, writes data/tree.json
//   node scripts/build-data.mjs <dbDir> [outFile]
//
// Output: data/tree.json — only the fields the page needs. No dependencies; Node 18+.
// With a GitHub token it also adds stars, forks, last push and releases.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const srcDir = process.argv[2] ?? process.env.TREE_DB_DIR ?? 'db';
const outFile = process.argv[3] ?? 'data/tree.json';
const readText = async file => (await readFile(path.join(srcDir, file), 'utf8')).replace(/^\uFEFF/, '');
const readJson = async file => JSON.parse(await readText(file));

// Minimal RFC 4180 CSV reader (quoted fields, commas and newlines inside quotes).
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter(r => r.some(Boolean));
  return body.map(r => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ''])));
}

const [taxonomy, data, worksCsv] = await Promise.all([
  readJson('taxonomy.json'),
  readJson('data.json'),   // only for fields build.py doesn't carry over (website, license)
  readText('works.csv')
]);
let commit = null;
try { commit = execFileSync('git', ['-C', srcDir, 'rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}

const works = new Map(parseCsv(worksCsv).map(w => [w.id, w]));
const dataWorks = new Map(data.works.map(w => [w.id, w]));
const ids = new Set(taxonomy.nodes.map(n => n.id));
// Unproven hypotheses: shown as a dashed link, never as proof.
const candidates = new Map(taxonomy.candidate_relations.filter(c => ids.has(c.source)).map(c => [c.target, c.source]));
// Lateral relations (never ancestry) pointing at each node: used only to mix line colors.
const lateral = new Map();
for (const r of taxonomy.horizontal_relations) {
  if (!ids.has(r.source) || !ids.has(r.target) || r.relation === 'upstream-merge') continue;
  if (!lateral.has(r.target)) lateral.set(r.target, []);
  lateral.get(r.target).push([r.source, r.relation]);
}
// "Built on": for a project without a parent, the platform it was split from (extraction) or
// runs on (component, proven by a pinned submodule, or stated by the author: a readme
// relation, or one marked `stated` in data.json).
// Not ancestry in the database; the site draws it as a dotted line.
const statedEdges = new Set(data.edges.filter(e => e.stated).map(e => `${e.source}>${e.target}>${e.relation}`));
const builtOn = new Map();
for (const r of taxonomy.horizontal_relations) {
  if (!ids.has(r.source) || !ids.has(r.target)) continue;
  const ok = r.relation === 'extraction' || (r.relation === 'component' && (['git-submodule', 'readme'].includes(r.confidence) || statedEdges.has(`${r.source}>${r.target}>${r.relation}`)));
  if (!ok) continue;
  const prev = builtOn.get(r.target);
  if (!prev || (prev.relation !== 'extraction' && r.relation === 'extraction')) builtOn.set(r.target, { id: r.source, relation: r.relation });
}
// Display groups from nodes[].classification (GUIDE.md table).
const GROUPS = {
  'official-fm1-open': 'official',
  'unplaced': 'unplaced',
  'felucca-extracted-bsp': 'bsp',
  'pre-felucca-research': 'research',
  'stock-firmware-modification': 'stock-mod'
};

const ownerUrl = repo => {
  const m = /^https:\/\/github\.com\/([^/]+)/.exec(repo || '');
  return m ? `https://github.com/${m[1]}` : undefined;
};
// Drop empty values so the JSON stays small.
const compact = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));

const projects = taxonomy.nodes.map(n => {
  const work = works.get(n.id) ?? {};
  const primary = n.primary_parent && ids.has(n.primary_parent) ? n.primary_parent : undefined;
  const candidate = primary ? undefined : candidates.get(n.id);
  // Dates (GUIDE.md): first_public_date where recorded (prehistory, fm1_open), else repository creation.
  const created = n.first_public_date || work.github_created_at || undefined;
  return compact({
    id: n.id,
    name: n.name,
    aliases: n.aliases,
    parent: primary ?? candidate,
    tentative: candidate ? true : undefined,
    builtOn: primary || candidate ? undefined : builtOn.get(n.id)?.id,
    builtOnRelation: primary || candidate ? undefined : builtOn.get(n.id)?.relation,
    relation: n.primary_relation ?? undefined,
    group: GROUPS[n.classification],
    mix: lateral.get(n.id),
    kind: n.kind,
    hardware: n.hardware,
    created,
    author: work.author,
    authorUrl: ownerUrl(n.repo),
    repo: n.repo,
    website: dataWorks.get(n.id)?.website,
    license: dataWorks.get(n.id)?.license,   // a recorded license wins over GitHub's
    summary: dataWorks.get(n.id)?.summary,
    stage: dataWorks.get(n.id)?.stage,
    noLine: dataWorks.get(n.id)?.no_line || undefined,   // dot only: no line to the last push
    // Release histories kept by hand for projects released outside GitHub (Groove OS, Baud Girl).
    versions: dataWorks.get(n.id)?.releases?.map(v => compact({ name: v.name, date: v.date + 'T12:00:00Z', pre: v.pre || undefined }))
  });
});

// Stars, fork counts, last push, archive state, license and releases (as versions) from GitHub (GraphQL, 50 repos per request).
// Releases are skipped for branch URLs (…/tree/x): they belong to the whole repository, not that branch.
// Uses $GITHUB_TOKEN, or the GitHub CLI's token if it is logged in. Skipped without a token.
const token = process.env.GITHUB_TOKEN || (() => {
  try { return execFileSync('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
})();
// Only repository URLs (optionally …/tree/branch); a pull request or issue link is not the project's repo.
const repoKey = url => {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?(tree\/.*)?$/.exec(url || '');
  return m ? { owner: m[1], name: m[2].replace(/\.git$/, '') } : null;
};
// Installer, simulator and support links: the repository's homepage, its FUNDING.yml
// (fundingLinks) and links in its README, picked by keywords. Never a direct file download.
const FIRMWARE_LANGS = new Set(['C', 'C++', 'Assembly', 'Rust', 'Zig', 'Objective-C']);
const FUNDING = { GITHUB: 'GitHub Sponsors', PATREON: 'Patreon', KO_FI: 'Ko-fi', OPEN_COLLECTIVE: 'Open Collective', LIBERAPAY: 'Liberapay', BUY_ME_A_COFFEE: 'Buy Me a Coffee', POLAR: 'Polar', THANKS_DEV: 'thanks.dev', ISSUEHUNT: 'IssueHunt', LFX_CROWDFUNDING: 'LFX Crowdfunding', TIDELIFT: 'Tidelift', COMMUNITY_BRIDGE: 'Community Bridge' };
const SUPPORT_HOSTS = [
  [/(^|\.)ko-fi\.com$/, 'Ko-fi'], [/(^|\.)patreon\.com$/, 'Patreon'], [/(^|\.)buymeacoffee\.com$/, 'Buy Me a Coffee'],
  [/(^|\.)paypal\.(me|com)$/, 'PayPal'], [/(^|\.)itch\.io$/, 'itch.io'], [/(^|\.)liberapay\.com$/, 'Liberapay'],
  [/(^|\.)opencollective\.com$/, 'Open Collective'], [/(^|\.)gumroad\.com$/, 'Gumroad'], [/(^|\.)bandcamp\.com$/, 'Bandcamp'],
  [/(^|\.)cafecito\.app$/, 'Cafecito'], [/(^|\.)fourthwall\.com$/, 'Fourthwall']
];
const isFileUrl = u => /\.(zip|tar|gz|tgz|7z|bin|uf2|hex|dfu|img|exe|dmg|msi|pkg|apk|svg|png|jpe?g|gif)(\?|#|$)/i.test(u);
const isBadge = u => /(^|\.)(img\.shields\.io|shields\.io|badgen\.net)$/.test(hostOf(u));
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const supportName = u => {
  const h = hostOf(u);
  if (/^github\.com$/.test(h) && /\/sponsors\//.test(u)) return 'GitHub Sponsors';
  return SUPPORT_HOSTS.find(([re]) => re.test(h))?.[1] ?? null;
};
const INSTALLER = /install|flash|updater|update tool|web ?usb|webserial|programmer|uploader/i;
const SIMULATOR = /simulat|emulat|try it|play (it )?in (your|the) browser|web version|online demo|live demo|playground/i;
function findLinks(r, p) {
  const text = r.readme?.text ?? r.readmeLower?.text ?? '';
  const found = [];
  // A badge link [![alt](image)](target): the target, labelled by the badge's alt text.
  for (const m of text.matchAll(/\[!\[([^\]]*)\]\([^)]*\)\]\((https?:\/\/[^)\s]+)\)/g)) found.push({ label: m[1], url: m[2] });
  for (const m of text.matchAll(/\[([^\]]{1,120})\]\((https?:\/\/[^)\s]+)\)/g)) found.push({ label: m[1], url: m[2] });
  for (const m of text.matchAll(/<a [^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{0,120}?)<\/a>/g)) found.push({ label: m[2].replace(/<[^>]+>/g, ''), url: m[1] });
  // Bare and <angle-bracket> links: labelled by the rest of their line ("**Install it** (Chrome...): <url>").
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(/<(https?:\/\/[^>\s]+)>|(?<![(\["'=])\b(https?:\/\/[^\s)<>"'\]]+)/g)) {
      const url = (m[1] || m[2]).replace(/[.,;:]+$/, '');
      found.push({ label: line.replace(m[0], ' ').replace(/[*_`#>|-]/g, ' ').trim().slice(0, 120), url });
    }
  }
  if (r.homepageUrl) found.unshift({ label: 'homepage', url: r.homepageUrl });
  const usable = found.filter(f => !isBadge(f.url) && !isFileUrl(f.url) && !/\/(releases|blob|tree|issues|pull)\b/.test(f.url) && !/(^|\.)github\.com$/.test(hostOf(f.url)) || /\.github\.io$/.test(hostOf(f.url)));
  const out = {};
  const inst = usable.find(f => INSTALLER.test(f.label) || INSTALLER.test(f.url));
  if (inst) out.installer = inst.url;
  const sim = usable.find(f => f !== inst && (SIMULATOR.test(f.label) || /\/(sim|emu|simulator|emulator)(\/|$)/i.test(f.url)));
  if (sim) out.simulator = sim.url;
  const support = new Map();
  for (const l of r.fundingLinks ?? []) {
    const name = l.platform === 'CUSTOM' ? (supportName(l.url) ?? hostOf(l.url)) : (FUNDING[l.platform] ?? l.platform);
    if (name && !support.has(name)) support.set(name, l.url);
  }
  for (const f of found) {
    const name = isFileUrl(f.url) ? null : supportName(f.url);
    if (name && !support.has(name)) support.set(name, f.url);
  }
  if (support.size) out.support = [...support].map(([name, url]) => ({ name, url }));
  return out;
}

if (token) {
  const targets = projects.map(p => ({ p, key: repoKey(p.repo) })).filter(t => t.key);
  let filled = 0;
  for (let i = 0; i < targets.length; i += 25) {
    const batch = targets.slice(i, i + 25);
    const query = 'query {' + batch.map((t, j) =>
      ` r${j}: repository(owner: ${JSON.stringify(t.key.owner)}, name: ${JSON.stringify(t.key.name)}) { stargazerCount forkCount pushedAt languages(first: 10) { edges { size node { name } } } isArchived homepageUrl licenseInfo { spdxId name } fundingLinks { platform url } readme: object(expression: "HEAD:README.md") { ... on Blob { text } } readmeLower: object(expression: "HEAD:readme.md") { ... on Blob { text } } releases(first: 50, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { tagName name publishedAt createdAt isDraft isPrerelease } } }`
    ).join('') + ' }';
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'felucca-tree-build' },
      body: JSON.stringify({ query })
    });
    if (!res.ok) { console.warn(`GitHub API ${res.status}; stars skipped`); break; }
    const { data: result } = await res.json();
    batch.forEach((t, j) => {
      const r = result?.[`r${j}`];
      if (!r) return;
      if (r.stargazerCount) t.p.stars = r.stargazerCount;
      // Firmware code only (C, C++, assembly...): web pages and tools in the same repository are left out.
      const code = (r.languages?.edges ?? []).filter(e => FIRMWARE_LANGS.has(e.node.name)).reduce((n, e) => n + e.size, 0);
      if (code) t.p.codeBytes = code;
      if (r.forkCount) t.p.forks = r.forkCount;
      if (r.pushedAt) t.p.updated = r.pushedAt;
      if (r.isArchived) t.p.archived = true;
      Object.assign(t.p, findLinks(r, t.p));
      if (r.licenseInfo && !t.p.license) t.p.license = r.licenseInfo.spdxId && r.licenseInfo.spdxId !== 'NOASSERTION' ? r.licenseInfo.spdxId : 'Other';
      if (!/\/tree\//.test(t.p.repo)) {
        // Newest 50, listed oldest first.
        const versions = [...(r.releases?.nodes ?? [])].reverse()
          .filter(v => !v.isDraft && (v.publishedAt || v.createdAt))
          .map(v => compact({ name: v.tagName || v.name, date: v.publishedAt || v.createdAt, pre: v.isPrerelease || undefined }));
        if (versions.length) t.p.versions = versions;
      }
      filled++;
    });
  }
  console.log(`GitHub stars/forks/releases: ${filled}/${targets.length} repositories, ${projects.reduce((n, p) => n + (p.versions?.length ?? 0), 0)} releases in ${projects.filter(p => p.versions).length} projects`);
} else {
  console.warn('No GitHub token (set GITHUB_TOKEN or log in with gh); stars and forks not fetched.');
}

// A fork copies its upstream's README and FUNDING.yml, so the same installer, simulator or
// support link shows up under authors it doesn't belong to. Rules:
// 1. A link that names a GitHub account (github.com/x, x.github.io, x.itch.io, ko-fi.com/x, ...)
//    belongs to that account: its own projects keep it, other authors' projects lose it,
//    and the account's earliest project gets it if none of its projects had it.
// 2. Otherwise a link shared by several authors stays with the earliest project only.
{
  const ownerOfRepo = p => /^https:\/\/github\.com\/([^/]+)/.exec(p.repo || '')?.[1]?.toLowerCase() ?? null;
  const owners = new Set(projects.map(ownerOfRepo).filter(Boolean));
  const accountIn = u => {
    const h = hostOf(u), path = (() => { try { return new URL(u).pathname.toLowerCase(); } catch { return ''; } })();
    const seg = path.split('/').filter(Boolean);
    const cand = h === 'github.com' ? (seg[0] === 'sponsors' ? seg[1] : seg[0])
      : /\.(github\.io|itch\.io)$/.test(h) ? h.split('.')[0]
      : /^(ko-fi\.com|patreon\.com|buymeacoffee\.com|liberapay\.com|opencollective\.com|cafecito\.app)$/.test(h) ? seg[0]
      : null;
    return cand && owners.has(cand) ? cand : null;
  };
  const byCreated = (a, c) => (a.created || '9').localeCompare(c.created || '9');
  const firstOf = account => projects.filter(q => ownerOfRepo(q) === account).sort(byCreated)[0];
  const norm = u => u.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/sponsors\//, '/').replace(/[#?].*$/, '').replace(/\/+$/, '');
  const holders = new Map();
  for (const p of projects) for (const u of [p.installer, p.simulator, ...(p.support ?? []).map(s => s.url)].filter(Boolean)) {
    const k = norm(u);
    if (!holders.has(k)) holders.set(k, []);
    holders.get(k).push(p);
  }
  // Where a link belongs: a project, or null (whoever holds it keeps it).
  const home = (u, p) => {
    const acc = accountIn(u);
    if (acc) return ownerOfRepo(p) === acc ? null : firstOf(acc);
    const list = holders.get(norm(u)) ?? [];
    return new Set(list.map(ownerOfRepo)).size > 1 ? [...list].sort(byCreated)[0] : null;
  };
  let dropped = 0, moved = 0;
  const give = (q, kind, value) => {
    if (kind === 'support') {
      q.support ??= [];
      if (!q.support.some(s => norm(s.url) === norm(value.url))) { q.support.push(value); moved++; }
    } else if (!q[kind]) { q[kind] = value; moved++; }
  };
  for (const p of projects) {
    for (const kind of ['installer', 'simulator']) {
      if (!p[kind]) continue;
      const h = home(p[kind], p);
      if (h && h !== p) { give(h, kind, p[kind]); delete p[kind]; dropped++; }
    }
    if (p.support) {
      const kept = [];
      for (const s of p.support) {
        const h = home(s.url, p);
        if (h && h !== p) { give(h, 'support', s); dropped++; } else kept.push(s);
      }
      if (kept.length) p.support = kept; else delete p.support;
    }
  }
  console.log(`Links: ${dropped} taken off projects they were inherited by (${moved} given back to their owner's project)`);
}

// Support links a project's author asked not to show (data.json `hide_support`: service names).
for (const p of projects) {
  const hide = dataWorks.get(p.id)?.hide_support;
  if (!hide || !p.support) continue;
  p.support = p.support.filter(s => !hide.includes(s.name));
  if (!p.support.length) delete p.support;
}

// Author's Choice: the Felucca author's picks (site curation, not research data).
try {
  const { picks = [] } = JSON.parse(await readFile('data/authors-choice.json', 'utf8'));
  const known = new Set(projects.map(p => p.id));
  for (const id of picks) {
    if (known.has(id)) projects.find(p => p.id === id).pick = true;
    else console.warn(`Author's Choice: ${id} is not in the database`);
  }
} catch (err) { if (err.code !== 'ENOENT') throw err; }

// Code exchange between lines (uptake, shared code, merge back): drawn as arcs.
// "Influence" (design ideas only) stays in the database but is not shown: it can't be checked.
const EXCHANGE = new Set(['uptake', 'shared-code', 'upstream-merge']);
const exchanges = taxonomy.horizontal_relations
  .filter(r => EXCHANGE.has(r.relation) && ids.has(r.source) && ids.has(r.target))
  .map(r => ({ from: r.source, to: r.target, relation: r.relation }));

// Each database update leaves a dated line on the chart. The dates are the days (Japan time)
// of the commits that changed db/data.json, plus any listed in data/snapshots.json.
// Outside a git checkout, today's date is added to that file instead.
const snapFile = path.join(path.dirname(outFile), 'snapshots.json');
const seed = JSON.parse(await readFile(snapFile, 'utf8').catch(() => '[]'));
let gitDays = null;
try {
  gitDays = execFileSync('git', ['log', '--format=%cd', '--date=format-local:%Y-%m-%d', '--', path.join(srcDir, 'data.json')],
    { env: { ...process.env, TZ: 'Asia/Tokyo' }, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').filter(Boolean);
} catch {}
const snapshots = [...new Set([...seed, ...(gitDays ?? [])])].sort();
if (!gitDays?.length) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
  if (!snapshots.includes(todayStr)) snapshots.push(todayStr);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(snapFile, JSON.stringify(snapshots) + '\n');
}

const out = {
  snapshots,
  source: compact({ repo: 'kurogedelic/FM-1_CFW_Database', revision: taxonomy.revision, asOf: taxonomy.as_of, commit }),
  projects,
  exchanges
};

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(out, null, 1) + '\n');
const dated = projects.filter(p => p.created).length;
console.log(`Wrote ${outFile}: ${projects.length} projects (${dated} with dates) from ${out.source.repo}@${commit ?? 'unknown'} ${out.source.revision ?? ''}`);
