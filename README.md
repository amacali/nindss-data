# National Notifiable Disease Surveillance System data for Australia #
Notification-count snapshots from the NINDSS Portal (https://nindss.health.gov.au/pbi-dashboard/).

All three files use the same flat `columns` + `rows` shape — a `columns` legend followed by one `rows` entry per disease(/year)(/month), with the eight state counts inlined in the fixed order given by `columns`. AUS/national is excluded.

Each file is queried at its own granularity, coarsest first. The NINDSS dashboard masks any cell whose count is `<5`, and masking bites at whatever level you query, so a coarser file is always the least-masked (a cell `<5` per month is usually `≥5` per year, and a state's all-time total is masked only if it is `<5` forever). **The files are therefore NOT exact sums of one another** — the coarser file is slightly higher and more accurate. For COVID-19 the national lifetime total reads 12,302,011 (total), 12,302,009 (year summed), 12,301,939 (month summed). Read each granularity from its own file rather than aggregating a finer one.

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

### 📅 data/YYYYMMDD_notifications_year.json (on request — per year) ##
Generated on demand (`node index.js year`, or the workflow's manual "year" run). Adds a `year` column; one row per disease + year:
```json
{
  "report_date": "20240311",
  "last_refreshed": "2026-07-13T16:35:22+10:00",
  "columns": ["disease", "year", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"],
  "rows": [
    ["COVID-19", 2024, 4791, 133644, 2834, 73663, 44104, 12170, 54330, 16087]
  ]
}
```

### 📅 data/YYYYMMDD_notifications_month.json (on request — monthly history) ##
Generated on demand (`node index.js month`, or the workflow's manual "month" run). Adds a `month` column (1-12); one row per disease + year + month:
```json
{
  "report_date": "20240311",
  "last_refreshed": "2026-07-13T16:35:22+10:00",
  "columns": ["disease", "year", "month", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"],
  "rows": [
    ["COVID-19", 2024, 3, 241, 6775, 166, 4438, 4889, 2118, 2678, 945]
  ]
}
```

| Field | Description |
| --- | --- |
| `report_date` | Reporting date AEDT, also used as the filename prefix |
| `last_refreshed` | Full timestamp (AEST/AEDT) the underlying dashboard data was last refreshed |
| `columns` | Column order for every entry in `rows` |
| `rows[]` | `[disease, (year,) (month,) <count per state>]` — confirmed/probable notification counts |

Load the monthly file into MySQL in a single pass (drop the `month`/`year` lines for the coarser files, shifting the state indexes down accordingly):
```sql
SELECT t.* FROM notifications,
JSON_TABLE(doc, '$.rows[*]' COLUMNS (
  disease VARCHAR(120) PATH '$[0]',
  year    INT          PATH '$[1]',
  month   INT          PATH '$[2]',
  act INT PATH '$[3]',  nsw INT PATH '$[4]',  nt  INT PATH '$[5]', qld INT PATH '$[6]',
  sa  INT PATH '$[7]',  tas INT PATH '$[8]',  vic INT PATH '$[9]', wa  INT PATH '$[10]'
)) AS t;
```

## Changelog ##
- **6 Dec 2023** added index.js and setup workflow action
- **13 Jul 2026** switched data/YYYYMMDD_notifications.json (renamed from `_cases.json`) to a flat `columns`/`rows` format with an added `last_refreshed` timestamp; the daily file now carries year totals, with monthly history available on request as `_notifications_month.json`
- **13 Jul 2026** split the output into three granularities queried directly (to avoid `<5`-cell masking accumulating when summing): the daily `_notifications.json` now carries **all-time totals** (no year column), with per-year available on request as `_notifications_year.json` and per-month as `_notifications_month.json`. Note the daily file's schema changed — it no longer has a `year` column.
