# National Notifiable Disease Surveillance System data for Australia #
Notification-count snapshots from the NINDSS Portal (https://nindss.health.gov.au/pbi-dashboard/).

Both files use the same flat `columns` + `rows` shape — a `columns` legend followed by one `rows` entry per disease/year(/month), with the eight state counts inlined in the fixed order given by `columns`. AUS/national is excluded.

### 📅 data/YYYYMMDD_notifications.json (daily — year totals) ##
Written by the daily job. One row per disease + year:
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
The daily year totals are exactly the sum of the monthly rows for that year.

| Field | Description |
| --- | --- |
| `report_date` | Reporting date AEDT, also used as the filename prefix |
| `last_refreshed` | Full timestamp (AEST/AEDT) the underlying dashboard data was last refreshed |
| `columns` | Column order for every entry in `rows` |
| `rows[]` | `[disease, year, (month,) <count per state>]` — confirmed/probable notification counts |

Load the monthly file into MySQL in a single pass (drop the `month` line for the daily file, shifting the state indexes down by one):
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
