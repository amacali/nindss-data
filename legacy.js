// Legacy _cases.json output — DEPRECATED, slated for removal. Reshapes
// year-granularity counts into the pre-rewrite flat-array format (one record
// per disease/year/state) for old consumers. Written to
// data/legacy/<reportDate>_cases.json alongside the daily 'all-time' run —
// see index.js. This file plus its one call site is the entire legacy surface.
  import fs from 'fs';
  import { getCaseNumbers, STATE_CODES } from './powerbi.js';

  const LEGACY_DIR = 'data/legacy';

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

    fs.mkdirSync(LEGACY_DIR, { recursive: true });
    fs.writeFileSync(LEGACY_DIR + '/' + reportDate + '_cases.json', JSON.stringify(rows));
  }
