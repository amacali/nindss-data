# National Notifiable Disease Surveillance System data for Australia #
Notification-count snapshots from the NINDSS Portal (https://nindss.health.gov.au/pbi-dashboard/).

All files use the same flat `columns` + `rows` shape — a `columns` legend followed by one `rows` entry per disease, with the eight state counts inlined in the fixed order given by `columns`. AUS/national is excluded. A `data/month/` file wraps 12 of those objects in an array, one per month.

Counts are unmasked. The NINDSS dashboard hides any cell below 5 and shows `n.p`, but the scraper reads the underlying measure that keeps those values, so a count of 1 or 2 appears here as 1 or 2 rather than 0.

Each file is still queried at its own granularity. Read the granularity you need from its own file rather than summing a finer one — the totals are close but need not agree exactly, because the dashboard revises past counts and a file is only as current as its own `last_refreshed`.

### 📅 data/all-time/YYYYMMDD_notifications.json (daily — all-time totals) ##
Written by the daily job (`node index.js`). One row per disease:
```json
{
  "report_date": "20240311",
  "last_refreshed": "2026-07-13T16:35:22+10:00",
  "columns": ["disease", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"],
  "rows": [
    ["COVID-19", 259439, 4198747, 115382, 1882504, 1023434, 331797, 3098250, 1392458]
  ]
}
```

### 📅 data/year/\<year>_notifications.json (on request — per year) ##
Generated on demand (`node index.js year`, `node index.js year 2019`, or `node index.js year all` for a full history rebuild). One file per year, one row per disease. Counts are **that year's own total**. Do not subtract the prior year:
```json
{
  "last_refreshed": "2026-09-05T15:31:23+10:00",
  "year": 2024,
  "columns": ["disease", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"],
  "rows": [
    ["COVID-19", 4791, 132640, 2834, 73662, 44120, 12170, 54331, 16088]
  ]
}
```

### 📅 data/month/\<year>_notifications.json (on request — monthly history) ##
Generated on demand (`node index.js month`, `node index.js month 2019`, or `node index.js month all` for a full history rebuild). One file per year, holding an **array of that year's months**. Each element carries its own full header, so a consumer can lift one month out whole. Counts are **that month's own total**, and the 12 months of a year sum to that year's file:
```json
[
  {
    "last_refreshed": "2026-09-05T15:31:23+10:00",
    "year": 2024,
    "month": 1,
    "columns": ["disease", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"],
    "rows": [
      ["COVID-19", 545, 16213, 309, 8538, 6992, 3171, 5349, 1703]
    ]
  },
  {
    "last_refreshed": "2026-09-05T15:31:23+10:00",
    "year": 2024,
    "month": 2,
    "columns": ["disease", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"],
    "rows": [
      ["COVID-19", 361, 9892, 261, 6681, 6088, 2814, 3216, 1052]
    ]
  }
]
```
A year that is still running holds only the months so far — 2026 has 9. A targeted run rewrites the whole year file, never a single month.

### 📅 data/day/YYYYMMDD_notifications.json (rolling 30 days — that day's own count) ##

One file per day, holding **that day's own per-state counts by diagnosis date** — not a running
total. The days of a month sum to that month's file, and the months sum to the year.

```json
{ "last_refreshed": "2026-09-05T15:31:23+10:00",
  "date": "2026-09-04",
  "columns": ["disease","ACT","NSW","NT","QLD","SA","TAS","VIC","WA"],
  "rows": [ ["Anthrax",0,0,0,0,0,0,0,0], … ] }
```

**The newest days are incomplete.** A diagnosis reaches the system days after the fact, so the
most recent dates read low and keep rising for weeks. Do not read the tail-off as a real fall in
cases. Each run rebuilds the whole 30-day window, so every file self-corrects as the late
diagnoses arrive.

### 📅 data/legacy/YYYYMMDD_cases.json (daily — deprecated) ##
Written alongside the daily all-time file for backwards compatibility with an old consumer; slated for removal, format frozen. A flat array of per disease/year/state records, not the `columns`/`rows` shape used elsewhere:
```json
[
  { "REPORT_DATE": "20240311", "DISEASE": "COVID-19", "YEAR": 2024, "CODE": "ACT", "CASES": 4791 }
]
```

| Field | Description |
| --- | --- |
| `report_date` | Reporting date AEDT, also used as the filename prefix (all-time file only) |
| `last_refreshed` | Full timestamp (AEST/AEDT) the underlying dashboard data was last refreshed. Present in every `data/all-time/` and `data/year/` file, and in every month element of a `data/month/` file. Use it to tell when a period was last regenerated |
| `year` / `month` | The period the counts in `rows` cover. `year` in `data/year/`; both in each element of a `data/month/` file |
| `columns` | Column order for every entry in `rows` |
| `rows[]` | `[disease, <count per state>]` — confirmed/probable notification counts for the file's own period |

Load a `data/all-time/` or `data/year/` file into MySQL in a single pass:
```sql
SELECT t.* FROM notifications,
JSON_TABLE(doc, '$.rows[*]' COLUMNS (
  disease VARCHAR(120) PATH '$[0]',
  act INT PATH '$[1]',  nsw INT PATH '$[2]',  nt  INT PATH '$[3]', qld INT PATH '$[4]',
  sa  INT PATH '$[5]',  tas INT PATH '$[6]',  vic INT PATH '$[7]', wa  INT PATH '$[8]'
)) AS t;
```
A `data/month/` file is an array of months, so it needs one more level. The month comes off the element, and `NESTED PATH` unpacks that month's rows:
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
- **5 Sep 2026** added `last_refreshed` to every `data/year/` and `data/month/` file, as the first key, so a consumer can tell when a period file was last regenerated. New runs take the value from the dashboard, the same source the daily file uses. Existing files carry the timestamp of the commit that wrote them.
- **5 Sep 2026 — version 3.0 (unmasked)** switched every query to the `Count_Notification` measure, which returns the counts the dashboard suppresses as `n.p`. Cells that read 0 because the true value was below 5 now carry that value. The daily file recovered 41 cells, and the rebuilt year history recovered 1,684 across 60 diseases. Rabies was added upstream the same day and appears with 1 QLD case.

  Nothing was lost: no cell fell except where the dashboard itself revised the figure. The pre-3.0 snapshots were kept for comparison and then discarded once the rebuild was verified. `data/all-time/` (then `data/day/`) now holds only version 3.0 files.

- **6 Sep 2026 — per-period counts** `data/year/` and `data/month/` now hold **each period's own count** rather than a cumulative total through that period. A consumer that subtracted the prior period to get a delta must stop doing so, or it will double-subtract. The full history was rebuilt: 89 year files and 1,065 month files, from 1938.

  The year floor moved from a hardcoded 1990 to the earliest year in the data, which is 1938. That recovered real pre-1990 cases the old floor dropped, such as Chlamydial infection back to 1938 and Gonococcal to 1973, and it is why `all-time` and the year files now agree exactly.

  All 3 granularities reconcile for every disease and every state: 47,704 compared cells, no mismatch, and a shared total of 21,688,823.

- **6 Sep 2026 — one month file per year** `data/month/` now holds one file per year (`<year>_notifications.json`), containing an array of that year's months, instead of 1,065 files named `<YYYYMM>_notifications.json`. Each array element keeps the exact shape the per-month file had, headers included, so the counts are untouched — only the packaging changed. A consumer that opened a `YYYYMM` path must now open the year and pick the month, and a MySQL load needs a `NESTED PATH` (see above).
