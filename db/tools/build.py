"""Generate all derived files from data.json (the only file to edit).

Writes taxonomy.json, works.csv, edges.csv, transfers.csv, ports.csv, aliases.csv,
taxonomy.mmd and lineage.newick. Run tools/check.py afterwards.
"""
import csv
import io
import json
from collections import Counter

PRIMARY = ('derive', 'fork', 'port', 'variant')
ASSURANCE = {
    'readme': 'author-readme-claim',
    'github-api': 'git-host-fork-record',
    'git-commit': 'shared-commit-verified',
    'git-submodule': 'pinned-submodule-verified',
    'git-blob': 'byte-identical-source-verified',
    'repo-description': 'owner-repo-description',
}
NODE_KEYS = ['id', 'name', 'aliases', 'previous_repo_urls', 'repo', 'kind', 'hardware', 'primary_parent',
             'primary_relation', 'ancestry_evidence', 'ancestry_basis', 'assurance', 'port_status', 'base_revision',
             'upstream_pr_status', 'upstream_pr_url', 'upstream_pr_merged_at', 'source_catalog_group', 'notes',
             'root_id', 'lineage_path', 'clade_id', 'classification']
EDGE_KEYS = ['source', 'target', 'relation', 'confidence', 'evidence', 'notes']
WORK_COLS = ['id', 'name', 'aliases', 'previous_repo_urls', 'original_title', 'author', 'repo', 'hardware', 'family',
             'kind', 'status', 'source', 'notes', 'port_status', 'base_revision', 'upstream_pr_status',
             'upstream_pr_url', 'upstream_pr_merged_at', 'github_repo_exists', 'github_fork', 'github_fork_parent',
             'github_checked_at', 'github_created_at']
TRANSFER_COLS = ['source_id', 'source_name', 'target_id', 'target_name', 'relation', 'confidence', 'evidence',
                 'notes', 'source_sha', 'target_sha', 'identical_code_files', 'sample_paths', 'sha_method',
                 'sha_checked_at']
PORT_COLS = ['id', 'name', 'parent_id', 'parent_name', 'hardware', 'repo', 'source_url', 'confidence',
             'port_status', 'base_revision', 'upstream_pr_status', 'upstream_pr_url', 'merged_at', 'pr_closed_at',
             'pr_checked_at']
ALIAS_COLS = ['work_id', 'canonical_name', 'alias_type', 'alias_value', 'evidence', 'renamed_at', 'rename_evidence']


def cell(v):
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, list):
        return '; '.join(v)
    return '' if v is None else str(v)


def write_csv(path, cols, rows):
    b = io.StringIO()
    w = csv.writer(b, lineterminator='\n')
    w.writerow(cols)
    for r in rows:
        w.writerow([cell(r.get(c)) for c in cols])
    open(path, 'w', encoding='utf-8-sig', newline='').write(b.getvalue())


def write_json(path, obj):
    open(path, 'w').write(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')


def main():
    d = json.load(open('data.json'))
    works, edges = d['works'], d['edges']
    W = {w['id']: w for w in works}
    prim = {e['target']: e for e in edges if e['relation'] in PRIMARY}
    horiz = [e for e in edges if e['relation'] not in PRIMARY + ('candidate',)]
    cand = [e for e in edges if e['relation'] == 'candidate']

    def path(i):
        p = [i]
        while p[0] in prim:
            p.insert(0, prim[p[0]]['source'])
        return p

    nodes = []
    for w in works:
        i, e, p = w['id'], prim.get(w['id']), path(w['id'])
        root = W[p[0]]
        if e:
            if p[0] == 'F:1':
                cls = 'felucca-descendant'
            elif root.get('lineage_category') == 'official-fm1-open':
                cls = 'official-fm1-open'
            else:
                cls = 'other-root-lineage'
        else:
            cls = w.get('lineage_category') or ('felucca-descendant' if i == 'F:1' else 'unplaced')
        n = {k: w.get(k) for k in NODE_KEYS}
        n['aliases'] = w.get('aliases', [])
        n['previous_repo_urls'] = w.get('previous_repo_urls', [])
        n['source_catalog_group'] = w.get('family')
        n.update(
            primary_parent=e['source'] if e else None,
            primary_relation=e['relation'] if e else None,
            ancestry_evidence=e['evidence'] if e else None,
            ancestry_basis=e['confidence'] if e else w.get('ancestry_basis', 'unresolved'),
            assurance=ASSURANCE[e['confidence']] if e else w.get('assurance', 'unplaced'),
            root_id='F:1' if cls == 'felucca-extracted-bsp' else p[0],
            lineage_path=p,
            clade_id=(p[1] if len(p) > 1 else p[0]) if cls == 'felucca-descendant' else None,
            classification=cls,
        )
        for k in ('first_public_date', 'first_public_evidence'):
            if w.get(k):
                n[k] = w[k]
        nodes.append(n)

    roots = [n['id'] for n in nodes if not n['primary_parent']
             and n['classification'] in ('felucca-descendant', 'unplaced', 'official-fm1-open')]
    cls = Counter(n['classification'] for n in nodes)
    basis = Counter(n['ancestry_basis'] for n in nodes)
    summary = {
        'all_nodes': len(nodes), 'all_relations': len(edges),
        'felucca_nodes': cls['felucca-descendant'], 'official_open_nodes': cls['official-fm1-open'],
        'primary_edges': len(prim), 'horizontal_edges': len(horiz), 'candidate_edges': len(cand),
        'git_fork_edges': sum(e['relation'] == 'fork' for e in edges),
        'shared_commit_verified': basis['git-commit'], 'pinned_submodule_verified': basis['git-submodule'],
        'root_nodes': len(roots), 'unresolved_root_nodes': cls['unplaced'], 'aliases': len(d['aliases']),
        'tab5_ports': sum('Tab5' in (n['hardware'] or '') for n in nodes),
        'pre_felucca_research_nodes': cls['pre-felucca-research'],
        'stock_modification_nodes': cls['stock-firmware-modification'],
    }
    s = d['schema']
    write_json('taxonomy.json', {
        'schema_version': s['schema_version'], 'revision': s['taxonomy_revision'], 'as_of': d['as_of'],
        'policy': s['policy'], 'summary': summary, 'roots': roots, 'nodes': nodes,
        'horizontal_relations': [{k: e[k] for k in EDGE_KEYS} for e in horiz],
        'candidate_relations': [{k: e[k] for k in EDGE_KEYS} for e in cand],
        'competing_primary_edges': [],
    })

    write_csv('works.csv', WORK_COLS, works)
    write_csv('edges.csv', EDGE_KEYS, edges)
    write_csv('transfers.csv', TRANSFER_COLS, [
        dict(e, source_id=e['source'], source_name=W[e['source']]['name'],
             target_id=e['target'], target_name=W[e['target']]['name']) for e in horiz])
    write_csv('ports.csv', PORT_COLS, [
        dict(W[n['id']], parent_id=n['primary_parent'], parent_name=W[n['primary_parent']]['name'],
             source_url=n['ancestry_evidence'], confidence=n['ancestry_basis'],
             merged_at=W[n['id']].get('upstream_pr_merged_at')) for n in nodes if n['primary_relation'] == 'port'])
    write_csv('aliases.csv', ALIAS_COLS, d['aliases'])

    fel = [n for n in nodes if n['classification'] == 'felucca-descendant']
    sid = lambda i: 'n_' + i.replace(':', '_')
    lines = ['flowchart LR',
             '  %% Verified or first-party-claimed primary ancestry; lateral transfers, renamed aliases and '
             'merge-back edges are stored separately.']
    lines += [f'  {sid(n["id"])}["{n["name"]}"]' for n in fel]
    lines += [f'  {sid(n["primary_parent"])} {"-.->" if n["primary_relation"] == "port" else "-->"} {sid(n["id"])}'
              for n in fel if n['primary_parent']]
    lines += ['  classDef root fill:#e4e7eb,stroke:#666,color:#111', '  class n_F_1 root']
    open('taxonomy.mmd', 'w').write('\n'.join(lines) + '\n')

    kids = {}
    for n in fel:
        if n['primary_parent']:
            kids.setdefault(n['primary_parent'], []).append(n)
    label = lambda n: f"'{n['name']} [{n['id']}]'"

    def newick(n):
        c = sorted(kids.get(n['id'], []), key=lambda x: f"{x['name']} [{x['id']}]".lower())
        return ('(' + ','.join(newick(x) for x in c) + ')' if c else '') + label(n)
    open('lineage.newick', 'w').write(newick(next(n for n in fel if n['id'] == 'F:1')) + ';\n')


if __name__ == '__main__':
    main()
