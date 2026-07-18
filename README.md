# National Notifiable Disease Surveillance System data for Australia #
Notification-count snapshots from the NINDSS Portal (https://nindss.health.gov.au/pbi-dashboard/).

All files use the same flat `columns` + `rows` shape — a `columns` legend followed by one `rows` entry per disease, with the eight state counts inlined in the fixed order given by `columns`. AUS/national is excluded.

Each file is queried at its own granularity, coarsest first. The NINDSS dashboard masks any cell whose count is `<5`, and masking bites at whatever level you query, so a coarser file is always the least-masked (a cell `<5` per month is usually `≥5` per year, and a state's all-time total is masked only if it is `<5` forever). **The files are therefore NOT exact sums of one another** — the coarser file is slightly higher and more accurate. For COVID-19 the national lifetime total reads 12,302,011 (all-time), 12,302,009 (year summed), 12,301,939 (month summed). Read each granularity from its own file rather than aggregating a finer one.

### 📅 data/YYYYMMDD_notifications.json (daily — all-time totals) ##
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
Generated on demand (`node index.js year`, `node index.js year 2019`, or `node index.js year all` for a full history rebuild). One file per year, one row per disease. Counts are a **cumulative total through that year**, not that year's own delta — this resists `<5` masking far better than a single year's grouped count:
```json
{
  "year": 2024,
  "columns": ["disease", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"],
  "rows": [
    ["COVID-19", 4791, 133644, 2834, 73663, 44104, 12170, 54330, 16087]
  ]
}
```

`data/year/changed_years.json` is a derived optimization artifact (rewritten on every `year`-mode run) recording, per disease, which years' cumulative totals actually changed from the prior year — used by month-mode to skip provably flat years. It isn't a data file and shouldn't be consumed downstream.

### 📅 data/month/\<YYYYMM>_notifications.json (on request — monthly history) ##
Generated on demand (`node index.js month`, `node index.js month 201907`, `node index.js month 2019`, or `node index.js month all` for a full history rebuild — expensive). One file per (year, month), one row per disease. Counts are a **cumulative total through that month** (spanning full history, not just that year), not that month's own delta:
```json
{
  "year": 2024,
  "month": 3,
  "columns": ["disease", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"],
  "rows": [
    ["COVID-19", 241, 6775, 166, 4438, 4889, 2118, 2678, 945]
  ]
}
```

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
| `last_refreshed` | Full timestamp (AEST/AEDT) the underlying dashboard data was last refreshed (all-time file only) |
| `year` / `month` | Present only in `data/year/`/`data/month/` files — the period the cumulative totals in `rows` run through |
| `columns` | Column order for every entry in `rows` |
| `rows[]` | `[disease, <count per state>]` — confirmed/probable notification counts, cumulative through the file's period |

Load a file into MySQL in a single pass:
```sql
SELECT t.* FROM notifications,
JSON_TABLE(doc, '$.rows[*]' COLUMNS (
  disease VARCHAR(120) PATH '$[0]',
  act INT PATH '$[1]',  nsw INT PATH '$[2]',  nt  INT PATH '$[3]', qld INT PATH '$[4]',
  sa  INT PATH '$[5]',  tas INT PATH '$[6]',  vic INT PATH '$[7]', wa  INT PATH '$[8]'
)) AS t;
```

## Changelog ##
- **6 Dec 2023** added index.js and setup workflow action
- **13 Jul 2026** switched data/YYYYMMDD_notifications.json (renamed from `_cases.json`) to a flat `columns`/`rows` format with an added `last_refreshed` timestamp; the daily file now carries year totals, with monthly history available on request as `_notifications_month.json`
- **13 Jul 2026** split the output into three granularities queried directly (to avoid `<5`-cell masking accumulating when summing): the daily `_notifications.json` now carries **all-time totals** (no year column), with per-year available on request as `_notifications_year.json` and per-month as `_notifications_month.json`. Note the daily file's schema changed — it no longer has a `year` column.
- **18 Jul 2026** replaced the combined `_notifications_year.json`/`_notifications_month.json` snapshots with per-period cache files under `data/year/<year>_notifications.json` and `data/month/<YYYYMM>_notifications.json`, each holding a cumulative total through that period rather than a per-period delta; moved the deprecated legacy schema to `data/legacy/<reportDate>_cases.json`
