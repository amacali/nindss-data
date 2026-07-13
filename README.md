# National Notifiable Disease Surveillance System data for Australia #
Daily cumulative case total snapshots from the NINDSS Portal (https://nindss.health.gov.au/pbi-dashboard/).

### 📅 data/YYYYMMDD_notifications.json ##
Nested by disease, then year, then month, then state/territory code to avoid repeating values:
```json
{
  "report_date": "20240311",
  "last_refreshed": "2026-07-13T16:35:22+10:00",
  "data": {
    "<disease name>": {
      "<year>": {
        "<month name>": {
          "<state code>": 0
        }
      }
    }
  }
}
```
| Field | Description |
| --- | --- |
| `report_date` | Reporting date AEDT, also used as the filename prefix |
| `last_refreshed` | Full timestamp (AEST/AEDT) the underlying dashboard data was last refreshed |
| `data.<disease>.<year>.<month>.<code>` | Confirmed/probable notification count for that disease, year, month, and state/territory (or AUS for Australia) |

## Changelog ##
- **6 Dec 2023** added index.js and setup workflow action
- **13 Jul 2026** switched data/YYYYMMDD_notifications.json (renamed from `_cases.json`) to a nested format (disease/year/month/code) with lower-case field names and an added `last_refreshed` timestamp, replacing the flat repeated-value annual-total rows
