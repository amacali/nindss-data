# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo does

Scrapes daily notifiable-disease notification snapshots for Australia from the NINDSS PowerBI dashboard (https://nindss.health.gov.au/pbi-dashboard/) and archives them as JSON files in `data/`. A GitHub Actions workflow runs the scraper daily and commits the results — there is no application code to build or deploy, just a data pipeline.

## Commands

- Install dependencies: `npm install`
- Run the scraper: `node index.js` (writes `data/<report_date>_notifications.json`)
- There are no tests, lint, or build steps configured (`npm test` is a stub that always fails).

## Architecture

`index.js` is the entire scraper, run start-to-finish as a script (no exports, no CLI args). It works by reverse-engineering the PowerBI embed API rather than using any public NINDSS API:

1. `getConfig()` — fetches the dashboard HTML page and extracts the `embedconfig` attribute from the `div.powerbi` element, base64-decoding it to get a report ID and embed token.
2. `getToken()` — exchanges the embed token for a short-lived MWC token and capacity URI via PowerBI's `modelsAndExploration` endpoint.
3. `getLatestUpdateDate()` — queries the `DataRefreshAEST` table (the same source backing the dashboard's "Last refreshed on" card) and returns both `reportDate` (`YYYYMMDD`, used for the filename/grouping key) and `lastRefreshed` (full AEST/AEDT timestamp, same underlying value with time preserved).
4. `getDiseaseList()` — the entry point (called at the bottom of the file). Queries the `DISEASE_DIM` table for all disease names, then for each one calls `getCaseNumbers()` and flattens the nested result into the flat `rows` output (this is the single place the output shape is decided) before writing `data/<reportDate>_notifications.json`.
5. `getCaseNumbers()` — queries `NOTIFIABLE_EVENT_FACT` joined with `LOCATION_DIM`/`DISEASE_DIM`/`CASE_DIM` for per-state, per-year, per-month notification counts for one disease (restricted to Confirmed/Probable cases and excluding the `Hepatitis C (<24 months)` and `Unknown` disease groups), returning a nested `{ <year>: { <month>: { <state>: count } } }` object that `getDiseaseList` flattens.

All PowerBI requests are raw `fetch` calls with hand-built DAX query JSON bodies (`SemanticQueryDataShapeCommand`) sent as strings — there is no query builder abstraction. If PowerBI changes its dataset/report IDs or query shape, these request bodies (`DatasetId`, `ReportId`, `VisualId`, column/entity names) are what break and need updating.

Response parsing relies on PowerBI's compact `dsr.DS[0]` result-set format (`PH`/`DM0`/`SH`/`DM1`). Two distinct sparse-encoding schemes are in play and are easy to conflate:
- **Measure sparsity** (the `X` array per row, one entry per state): a state's `M0` is omitted when it repeats the previous state's value — see the "check if value exists, otherwise repeat" logic in `getCaseNumbers`.
- **Hierarchy-row sparsity** (the `DM0` rows themselves, once more than one dimension is projected): dimension values are dictionary-encoded (`ds0.ValueDicts.D0`/`D1` for year/month) and a row's `R` field is a bitmask marking which dimensions repeat from the previous row — only the *changed* dimensions are consumed off that row's `C` array, in dimension order. `getCaseNumbers` decodes this to track `[year, month]` across rows. Projecting an additional hierarchy level shifts PowerBI's `G`-numbering for every dimension that comes after it (e.g. adding Month as a second primary dimension bumped the STATE secondary-axis key from `G1` to `G2`) — this is the most common source of silent breakage when adjusting these queries.

## Data output

`data/YYYYMMDD_notifications.json` — a flat, MySQL-friendly shape chosen so the file loads via a single `JSON_TABLE('$.rows[*]' …)` call: `{ report_date, last_refreshed, columns: ["disease","year","month",<8 state codes>], rows: [ [disease, year, month(1-12), ...8 counts], … ] }`. State counts are inlined in the fixed `STATE_CODES` order defined at the top of `index.js`; AUS/national is excluded by the query. Rows number ~28k/day (67 diseases × ~36 years × 12 months). New files accumulate daily via the CI workflow; existing files are never rewritten by hand. No historical data predates the current schema — old flat-format snapshots were deleted rather than migrated.

An earlier iteration of this schema (also same-day, uncommitted history aside) nested `data.<disease>.<year>.<month>.<code>`; it was replaced by the flat `columns`/`rows` form because nested object keys can't be unnested by MySQL's `JSON_TABLE`.

## CI

`.github/workflows/main.yml` runs on a daily cron (`0 21 * * *`) and via manual dispatch: checkout, `npm install`, `node index.js`, then commits and pushes any new/changed files in `data/` directly to `main`.
