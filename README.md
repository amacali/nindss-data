# National Notifiable Disease Surveillance System data for Australia #
Notification-count snapshots from the NINDSS Portal (https://nindss.health.gov.au/pbi-dashboard/).

All files use the same flat `columns` + `rows` shape — a `columns` legend followed by one `rows` entry per disease, with the 8 state counts inlined in the fixed order given by `columns`. AUS/national is excluded. The four `notifications_by_*` files wrap those objects in an array, one per period.

Counts are unmasked. The NINDSS dashboard hides any cell below 5 and shows `n.p`, but the scraper reads the underlying measure that keeps those values, so a count of 1 or 2 appears here as 1 or 2 rather than 0.

**The disease list changes.** The scraper reads it live from the dashboard on every run, so a
disease can appear or disappear without warning. `Rabies` was dropped by the source on 8 Sep
2026, taking the row count from 67 to 66. Do not hardcode the list or the count. A past day in
`data/archive/` shows you what changed.

Each file is still queried at its own granularity. Read the granularity you need from its own file rather than summing a finer one — the totals are close but need not agree exactly, because the dashboard revises past counts and a file is only as current as its own `last_refreshed`.

### 📁 Five data files in `data/`

| File | Holds | Keyed by |
| --- | --- | --- |
| `notifications_all_time.json` | cumulative totals to date | — (one object) |
| `notifications_by_day_diagnostic.json` | 60 days, rolling window, by diagnosis date | `date` |
| `notifications_by_day.json` | 60 days, rolling window, by notification date | `date` |
| `notifications_by_month.json` | 1,065 months from 1938 | `year` + `month` |
| `notifications_by_year.json` | 89 years from 1938 | `year` |

The four `by_*` files are an ARRAY of period objects. Each element keeps the same shape, so a consumer can lift one out unchanged:

```json
[ { "last_refreshed": "2026-09-05T15:31:23+10:00",
    "year": 2025, "month": 3,
    "columns": ["disease","ACT","NSW","NT","QLD","SA","TAS","VIC","WA"],
    "rows": [ ["Anthrax",0,0,0,0,0,0,0,0], … ] } ]
```

`notifications_all_time.json` is a single object of that shape with `report_date` instead of a period key.

### 🗄️ Past days in `data/archive/`

`data/archive/` keeps a dated copy of `notifications_by_day_diagnostic.json` from every run, and nothing else:

```
data/archive/20260907_notifications_by_day_diagnostic.json
```

The prefix is that copy's own `last_refreshed` date. Every date is kept, so you can see how a given day's counts filled in over the following weeks as late notifications landed. The shape is identical to the live file.

The other 4 files are not archived — a full history of all 5 would add over 1 GB a year to this repo. For a past version of those, read git history.

**Counts are each period's OWN total, not a running total.** Do not subtract the prior period. Days sum to months and months to years, verified across 618,544 cells.

**The newest day entries are incomplete.** A diagnosis reaches the system days after the fact, so recent dates read low and keep rising for weeks. Do not read the tail-off as a real fall in cases.

Alongside sit `ref_disease_groups.json` and `ref_disease_year_map.json` (reference data the scraper writes for itself), and `log.json` — the last 100 runs with their timing and request counts.

| Field | Description |
| --- | --- |
| `report_date` | Reporting date AEDT. Only in `notifications_all_time.json` |
| `last_refreshed` | Full timestamp (AEST/AEDT) the underlying dashboard data was last refreshed. On the object in `notifications_all_time.json`, and on every element of the four `notifications_by_*` files. Use it to tell when a period was last regenerated |
| `date` / `year` / `month` | The period the counts in `rows` cover: `date` per day element, `year` per year element, both per month element |
| `columns` | Column order for every entry in `rows` |
| `rows[]` | `[disease, <count per state>]` — confirmed/probable notification counts for the file's own period |

Load `notifications_all_time.json` into MySQL in a single pass:
```sql
SELECT t.* FROM notifications,
JSON_TABLE(doc, '$.rows[*]' COLUMNS (
  disease VARCHAR(120) PATH '$[0]',
  act INT PATH '$[1]',  nsw INT PATH '$[2]',  nt  INT PATH '$[3]', qld INT PATH '$[4]',
  sa  INT PATH '$[5]',  tas INT PATH '$[6]',  vic INT PATH '$[7]', wa  INT PATH '$[8]'
)) AS t;
```
The `notifications_by_*` files are arrays, so they need one more level. The period comes off the element, and `NESTED PATH` unpacks that element's rows. This example is the month file; for the day file read `$.date`, and for the year file `$.year` alone:
```sql
SELECT t.* FROM notifications,
JSON_TABLE(doc, '$[*]' COLUMNS (
  month INT PATH '$.month',
  NESTED PATH '$.rows[*]' COLUMNS (
    disease VARCHAR(120) PATH '$[0]',
    act INT PATH '$[1]',  nsw INT PATH '$[2]',  nt  INT PATH '$[3]', qld INT PATH '$[4]',
    sa  INT PATH '$[5]',  tas INT PATH '$[6]',  vic INT PATH '$[7]', wa  INT PATH '$[8]'
  )
)) AS t;
```

## Changelog ##
- **6 Dec 2023** added index.js and setup workflow action
- **13 Jul 2026** switched data/YYYYMMDD_notifications.json (renamed from `_cases.json`) to a flat `columns`/`rows` format with an added `last_refreshed` timestamp; the daily file now carries year totals, with monthly history available on request as `_notifications_month.json`
- **13 Jul 2026** split the output into three granularities queried directly (to avoid `<5`-cell masking accumulating when summing): the daily `_notifications.json` now carries **all-time totals** (no year column), with per-year available on request as `_notifications_year.json` and per-month as `_notifications_month.json`. Note the daily file's schema changed — it no longer has a `year` column.
- **18 Jul 2026** replaced the combined `_notifications_year.json`/`_notifications_month.json` snapshots with per-period cache files under `data/year/<year>_notifications.json` and `data/month/<YYYYMM>_notifications.json`, each holding a cumulative total through that period rather than a per-period delta; moved the deprecated legacy schema to `data/legacy/<reportDate>_cases.json`
- **5 Sep 2026** moved the daily snapshots from the top level of `data/` into `data/day/<reportDate>_notifications.json`, so the 3 granularities each sit in their own folder (`data/day/`, `data/year/`, `data/month/`). The file shape is unchanged, but any consumer that reads the old top-level path needs the new path. `data/legacy/` did not move.
- **6 Sep 2026** renamed `data/day/` to `data/all-time/`. The folder holds cumulative totals to date, not a single day's count, so the old name contradicted `data/year/` and `data/month/`, which both hold their own period's count. The file shape and name are unchanged. `data/day/` now holds daily counts (see the next entry).
- **6 Sep 2026** added `data/day/<YYYYMMDD>_notifications.json`, a rolling 30-day window of per-day counts by diagnosis date — the same basis as `data/year/` and `data/month/`, and the dashboard's own default filter. Days sum to months and months to years, verified to 0 difference across all 67 diseases. The newest days are incomplete by nature and keep rising, so each run rebuilds the whole window.
- **6 Sep 2026** removed the deprecated legacy output: `legacy.js`, its call site, and the 274 files in `data/legacy/`. Any consumer still reading `data/legacy/<reportDate>_cases.json` must move to `data/year/`, which carries the same year-granularity counts in the current schema. The daily run is now about twice as fast, because legacy re-queried every disease a second time.
- **6 Sep 2026** widened the rolling daily window from 30 days to 60, for both `notifications_by_day.json` and `notifications_by_day_diagnostic.json`. Each file now holds 60 elements. The cost is unchanged at 67 requests per mode, because one query per disease covers the whole window. The ceiling is 500 days: past that the source returns exactly 500 rows and drops the newest data silently, measured 6 Sep 2026.
- **6 Sep 2026 — two daily bases** `notifications_by_day.json` now holds counts by NOTIFICATION_DATE. The diagnosis-date series moved to `notifications_by_day_diagnostic.json`, unchanged. **A consumer that reads the old path gets a different series under the same name, with no error** — the counts stay plausible, so check which basis you need. The two disagree by about 27% over a year. Only the diagnostic file reconciles with `notifications_by_month.json` and `notifications_by_year.json`, which both group on diagnosis date. A new `node index.js reported` mode builds the notification-date file; `node index.js day` still builds the diagnostic one.
- **6 Sep 2026 — one file per granularity** `data/` is now flat: `notifications_all_time.json`, `notifications_by_day.json`, `notifications_by_month.json` and `notifications_by_year.json`, replacing the `data/day/`, `data/month/`, `data/year/` and `data/all-time/` folders. Reference files moved to a `ref_` prefix. Every count is unchanged — verified across 618,544 cells. The rebuild also got much cheaper: month went from 1,745 requests to 132 (25-year blocks) and day from 2,010 to 67 (one query per disease), so a full rebuild of all four files is now about 80 seconds.
- **5 Sep 2026** added `last_refreshed` to every `data/year/` and `data/month/` file, as the first key, so a consumer can tell when a period file was last regenerated. New runs take the value from the dashboard, the same source the daily file uses. Existing files carry the timestamp of the commit that wrote them.
- **5 Sep 2026 — version 3.0 (unmasked)** switched every query to the `Count_Notification` measure, which returns the counts the dashboard suppresses as `n.p`. Cells that read 0 because the true value was below 5 now carry that value. The daily file recovered 41 cells, and the rebuilt year history recovered 1,684 across 60 diseases. Rabies was added upstream the same day and appears with 1 QLD case.

  Nothing was lost: no cell fell except where the dashboard itself revised the figure. The pre-3.0 snapshots were kept for comparison and then discarded once the rebuild was verified. `data/all-time/` (then `data/day/`) now holds only version 3.0 files.

- **6 Sep 2026 — per-period counts** `data/year/` and `data/month/` now hold **each period's own count** rather than a cumulative total through that period. A consumer that subtracted the prior period to get a delta must stop doing so, or it will double-subtract. The full history was rebuilt: 89 year files and 1,065 month files, from 1938.

  The year floor moved from a hardcoded 1990 to the earliest year in the data, which is 1938. That recovered real pre-1990 cases the old floor dropped, such as Chlamydial infection back to 1938 and Gonococcal to 1973, and it is why `all-time` and the year files now agree exactly.

  All 3 granularities reconcile for every disease and every state: 47,704 compared cells, no mismatch, and a shared total of 21,688,823.

- **6 Sep 2026 — one month file per year** `data/month/` now holds one file per year (`<year>_notifications.json`), containing an array of that year's months, instead of 1,065 files named `<YYYYMM>_notifications.json`. Each array element keeps the exact shape the per-month file had, headers included, so the counts are untouched — only the packaging changed. A consumer that opened a `YYYYMM` path must now open the year and pick the month, and a MySQL load needs a `NESTED PATH` (see above).

- **8 Sep 2026 — a rolling 7-day archive** `data/archive/<YYYYMMDD>/` now holds a copy of each `notifications_*` file as it stood before the run that replaced it, so a consumer can read a past day from a fixed path instead of git history. The folder date is the archived file's own `last_refreshed`, not the copy date. The newest 7 dates are kept. Nothing about the live files changed. 20260905 to 20260907 were backfilled from git history, and 20260905 holds 4 files rather than 5, because `notifications_by_day_diagnostic.json` did not exist then.

- **8 Sep 2026 — the source dropped `Rabies`** The disease list fell from 67 rows to 66. Rabies appeared upstream on 5 Sep with 1 QLD case and left 3 days later, so the row is gone from every file, including the full year and month history. Only that row went; the other 66 diseases carried on with their normal daily movement. A consumer that hardcodes 67 diseases, or that expects a fixed row order, breaks here. The list is read live from the dashboard on every run, so treat it as variable. `data/archive/20260907/` holds the last copies that still carry the row.

- **8 Sep 2026 — the archive is flat, dated, and diagnostic-only** `data/archive/<YYYYMMDD>/` becomes `data/archive/<YYYYMMDD>_notifications_by_day_diagnostic.json`. That file now keeps every date rather than 7, so you can see how a day's counts filled in over the following weeks. The other 4 files are no longer archived at all — a full history of all 5 costs over 1 GB a year, and git already holds every past version as a delta.
