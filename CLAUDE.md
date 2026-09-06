# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo does

Scrapes daily notifiable-disease notification snapshots for Australia from the NINDSS PowerBI dashboard (https://nindss.health.gov.au/pbi-dashboard/) and archives them as JSON files in `data/`. A GitHub Actions workflow runs the scraper daily and commits the results — there is no application code to build or deploy, just a data pipeline.

## Commands

- Install dependencies: `npm install`
- Run the daily scraper (all-time totals): `node index.js` or `node index.js all-time` (writes `data/notifications_all_time.json`, ~15s, 67 requests)
- Run the per-year breakdown: `node index.js year [Y|all]` — writes `data/notifications_by_year.json`, ~10s, 67 requests
- Run the daily history: `node index.js day` (rolling 30 days) — writes `data/notifications_by_day.json`, ~25s, 67 requests
- Run the monthly history: `node index.js month [YM|Y|all]` — writes `data/notifications_by_month.json`, ~28s, 132 requests
- There are no tests, lint, or build steps configured (`npm test` is a stub that always fails).
- README.md (the data-consumer-facing schema doc) is not auto-checked against the code and can drift stale — verify its file paths/shapes against `data/` and this file before trusting it.

## Architecture

The scraper is split across three files, all reverse-engineering the PowerBI embed API rather than using any public NINDSS API:

- `powerbi.js` — the shared DAX query client, with no CLI entry point of its own. Exports `STATE_CODES`/`MONTH_NAMES` plus:

  **The measure (version 3.0).** Every query selects `Count_Notification`, not `Count_Notification_forgraph`. The `_forgraph` variant is what the dashboard visuals use, and it applies the `<5` mask — it reports a suppressed cell as a plain `0`, indistinguishable from a true zero. `Count_Notification` returns the real value. Confirmed against the dashboard on Rabies 2026 QLD, and on the Measles cells this repo already knew were masked (2019 ACT/SA/TAS, 2020 VIC/WA).

  **Two encodings, both of which produce plausible wrong numbers if mishandled** — `parseMeasure` in `powerbi.js` handles both, and every read of a measure value must go through it:
  1. Values arrive as **formatted display strings**, quoted and comma-grouped: `"'1'"`, `"'7,208'"`. A true zero arrives as the integer `0` instead. Miss the comma and `parseInt` silently truncates 7,208 to 7.
  2. On the **secondary axis** (`year`/`month`, the per-row `X` arrays) the value is additionally **dictionary-encoded**: `M0` is an INDEX into one of `ds0.ValueDicts`, not the value. Which dict varies by mode — `D0` for `year`, `D2` for `month`, since `D0`/`D1` there hold the year/month dimensions — so `parseMeasure` reads the name off the `X` header's `DN` field rather than hardcoding it. Read as a count, an index gives believable garbage: Measles 2019 decoded as ACT 64/NSW 85/NT 28 instead of 2/62/31. The primary axis (`all-time`) returns literals, so no dict is passed there.
  1. `getConfig()` — fetches the dashboard HTML page and extracts the `embedconfig` attribute from the `div.powerbi` element, base64-decoding it to get a report ID and embed token.
  2. `getToken()` — exchanges the embed token for a short-lived MWC token and capacity URI via PowerBI's `modelsAndExploration` endpoint.
  3. `getLatestUpdateDate()` — queries the `DataRefreshAEST` table (the same source backing the dashboard's "Last refreshed on" card) and returns both `reportDate` (`YYYYMMDD`, used for the filename/grouping key) and `lastRefreshed` (full AEST/AEDT timestamp, same underlying value with time preserved).
  4. `getCaseNumbers(..., mode)` — queries `NOTIFIABLE_EVENT_FACT` joined with `LOCATION_DIM`/`DISEASE_DIM`/`CASE_DIM` for per-state notification counts for one disease (restricted to Confirmed/Probable cases and excluding the `Hepatitis C (<24 months)` and `Unknown` disease groups). `mode` drives the query granularity AND return shape: `all-time` → `{ <state>: count }`; `year` → `{ <year>: { <state>: count } }`; `month` → `{ <year>: { <month>: { <state>: count } } }`. Each mode is queried at its own granularity, never derived from a finer one. This is the only query path: `all-time` and both `index.js` build functions come through it. An optional 5th arg `onlyYear` restricts a `month` query to one `DAX_Year` — needed because PowerBI truncates a result set at 500 year-month cells, which silently drops everything past ~41 years.
  5. `data/ref_disease_years.json` — written by a separate reference pass, not by the scrape modes. Maps each disease to the exact list of years it has cases in, plus a repo-wide `floor_year`. `buildMonthOutput` uses it to skip a 25-year block a disease has no years in, which cuts a full rebuild from 335 requests to 132. A missing map is safe — every block then falls back to a live query.

     The list matters more than a first/last range would. 22 diseases have gaps inside their span (Chlamydial infection is active in 39 of 89 years), so a range would query thousands of empty years. `floor_year` also replaced a hardcoded 1990 floor that silently dropped real pre-1990 cases (Chlamydial infection back to 1938, Gonococcal to 1973).

     The list matters more than a first/last range would. 22 diseases have gaps inside their span (Chlamydial infection is active in 39 of 89 years), so a range would query thousands of empty years.

     `floor_year` also replaced a hardcoded 1990 floor that silently dropped real pre-1990 cases (Chlamydial infection back to 1938, Gonococcal to 1973) and made `all-time` disagree with the year files.
- `index.js` — the entry point. First CLI arg selects the mode (`all-time` default, or `day`/`year`/`month`), with an optional second `scopeArg`. `getDiseaseList(mode, scopeArg)` queries `DISEASE_DIM` for the disease names, then delegates to one build function per mode. Every mode writes ONE flat file in `data/` and always rebuilds it whole — a scoped run would otherwise drop every period it did not target. Each build routes its queries through `countedGetCaseNumbers`, so `logRun` can record the exact request count in `data/ref_run_log.json`.

  **Request cost per mode**, measured and logged. Each is one query per disease, except `month`:

  | Mode | Requests | Seconds |
  | --- | --- | --- |
  | `all-time` | 67 | ~15 |
  | `year` (full history) | 67 | ~10 |
  | `day` (30-day window) | 67 | ~25 |
  | `month` (full history) | 132 | ~28 |

  - `buildYearOutput` — one `getCaseNumbers(..., 'year')` per disease returns EVERY year at once, so scope only picks the span written, never the cost.
  - `buildDayOutput` — one query per disease covers the WHOLE window, grouping on `DIAGNOSIS_DATE` (primary) with STATE secondary. The date arrives as `G0`, the same single-primary-dimension shape `year` uses. Keep the window under ~365 days: one row per day with cases, against the 500-row cap.
  - `buildMonthOutput` — one query per disease-BLOCK of `MONTH_BLOCK` (25) years. 25 × 12 = 300 cells, under the cap. `ref_disease_years.json` skips a block a disease has no years in, which is what keeps this at 132 rather than 335.

  **The 500-row cap is the constraint behind all of this.** It applies whenever a SECONDARY axis is present, and `Window.Count` does NOT raise it — 500, 1000, 5000 and 20000 all return exactly 500 rows. It is SILENT: three different diseases returned identical spans ending at the same date, which only looked wrong because they were compared. Any query returning exactly 500 rows must be treated as truncated.

  Dropping the secondary axis DOES lift the cap (13,379 rows returned), but then `Count_Notification` returns 0 under a date grouping, and the `_forgraph` measure that does work re-applies the <5 mask — verified: Rabies 2026 QLD (true value 1) and Measles 2019 ACT (true value 2) both came back 0. So per-state counts and a long history cannot be had in one query. This is why `day` is windowed and `month` is blocked.

All PowerBI requests are raw `fetch` calls with hand-built DAX query JSON bodies (`SemanticQueryDataShapeCommand`) sent as strings — there is no query builder abstraction. If PowerBI changes its dataset/report IDs or query shape, these request bodies (`DatasetId`, `ReportId`, `VisualId`, column/entity names) are what break and need updating.

The three modes also produce **two different response LAYOUTS**, because PowerBI rejects a secondary axis with no primary (`SecondaryGroupsWithoutPrimary`): `year`/`month` keep STATE on the *secondary* axis (the per-row `X` array, with the period(s) as primary rows), but `all-time` has no period dimension, so STATE moves to the *primary* axis — each `DM0` row is one state, projected as `C: [state, measure]`, and there is no `X` array or `SH` state list at all.

Response parsing relies on PowerBI's compact `dsr.DS[0]` result-set format (`PH`/`DM0`/`SH`/`DM1`). Two distinct sparse-encoding schemes are in play and are easy to conflate:
- **Measure sparsity** (the `X` array per row, one entry per state, in `year`/`month`): a state's `M0` is omitted when it repeats the previous state's value — see the "check if value exists, otherwise repeat" logic in `getCaseNumbers`.
- **Row sparsity** (the `DM0` rows themselves, whenever more than one value is projected onto a row): a row's `R` field is a bitmask marking which projections repeat from the previous row — only the *changed* ones are consumed off that row's `C` array, in order; the rest carry forward. This drives three cases: `month` projects dictionary-encoded `[year, month]` (`ds0.ValueDicts.D0`/`D1`), decoded to track `[year, month]`; `all-time` projects `[state, measure]` (the measure repeats over runs of equal counts, e.g. long stretches of 0); and `year` projects a single primary dimension, so there is no dictionary/bitmask at all — the year is read straight off the row as `G0`. Projecting an additional hierarchy level shifts PowerBI's `G`-numbering for every dimension after it — this is why the STATE secondary-axis key is `G1` in `year` mode but `G2` in `month` mode (adding Month bumps it), the most common source of silent breakage when adjusting these queries.

## Data output

Seven flat files in `data/`, no subfolders. The four `notifications_*` files are the dataset; the three `ref_*` files are reference data the scraper writes for itself.

Each `notifications_by_*` file is an ARRAY of period objects, each keeping the full `{ last_refreshed, <period>, columns, rows }` shape. `columns` is `["disease", <8 state codes>]` in the fixed `STATE_CODES` order; AUS/national is excluded by the query. Counts are unmasked (version 3.0) and are that period's OWN count, never a running total — a consumer must NOT subtract the prior period.

- `data/notifications_all_time.json` — `{ report_date, last_refreshed, columns, rows }`, one row per disease, cumulative to date. Not an array.
- `data/notifications_by_day.json` — 30 elements, keyed `date` (`YYYY-MM-DD`). A rolling window, always rebuilt whole.
- `data/notifications_by_month.json` — 1,065 elements, keyed `year` + `month`.
- `data/notifications_by_year.json` — 89 elements, keyed `year`, from `floor_year` (1938).
- `data/ref_disease_groups.json`, `data/ref_disease_years.json` — see Architecture.
- `data/ref_run_log.json` — one entry per run: mode, scope, start time, seconds, request count. Last 100 kept. Query it to see what a mode costs.

Days sum to months and months to years, verified to 0 difference across 618,544 cells. Every file is rebuilt WHOLE on each run, because a scoped run would otherwise drop every period it did not target.

**The newest day entries are incomplete.** A diagnosis reaches the system days after the fact, so recent dates read low and keep rising for weeks. Do not read the tail-off as a real fall.

## CI

`refresh-check.js` is the scheduled runs' guard, and has no part in a scrape. `node refresh-check.js` prints the dashboard's current `last_refreshed`; `--stale` compares it against the OLDEST of the newest file in each of `data/all-time`, `data/day`, `data/year` and `data/month`, exiting 0 when a scrape is worth running and 1 when the local data is already current. A missing folder or a missing timestamp reads as `null` and forces the scrape, so the guard fails OPEN — a bug in it cannot silently stop the cron.

`.github/workflows/main.yml` runs on a 4-times-daily cron and via manual dispatch: checkout, `npm install`, run the scraper, then commits and pushes any new/changed files in `data/` directly to `main`. The cron fires at 08:00, 12:00, 16:00 and 20:00 AEDT, but the dashboard refreshes about once a day, so most windows find nothing new and the guard skips them in ~2 requests instead of ~2,000. A scheduled run that does proceed runs `all-time`, `day`, `year` and `month` in turn. The manual dispatch exposes a `mode` choice input (`all-time`/`day`/`year`/`month`) forwarded to `node index.js`, and always skips the guard — so a re-scrape can be forced. Every mode runs with no scope arg, so `year`/`month` only ever refresh the current period and `day` only its rolling 30-day window, never a full backfill.
