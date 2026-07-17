# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo does

Scrapes daily notifiable-disease notification snapshots for Australia from the NINDSS PowerBI dashboard (https://nindss.health.gov.au/pbi-dashboard/) and archives them as JSON files in `data/`. A GitHub Actions workflow runs the scraper daily and commits the results — there is no application code to build or deploy, just a data pipeline.

## Commands

- Install dependencies: `npm install`
- Run the daily scraper (all-time totals): `node index.js` (writes `data/<report_date>_notifications.json`)
- Run the per-year breakdown (on request): `node index.js year` (writes `data/<report_date>_notifications_year.json`)
- Run the monthly history (on request): `node index.js month` (writes `data/<report_date>_notifications_month.json`)
- There are no tests, lint, or build steps configured (`npm test` is a stub that always fails).

## Architecture

The scraper is split across three files, all reverse-engineering the PowerBI embed API rather than using any public NINDSS API:

- `powerbi.js` — the shared DAX query client, with no CLI entry point of its own. Exports `STATE_CODES`/`MONTH_NAMES` plus:
  1. `getConfig()` — fetches the dashboard HTML page and extracts the `embedconfig` attribute from the `div.powerbi` element, base64-decoding it to get a report ID and embed token.
  2. `getToken()` — exchanges the embed token for a short-lived MWC token and capacity URI via PowerBI's `modelsAndExploration` endpoint.
  3. `getLatestUpdateDate()` — queries the `DataRefreshAEST` table (the same source backing the dashboard's "Last refreshed on" card) and returns both `reportDate` (`YYYYMMDD`, used for the filename/grouping key) and `lastRefreshed` (full AEST/AEDT timestamp, same underlying value with time preserved).
  4. `getCaseNumbers(..., mode)` — queries `NOTIFIABLE_EVENT_FACT` joined with `LOCATION_DIM`/`DISEASE_DIM`/`CASE_DIM` for per-state notification counts for one disease (restricted to Confirmed/Probable cases and excluding the `Hepatitis C (<24 months)` and `Unknown` disease groups). `mode` drives the query granularity AND return shape: `total` → `{ <state>: count }`; `year` → `{ <year>: { <state>: count } }`; `month` → `{ <year>: { <month>: { <state>: count } } }`. **Each file is queried at its own granularity, never derived from a finer one, on purpose:** the dashboard masks any cell `<5`, and summing masked finer cells accumulates the loss (COVID-19's lifetime total: 12,302,011 queried as `total`, 12,302,009 summed from `year`, 12,301,939 summed from `month`). Coarser = less masked (a cell `<5`/month is usually `≥5`/year; a state's all-time total is masked only if `<5` forever), so each mode is the least-masked source for its shape. Used by both `index.js` and `legacy.js`.
- `index.js` — the entry point (a single optional CLI arg selects the mode, defaulting to `'total'`). `getDiseaseList(mode)` queries the `DISEASE_DIM` table for all disease names, then for each one calls `getCaseNumbers(..., mode)` and flattens the result into the flat `rows` output (this is the single place the current-schema output shape/mode is decided). `mode` selects the query *granularity*, not just the output: `total` → one all-time row per disease; `year` → one row per disease+year; `month` → one row per disease+year+month. Writes `data/<reportDate>_notifications.json` (total, bare name), `..._notifications_year.json`, or `..._notifications_month.json` accordingly. On `total` mode it also calls `legacy.js`'s `writeLegacyCases(...)` with the already-fetched disease list.
- `legacy.js` — **deprecated, slated for removal.** `writeLegacyCases(capacityUri, token, reportDate, diseaseNames)` re-queries each disease at `year` granularity (via `powerbi.js`'s `getCaseNumbers`) and writes `data/<reportDate>_cases.json`, a flat array of `{ REPORT_DATE, DISEASE, YEAR, CODE, CASES }` records — the pre-rewrite schema, kept only for old consumers. This is the entire legacy surface: deleting `legacy.js` and its one call site in `index.js` (`getDiseaseList`'s `if (mode === 'total')` block) removes it cleanly. Only produced on `total`-mode runs (the daily cron); `year`/`month` on-request runs don't touch it.

All PowerBI requests are raw `fetch` calls with hand-built DAX query JSON bodies (`SemanticQueryDataShapeCommand`) sent as strings — there is no query builder abstraction. If PowerBI changes its dataset/report IDs or query shape, these request bodies (`DatasetId`, `ReportId`, `VisualId`, column/entity names) are what break and need updating.

The three modes also produce **two different response LAYOUTS**, because PowerBI rejects a secondary axis with no primary (`SecondaryGroupsWithoutPrimary`): `year`/`month` keep STATE on the *secondary* axis (the per-row `X` array, with the period(s) as primary rows), but `total` has no period dimension, so STATE moves to the *primary* axis — each `DM0` row is one state, projected as `C: [state, measure]`, and there is no `X` array or `SH` state list at all.

Response parsing relies on PowerBI's compact `dsr.DS[0]` result-set format (`PH`/`DM0`/`SH`/`DM1`). Two distinct sparse-encoding schemes are in play and are easy to conflate:
- **Measure sparsity** (the `X` array per row, one entry per state, in `year`/`month`): a state's `M0` is omitted when it repeats the previous state's value — see the "check if value exists, otherwise repeat" logic in `getCaseNumbers`.
- **Row sparsity** (the `DM0` rows themselves, whenever more than one value is projected onto a row): a row's `R` field is a bitmask marking which projections repeat from the previous row — only the *changed* ones are consumed off that row's `C` array, in order; the rest carry forward. This drives three cases: `month` projects dictionary-encoded `[year, month]` (`ds0.ValueDicts.D0`/`D1`), decoded to track `[year, month]`; `total` projects `[state, measure]` (the measure repeats over runs of equal counts, e.g. long stretches of 0); and `year` projects a single primary dimension, so there is no dictionary/bitmask at all — the year is read straight off the row as `G0`. Projecting an additional hierarchy level shifts PowerBI's `G`-numbering for every dimension after it — this is why the STATE secondary-axis key is `G1` in `year` mode but `G2` in `month` mode (adding Month bumps it), the most common source of silent breakage when adjusting these queries.

## Data output

All three `_notifications*` files use a flat, MySQL-friendly shape chosen so they load via a single `JSON_TABLE('$.rows[*]' …)` call. State counts are inlined in the fixed `STATE_CODES` order defined in `powerbi.js`; AUS/national is excluded by the query. Each file is queried at its own granularity and is **not** an exact sum of a finer one (coarser = less `<5` masking, so slightly higher and more accurate — see the note under `getCaseNumbers`).

- `data/YYYYMMDD_notifications.json` (daily, all-time totals) — `{ report_date, last_refreshed, columns: ["disease",<8 states>], rows: [ [disease, ...8 counts], … ] }`. 67 rows (one per disease), no `year` column.
- `data/YYYYMMDD_notifications_year.json` (on request) — adds a `year` column; `columns: ["disease","year",<8 states>]`. ~2.4k rows (67 diseases × ~36 years).
- `data/YYYYMMDD_notifications_month.json` (on request) — adds `year` and `month` (1-12); ~28k rows. The finest granularity, so it carries the most `<5` masking.
- `data/YYYYMMDD_cases.json` (daily, written alongside `_notifications.json` on `total`-mode runs) — **deprecated, see `legacy.js`.** A flat array of `{ REPORT_DATE, DISEASE, YEAR, CODE, CASES }` records (year granularity, one per disease+year+state), the pre-rewrite schema kept for old consumers.

New files accumulate via the CI workflow; existing files are never rewritten by hand. No historical data predates the current schema — old snapshots were deleted rather than migrated. (The bare `_notifications.json` name previously held year totals, and before that an even earlier same-day iteration nested `data.<disease>.<year>.<month>.<code>`, dropped because nested object keys can't be unnested by MySQL's `JSON_TABLE`.)

## CI

`.github/workflows/main.yml` runs on a twice-daily cron and via manual dispatch: checkout, `npm install`, run the scraper, then commits and pushes any new/changed files in `data/` directly to `main`. The scheduled cron passes no argument (all-time totals); the manual dispatch exposes a `mode` choice input (`total`/`year`/`month`) forwarded to `node index.js` to (re)generate the corresponding file.
