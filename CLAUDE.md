# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo does

Scrapes daily notifiable-disease notification snapshots for Australia from the NINDSS PowerBI dashboard (https://nindss.health.gov.au/pbi-dashboard/) and archives them as JSON files in `data/`. A GitHub Actions workflow runs the scraper daily and commits the results — there is no application code to build or deploy, just a data pipeline.

## Commands

- Install dependencies: `npm install`
- Run the daily scraper (all-time totals): `node index.js` or `node index.js all-time` (writes `data/notifications_all_time.json`, ~17-45s, 66 requests)
- Run the per-year breakdown: `node index.js year [Y|all]` — writes `data/notifications_by_year.json`, ~26-38s, 66 requests
- Run the daily history by diagnosis date: `node index.js day` (rolling 60 days) — writes `data/notifications_by_day_diagnostic.json`, ~11-31s, 66 requests
- Run the monthly history: `node index.js month [YM|Y|all]` — writes `data/notifications_by_month.json`, ~28-70s, 131 requests
- There are no tests, lint, or build steps configured (`npm test` is a stub that always fails).
- README.md (the data-consumer-facing schema doc) is not auto-checked against the code and can drift stale — verify its file paths/shapes against `data/` and this file before trusting it.

## Architecture

The scraper is split across three files, all reverse-engineering the PowerBI embed API rather than using any public NINDSS API:

- `powerbi.js` — the shared DAX query client, with no CLI entry point of its own. Exports `STATE_CODES`/`MONTH_NAMES` plus:

  **The measure (version 3.0).** Every query selects `Count_Notification`, not `Count_Notification_forgraph`. The `_forgraph` variant is what the dashboard visuals use, and it applies the `<5` mask — it reports a suppressed cell as a plain `0`, indistinguishable from a true zero. `Count_Notification` returns the real value. Confirmed against the dashboard on the Measles cells this repo already knew were masked (2019 ACT/SA/TAS, 2020 VIC/WA), and on Rabies 2026 QLD. The source REMOVED Rabies from its disease list on 8 Sep 2026, so that second cell can no longer be re-checked live.

  **Two encodings, both of which produce plausible wrong numbers if mishandled** — `parseMeasure` in `powerbi.js` handles both, and every read of a measure value must go through it:
  1. Values arrive as **formatted display strings**, quoted and comma-grouped: `"'1'"`, `"'7,208'"`. A true zero arrives as the integer `0` instead. Miss the comma and `parseInt` silently truncates 7,208 to 7.
  2. On the **secondary axis** (`year`/`month`, the per-row `X` arrays) the value is additionally **dictionary-encoded**: `M0` is an INDEX into one of `ds0.ValueDicts`, not the value. Which dict varies by mode — `D0` for `year`, `D2` for `month`, since `D0`/`D1` there hold the year/month dimensions — so `parseMeasure` reads the name off the `X` header's `DN` field rather than hardcoding it. Read as a count, an index gives believable garbage: Measles 2019 decoded as ACT 64/NSW 85/NT 28 instead of 2/62/31. The primary axis (`all-time`) returns literals, so no dict is passed there.

  **Every request is bounded.** `fetchWithRetry` is the only way this file reaches the network, and all 4 call sites go through it. It aborts at 30s and makes 3 attempts, backing off 2s then 4s. Before it, a stalled request waited forever: a run on 11 Sep 2026 spent ~100s on ONE disease and died on the CI step timeout with 62 of 66 left.

  It returns the PARSED BODY, not the `Response` — `parse` selects `'json'` (default) or `'text'`. That shape is the point, not a convenience: `fetch` resolves as soon as the HEADERS arrive, so returning the `Response` would leave the body read outside the timer, and a host that answers fast then stalls mid-body would hang exactly as before.

  Three more details that are easy to get wrong:
  - Each attempt builds a NEW `AbortController`. An aborted signal stays aborted, so one reused controller fails every retry instantly — the retry would look like it ran.
  - A 4xx does not retry, because it will never succeed; a 5xx and a 429 do. `fetch` resolves a 4xx/5xx normally, so the status is checked here rather than at the call site.
  - Retrying is only safe because every request is a read: one GET, and POSTs whose bodies are all `SemanticQueryDataShapeCommand` queries.

  After 3 attempts it throws, and the build function in `index.js` turns that into a named `query failed for <disease>` error — a give-up fails the run rather than writing a file short by one disease.

  1. `getConfig()` — fetches the dashboard HTML page and extracts the `embedconfig` attribute from the `div.powerbi` element, base64-decoding it to get a report ID and embed token.
  2. `getToken()` — exchanges the embed token for a short-lived MWC token and capacity URI via PowerBI's `modelsAndExploration` endpoint.
  3. `getLatestUpdateDate()` — queries the `DataRefreshAEST` table (the same source backing the dashboard's "Last refreshed on" card) and returns both `reportDate` (`YYYYMMDD`, used for the filename/grouping key) and `lastRefreshed` (full AEST/AEDT timestamp, same underlying value with time preserved).
  4. `getCaseNumbers(..., mode)` — queries `NOTIFIABLE_EVENT_FACT` joined with `LOCATION_DIM`/`DISEASE_DIM`/`CASE_DIM` for per-state notification counts for one disease (restricted to Confirmed/Probable cases and excluding the `Hepatitis C (<24 months)` and `Unknown` disease groups). `mode` drives the query granularity AND return shape: `all-time` → `{ <state>: count }`; `year` → `{ <year>: { <state>: count } }`; `month` → `{ <year>: { <month>: { <state>: count } } }`. Each mode is queried at its own granularity, never derived from a finer one. This is the only query path: `all-time` and both `index.js` build functions come through it. An optional 5th arg `onlyYear` restricts a `month` query to one `DAX_Year` — needed because PowerBI truncates a result set at 500 year-month cells, which silently drops everything past ~41 years.
  **The disease list is not stable.** `getDiseaseList` reads it live from
  `DISEASE_DIM` on every run, so the row count follows the source. It fell from
  67 to 66 on 8 Sep 2026 when the source dropped `Rabies`, which held a real
  count (QLD 1). A disappearance is silent: no error, just one row fewer in
  every file. `data/archive/` is how you find one — compare the current
  `notifications_all_time.json` against a past day's copy.

  5. `data/ref_disease_year_map.json` — written by a separate reference pass, not by the scrape modes. Maps each disease to the exact list of years it has cases in, plus a repo-wide `floor_year`. `buildMonthOutput` uses it to skip a 25-year block a disease has no years in, which cuts a full rebuild from 335 requests to 131. A missing map is safe — every block then falls back to a live query.

     The list matters more than a first/last range would. 22 diseases have gaps inside their span (Chlamydial infection is active in 39 of 89 years), so a range would query thousands of empty years. `floor_year` also replaced a hardcoded 1990 floor that silently dropped real pre-1990 cases (Chlamydial infection back to 1938, Gonococcal to 1973), which made `all-time` disagree with the year files.

- `index.js` — the entry point. First CLI arg selects the mode (`all-time` default, or `day`/`year`/`month`), with an optional second `scopeArg`. `getDiseaseList(mode, scopeArg)` queries `DISEASE_DIM` for the disease names, then delegates to one build function per mode. Every mode writes ONE flat file in `data/` and always rebuilds it whole — a scoped run would otherwise drop every period it did not target. Each build routes its queries through `countedGetCaseNumbers`, so `logRun` can record the exact request count in `data/log.json`.

  **Request cost per mode**, measured and logged. Each mode is one query per
  disease, except `month`. The request count TRACKS the disease count, so it
  moves when the source adds or drops a disease — read the current figure off
  `data/log.json` rather than trusting the table. Seconds vary by a factor of 3
  between runs, because the dashboard's own response time dominates.

  | Mode | Requests | Seconds (measured range) |
  | --- | --- | --- |
  | `all-time` | 66 | 17-45 |
  | `year` (full history) | 66 | 26-38 |
  | `day` (60-day window) | 66 | 11-31 |
  | `month` (full history) | 131 | 28-70 |

  - `buildYearOutput` — one `getCaseNumbers(..., 'year')` per disease returns EVERY year at once, so scope only picks the span written, never the cost. It ALSO rewrites `ref_disease_year_map.json` from the years the query returned, as a free by-product. **`year` must therefore run before `month`**, which reads that map; the CI workflow orders them accordingly. `floor_year` comes from the query data, never from the previous map — reading it back would pin the floor forever and hide any earlier year the source later exposes.
  - `buildDayOutput` — one query per disease covers the WHOLE window, grouping on `DIAGNOSIS_DATE` (primary) with STATE secondary. The date arrives as `G0`, the same single-primary-dimension shape `year` uses. Keep the window under 500 days. One row is one day with cases, so the 500-row cap bites at 500 days, NOT at 365 — measured 6 Sep 2026: 249 and 365 days returned every row, while 614, 730, 1096 and 2441 days all returned exactly 500 and dropped the NEWEST data with no error.
  - `buildMonthOutput` — one query per disease-BLOCK of `MONTH_BLOCK` (25) years. 25 × 12 = 300 cells, under the cap. `ref_disease_year_map.json` skips a block a disease has no years in, which is what keeps this at 131 rather than 335.

  **The 500-row cap is the constraint behind all of this.** It applies whenever a SECONDARY axis is present, and `Window.Count` does NOT raise it — 500, 1000, 5000 and 20000 all return exactly 500 rows. It is SILENT: three different diseases returned identical spans ending at the same date, which only looked wrong because they were compared. Any query returning exactly 500 rows must be treated as truncated.

  Dropping the secondary axis DOES lift the cap (13,379 rows returned), but then `Count_Notification` returns 0 under a date grouping, and the `_forgraph` measure that does work re-applies the <5 mask — verified: Measles 2019 ACT (true value 2) and Rabies 2026 QLD (true value 1, before the source dropped Rabies) both came back 0. So per-state counts and a long history cannot be had in one query. This is why `day` is windowed and `month` is blocked.

All PowerBI requests are raw `fetch` calls with hand-built DAX query JSON bodies (`SemanticQueryDataShapeCommand`) sent as strings — there is no query builder abstraction. If PowerBI changes its dataset/report IDs or query shape, these request bodies (`DatasetId`, `ReportId`, `VisualId`, column/entity names) are what break and need updating.

The 4 modes also produce **two different response LAYOUTS**, because PowerBI rejects a secondary axis with no primary (`SecondaryGroupsWithoutPrimary`): `year`/`month` keep STATE on the *secondary* axis (the per-row `X` array, with the period(s) as primary rows), but `all-time` has no period dimension, so STATE moves to the *primary* axis — each `DM0` row is one state, projected as `C: [state, measure]`, and there is no `X` array or `SH` state list at all.

Response parsing relies on PowerBI's compact `dsr.DS[0]` result-set format (`PH`/`DM0`/`SH`/`DM1`). Two distinct sparse-encoding schemes are in play and are easy to conflate:
- **Measure sparsity** (the `X` array per row, one entry per state, in `year`/`month`): a state's `M0` is omitted when it repeats the previous state's value — see the "check if value exists, otherwise repeat" logic in `getCaseNumbers`.
- **Row sparsity** (the `DM0` rows themselves, whenever more than one value is projected onto a row): a row's `R` field is a bitmask marking which projections repeat from the previous row — only the *changed* ones are consumed off that row's `C` array, in order; the rest carry forward. This drives three cases: `month` projects dictionary-encoded `[year, month]` (`ds0.ValueDicts.D0`/`D1`), decoded to track `[year, month]`; `all-time` projects `[state, measure]` (the measure repeats over runs of equal counts, e.g. long stretches of 0); and `year` projects a single primary dimension, so there is no dictionary/bitmask at all — the year is read straight off the row as `G0`. Projecting an additional hierarchy level shifts PowerBI's `G`-numbering for every dimension after it — this is why the STATE secondary-axis key is `G1` in `year` mode but `G2` in `month` mode (adding Month bumps it), the most common source of silent breakage when adjusting these queries.

## Data output

Seven flat files in `data/`, plus the `data/archive/` folder. The four `notifications_*` files are the dataset; the three `ref_*` files are reference data the scraper writes for itself.

Each `notifications_by_*` file is an ARRAY of period objects, each keeping the full `{ last_refreshed, <period>, columns, rows }` shape. `columns` is `["disease", <8 state codes>]` in the fixed `STATE_CODES` order; AUS/national is excluded by the query. Counts are unmasked (version 3.0) and are that period's OWN count, never a running total — a consumer must NOT subtract the prior period.

- `data/notifications_all_time.json` — `{ report_date, last_refreshed, columns, rows }`, one row per disease, cumulative to date. Not an array.
- `data/notifications_by_day_diagnostic.json` — 60 elements, keyed `date` (`YYYY-MM-DD`). A rolling window by DIAGNOSIS_DATE, always rebuilt whole. The `_diagnostic` suffix is now redundant, but renaming it would break every consumer, so it stays.

  A second daily file on NOTIFICATION_DATE, and its `reported` mode, were removed on 8 Sep 2026. The columns disagree by about 27% over a year, and only the diagnosis basis reconciles with the month and year files. `powerbi.js` now hardcodes `DIAGNOSIS_DATE`; restoring the other column means re-deriving it from the dashboard.
- `data/notifications_by_month.json` — 1,065 elements, keyed `year` + `month`.
- `data/notifications_by_year.json` — 89 elements, keyed `year`, from `floor_year` (1938).
- `data/ref_disease_groups.json`, `data/ref_disease_year_map.json` — see Architecture.
- `data/log.json` — one entry per run: mode, scope, start time, seconds, request count. Last 100 kept. Query it to see what a mode costs.
- `data/archive/<YYYYMMDD>_notifications_by_day_diagnostic.json` — a copy of the day-diagnostic file as it stood BEFORE the run that replaced it, flat in the folder, no subfolders. Every date is kept, and nothing is pruned. The date prefix comes from the copy's OWN `last_refreshed`, never from today, so a run that finds no new refresh cannot mislabel a copy. A same-date copy overwrites, so a re-run is safe.

  **Only this 1 file is archived.** Its newest days are incomplete and keep rising for weeks, so a past copy shows what the numbers looked like before the late notifications landed — no other file has that property. At 167 KB a day the series costs about 61 MB a year. Archiving all 5 would cost 1.3 GB a year, and git already holds every past version as a delta.

  `writeWithArchive` in `index.js` writes it. The 20260906 and 20260907 copies were backfilled from git history; the mode did not exist before then.

Days sum to months and months to years, verified to 0 difference across 618,544 cells. Every file is rebuilt WHOLE on each run, because a scoped run would otherwise drop every period it did not target.

**The newest day entries are incomplete.** A diagnosis reaches the system days after the fact, so recent dates read low and keep rising for weeks. Do not read the tail-off as a real fall.

## CI

`refresh-check.js` is the scheduled runs' guard, and has no part in a scrape. `node refresh-check.js` prints the dashboard's current `last_refreshed`; `--stale` compares it against the OLDEST stamp across the 4 `notifications_*` files, exiting 0 when a scrape is worth running and 1 when the local data is already current. A missing folder or a missing timestamp reads as `null` and forces the scrape, so the guard fails OPEN — a bug in it cannot silently stop the cron.

`.github/workflows/main.yml` runs on a 3-times-daily cron and via manual dispatch: checkout, `npm install`, run the scraper, then commits and pushes any new/changed files in `data/` directly to `main`. The cron fires at 15:30, 16:30 and 20:30 AEDT. The dashboard refreshes about once a day at ~15:30, so 15:30 fires at the refresh itself and often finds nothing, 16:30 is the slot that reliably catches it, and 20:30 is the backup. GitHub queues the `schedule` event at low priority — measured starts ran 5 minutes to over 2 hours late, and some slots never fired at all — so no slot is guaranteed. The guard makes that safe: a late run still finds the new stamp, and a window with nothing new costs ~2 requests instead of ~330. A scheduled run that does proceed runs `all-time`, `day`, `year` and `month` in turn. The manual dispatch exposes a `mode` choice input (`all-time`/`day`/`year`/`month`) forwarded to `node index.js`, and always skips the guard — so a re-scrape can be forced. Every mode runs with no scope arg, so `year`/`month` only ever refresh the current period and `day` only its rolling 60-day window, never a full backfill.

The runner's speed against the PowerBI host is not stable. On 11 Sep 2026 a scheduled run needed ~100 seconds for ONE disease and hit the 15-minute step timeout with 62 of 66 left; a manual dispatch 40 minutes later finished `all-time` in 34s on the same runner type. The same query runs in 17s locally. Two changes cover this: `fetchWithRetry` in `powerbi.js` bounds each request (see Architecture), and the workflow timeouts are now 45 minutes on the job and 40 on the script step.
