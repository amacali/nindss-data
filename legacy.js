/*******************************************************************************
  Legacy _cases.json output — DEPRECATED, slated for removal.

  Reshapes year-granularity notification counts (via getCaseNumbers(...,'year'))
  into the pre-rewrite flat-array format: one record per disease/year/state,
  kept only for consumers still on the old schema. Written alongside the current
  _notifications.json on 'all-time' mode (daily) runs — see index.js.

  This file is the entire legacy surface: deleting it and its one call site in
  index.js removes the legacy output cleanly.
*******************************************************************************/
  import fs from 'fs';
  import { getCaseNumbers, STATE_CODES } from './powerbi.js';

  export async function writeLegacyCases(capacityUri, token, reportDate, diseaseNames) {

    const rows = [];

    for (const diseaseName of diseaseNames) {
      const years = await getCaseNumbers(capacityUri, token, diseaseName, 'year');
      if (!years) continue;   // query failed for this disease; skip rather than crash

      for (const [year, cases] of Object.entries(years)) {
        for (const code of STATE_CODES) {
          rows.push({
            REPORT_DATE: reportDate,
            DISEASE: diseaseName,
            YEAR: Number(year),
            CODE: code,
            CASES: cases[code] ?? 0
          });
        }
      }
    }

    fs.writeFileSync('data/' + reportDate + '_cases.json', JSON.stringify(rows));
  }
