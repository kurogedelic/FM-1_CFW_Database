# Database

The lineage of custom firmware for the M-VAVE FM-1, recorded from first-party evidence: GitHub fork records, shared commits, identical source files, and each project's own README, NOTICE, LICENSING and CREDITS.

## Editing

`data.json` is the only file to edit. Then regenerate and check the rest:

```bash
python3 tools/build.py
python3 tools/check.py
```

## Files

| File | Generated | Contents |
|---|---|---|
| `data.json` | no | Works, relations, aliases and policy |
| `taxonomy.json` | yes | Each work with its single parent, lineage path and class; lateral relations; summary |
| `works.csv`, `edges.csv` | yes | Works and relations as tables |
| `transfers.csv` | yes | Lateral relations (code taken in, shared code, merges) |
| `ports.csv` | yes | Hardware ports (SMK-37, Tab5) |
| `aliases.csv` | yes | Former names and repositories |
| `taxonomy.mmd`, `lineage.newick` | yes | The Felucca tree for Mermaid and phylogenetics tools |

## Rules

- Each work has at most one parent, and only from a fork record, a shared commit, a first-party statement, or byte-identical source of the instrument itself.
- Running on another project's platform (a HAL, BSP or base) is not ancestry: it is a `component` relation.
- Without primary evidence a work stays unplaced. Names alone are never evidence.
- A version change does not split a work, and a renamed work stays one entry with its former names as aliases.

## Relations

- Parent: `derive`, `fork`, `port`, `variant`.
- Lateral, never ancestry: `uptake` (code taken in), `influence` (design only), `component` (platform or library), `extraction` (split out of a project), `shared-code` (identical files, no direction), `upstream-merge` (a port merged back).
- Unproven: `candidate`.

## Evidence, strongest first

| `confidence` | Meaning |
|---|---|
| `git-commit` | Shared Git commits |
| `github-api` | GitHub fork record |
| `git-submodule` | Pinned submodule (a dependency, not ancestry) |
| `git-blob` | Byte-identical files |
| `readme` | The project's own README, NOTICE, LICENSING or CREDITS |
| `repo-description` | The owner's repository description |
| `catalog` | A community catalogue only (candidates) |

## Classes (`taxonomy.json`, `classification`)

| Value | Meaning |
|---|---|
| `felucca-descendant` | In the Felucca tree |
| `official-fm1-open` | M-VAVE's `fm1_open` and what derives from it |
| `other-root-lineage` | Under AMB-1, which itself is not placed |
| `unplaced` | Parent not established, or a base or library |
| `felucca-extracted-bsp` | felucca-bsp, the hardware layer split from Felucca |
| `pre-felucca-research` | Analysis, tools and prototypes before Felucca |
| `stock-firmware-modification` | Patched or extended M-VAVE firmware |

`author_country` (on works): the country from the location the repository owner gives on their GitHub profile, as an ISO code. It is where they say they are, not nationality, and it is left out when the location is missing or unclear. It is not shown on the site.

IDs: the letters `F`, `S`, `O`, `T`, `Z` come from the first catalogue groups and say nothing about lineage; `P` marks work before Felucca; `N` marks later additions.
