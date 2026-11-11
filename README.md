# FM-1 CFW Database

Static site (GitHub Pages) for custom firmware of the M-VAVE FM-1: lineage, versions, installers and links.

- `index.html` — page and styles
- `app.js` — loads `data/tree.json` and draws the tree, the list and the Insight page (counts and rankings)
- `data/tree.json` — generated; do not edit by hand
- `db/` — the lineage database
- `scripts/build-data.mjs` — builds `data/tree.json` from `db/`
- `data/authors-choice.json` — Author's Choice picks
- `data/snapshots.json` — extra update dates; every day `db/data.json` changed in Git also gets a faint dated line on the chart

## Update the data

The lineage database lives in `db/` (see `db/README.md`).

1. Edit `db/data.json` only, then regenerate and check the database:
   ```bash
   cd db && python3 tools/build.py && python3 tools/check.py && cd ..
   ```
2. Build the site data (reads `db/taxonomy.json` and `db/works.csv`, and with a GitHub token adds stars, forks, last push and releases):
   ```bash
   node scripts/build-data.mjs
   ```

Node 18+, no dependencies.

How the data is shown:

- Lines follow `primary_parent`. Unproven `candidate_relations` are dashed.
- Dates: `first_public_date` where recorded (prehistory, fm1_open), else the repository's creation date. Undated projects have a hollow dot.
- A line runs to the repository's last push; the part after the last release is faded.
- Each GitHub release is a dot on the line; pre-releases and beta/alpha/rc names are hollow.
- Quiet stretches longer than two days are shortened to two days on the time axis.

## Publish

Pushing to `main` runs `.github/workflows/pages.yml`: it rebuilds and checks the database, builds `data/tree.json` with fresh GitHub numbers, and deploys the site to GitHub Pages.

## Preview locally

The page fetches JSON, so open it through a local server rather than as a file:

```bash
python3 -m http.server 8931
```
