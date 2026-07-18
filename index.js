/*******************************************************************************
  NINDSS notification scraper

  Pulls notifiable-disease notification counts for Australia from the NINDSS
  PowerBI dashboard (https://nindss.health.gov.au/pbi-dashboard/) and writes a
  snapshot to data/<report_date>_notifications*.json. Three modes:
    node index.js            → all-time totals per state (daily, default)
    node index.js all-time   → same as above, named explicitly
    node index.js year [Y|all] → cumulative-per-year breakdown (data/year/, on request)
    node index.js month      → per-month breakdown            (_month.json, on request)
  Each mode queries at its own granularity rather than summing a finer file:
  the dashboard masks cells <5, so summing accumulates the loss (see
  getCaseNumbers in powerbi.js). Coarser files are the least-masked source for
  their shape.

  'year' mode has its own build path (buildYearOutput, below) writing entirely
  under data/year/ — NOT data/<reportDate>_notifications*.json like the other
  two modes. It writes one file per DAX_Year (data/year/<year>_notifications.json)
  plus a combined snapshot (data/year/<reportDate>_notifications.json) — see
  buildYearOutput's header comment for how those two coexist in one directory
  without colliding. By default it only fetches/refreshes the CURRENT year
  (cheap, ~1 request/disease); an optional third CLI arg can target a specific
  past year to backfill, or 'all' to rebuild the full history (~2.4k requests)
  — see getDiseaseList's CLI parsing. No year is ever reused from cache once
  targeted — every targeted year is always fetched live. State counts are
  CUMULATIVE totals through that year (DAX_Year <= year), not per-year deltas;
  per-year deltas are computed downstream in the database. This does NOT touch
  legacy.js — legacy.js's own 'year'-mode query (via getCaseNumbers) is
  untouched and stays exactly as it was: it serves an old site whose format
  must not change.

  On 'all-time' mode (the daily run) this also writes the deprecated
  data/<report_date>_cases.json — see legacy.js, slated for removal.

  PowerBI query/decoding logic (getConfig/getToken/getLatestUpdateDate/
  getCaseNumbers) lives in powerbi.js, shared with legacy.js.

  Output schema (see README.md):
    { report_date, last_refreshed, columns, rows }
*******************************************************************************/

  import fetch from 'node-fetch';
  import fs from 'fs';
  import { STATE_CODES, MONTH_NAMES, getToken, getLatestUpdateDate, getCaseNumbers, getYearCumulativeTotal } from './powerbi.js';
  import { writeLegacyCases } from './legacy.js';

  // Matches the DAX_Year >= 1990 floor filter already baked into every powerbi.js query.
  const YEAR_FLOOR = 1990;
  const YEAR_CACHE_DIR = 'data/year';

/*******************************************************************************
  buildYearOutput(capacityUri, token, diseases, reportDate, lastRefreshed, yearsToFetch)

  Writes one file per DAX_Year in `yearsToFetch` under
  data/year/<year>_notifications.json — cumulative per-state totals for
  DAX_Year <= year across every disease (see getYearCumulativeTotal in
  powerbi.js for why cumulative rather than a single year's grouped,
  more-often-masked count). Every requested year is fetched live and its cache
  file overwritten — no reuse-if-exists caching.

  `yearsToFetch` controls scope/cost per run (see getDiseaseList's CLI parsing):
    [currentYear]                 → default, ~1 request per disease (~67)
    [aSpecificYear]               → backfill/refresh just that one year
    [YEAR_FLOOR..currentYear]     → 'all': full history rebuild (~2.4k requests)

  Afterwards, data/year/<reportDate>_notifications.json is rebuilt from EVERY
  per-year cache file on disk (not just the year(s) fetched this run), so the
  combined snapshot always reflects the fullest known history at no extra
  request cost — it's just concatenating local files. This combined file lives
  in the SAME data/year/ directory as the per-year caches, distinguished only
  by filename: per-year caches are named by a bare 4-digit year (<year>_
  notifications.json), the combined file by the full 8-digit reportDate
  (<reportDate>_notifications.json) — the cache scan below matches strictly
  on the 4-digit form so it never picks up the combined file as a "year".
*******************************************************************************/
async function buildYearOutput(capacityUri, token, diseases, reportDate, lastRefreshed, yearsToFetch) {
  fs.mkdirSync(YEAR_CACHE_DIR, { recursive: true });

  for (const year of yearsToFetch) {
    const yearFile = { year, columns: ['disease', ...STATE_CODES], rows: [] };
    for (const diseaseName of diseases) {
      const cumulative = await getYearCumulativeTotal(capacityUri, token, diseaseName, year);
      if (!cumulative) continue;   // query failed for this disease; skip rather than crash
      yearFile.rows.push([diseaseName, ...STATE_CODES.map(s => cumulative[s] ?? 0)]);
    }
    fs.writeFileSync(YEAR_CACHE_DIR + '/' + year + '_notifications.json', JSON.stringify(yearFile));
  }

  const output = {
    report_date: reportDate,
    last_refreshed: lastRefreshed,
    columns: ['disease', 'year', ...STATE_CODES],
    rows: []
  };

  const cachedYears = fs.readdirSync(YEAR_CACHE_DIR)
    .filter(f => /^\d{4}_notifications\.json$/.test(f))
    .map(f => Number(f.split('_')[0]))
    .sort((a, b) => a - b);

  for (const year of cachedYears) {
    const yearFile = JSON.parse(fs.readFileSync(YEAR_CACHE_DIR + '/' + year + '_notifications.json', 'utf8'));
    for (const [diseaseName, ...counts] of yearFile.rows) {
      output.rows.push([diseaseName, year, ...counts]);
    }
  }

  fs.writeFileSync(YEAR_CACHE_DIR + '/' + reportDate + '_notifications.json', JSON.stringify(output));
}

/*******************************************************************************
  getDiseaseList(mode)

  Entry point. Fetches the full list of disease names, then queries each one in
  turn (sequentially — the endpoint is rate-sensitive and per-disease payloads
  are small) and writes a flat { columns, rows } snapshot.

  Three output modes, each querying getCaseNumbers at its own granularity and
  writing its own file:
    'all-time' (default, run daily) → all-time totals per state → one row per disease
             → data/<reportDate>_notifications.json
    'year'  (on request)         → one row per disease + year, CUMULATIVE state counts through that year
             → data/year/<reportDate>_notifications.json (delegated to buildYearOutput — see above)
    'month' (on request)         → one row per disease + year + month
             → data/<reportDate>_notifications_month.json

  Each file is queried at its OWN granularity rather than derived from a finer
  one: the dashboard masks any cell <5, so summing finer cells accumulates the
  loss (COVID-19's lifetime total came out 70 short when summed from months, 2
  short when summed from years). Every file is therefore the least-masked source
  for its shape — see the getCaseNumbers header for the full rationale. A
  consequence: the coarser files are NOT the exact sum of the finer ones (they
  are slightly higher, and more accurate).
*******************************************************************************/
async function getDiseaseList(mode, yearArg) {

  const { capacityUri, token } = await getToken();
  const { reportDate, lastRefreshed } = await getLatestUpdateDate(capacityUri,token);

  try {
    // Fetch data from URL and store the response into a const
    const response = await fetch(
      capacityUri + 'query', {
        "headers": {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-AU,en-US;q=0.9,en;q=0.8,fr;q=0.7",
        "authorization": "MWCToken " + token,
        "content-type": "application/json;charset=UTF-8",
        "sec-ch-ua": "\"Google Chrome\";v=\"119\", \"Chromium\";v=\"119\", \"Not?A_Brand\";v=\"24\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "cross-site",
        "Referer": "https://app.powerbi.com/",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      },
      "body": "{\"version\":\"1.0.0\",\"queries\":[{\"Query\":{\"Commands\":[{\"SemanticQueryDataShapeCommand\":{\"Query\":{\"Version\":2,\"From\":[{\"Name\":\"d\",\"Entity\":\"DELTALOAD_DATAMART DISEASE_DIM\",\"Type\":0},{\"Name\":\"d1\",\"Entity\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT\",\"Type\":0},{\"Name\":\"d2\",\"Entity\":\"DELTALOAD_DATAMART CASE_DIM\",\"Type\":0}],\"Select\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"DISEASE NAME\"},\"Name\":\"DELTALOAD_DATAMART DISEASE_DIM.DISEASE NAME\"}],\"Where\":[{\"Condition\":{\"Comparison\":{\"ComparisonKind\":1,\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DAX_Year\"}},\"Right\":{\"Literal\":{\"Value\":\"1990L\"}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"DISEASE GROUP\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Unknown'\"}}],[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d2\"}},\"Property\":\"Age Group\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Hepatitis C (<24 months)'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d2\"}},\"Property\":\"CONFIRMATION_STATUS\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Confirmed'\"}}],[{\"Literal\":{\"Value\":\"'Probable'\"}}]]}}}]},\"Binding\":{\"Primary\":{\"Groupings\":[{\"Projections\":[0]}]},\"DataReduction\":{\"DataVolume\":3,\"Primary\":{\"Window\":{}}},\"IncludeEmptyGroups\":true,\"Version\":1},\"ExecutionMetricsKind\":1}}]},\"QueryId\":\"\",\"ApplicationContext\":{\"DatasetId\":\"3471d96b-c14c-403f-b3a6-016f1deac28e\",\"Sources\":[{\"ReportId\":\"bc027587-5e9e-4920-bf03-a45fd3079f25\",\"VisualId\":\"fa18ef3590c8cb060361\"}]}}],\"cancelQueries\":[],\"modelId\":3305775,\"userPreferredLocale\":\"en-GB\",\"allowLongRunningQueries\":true}",
      "method": "POST"
    });

    // Convert the response into text
    const data = await response.json();
    const diseases = data.results[0].result.data.dsr.DS[0].PH[0].DM0.map(v => v.G0);

    // 'year' mode has its own build path — see buildYearOutput. Scope defaults
    // to the current (still-accumulating) year; yearArg can target a specific
    // past year to backfill, or 'all' to rebuild the full history.
    if (mode === 'year') {
      const currentYear = Number(reportDate.slice(0, 4));
      const yearsToFetch = yearArg === 'all'
        ? Array.from({ length: currentYear - YEAR_FLOOR + 1 }, (_, i) => YEAR_FLOOR + i)
        : yearArg ? [Number(yearArg)]
        : [currentYear];
      await buildYearOutput(capacityUri, token, diseases, reportDate, lastRefreshed, yearsToFetch);
      return;
    }

    // Flat, MySQL-friendly shape: a `columns` legend plus one `rows` entry per
    // disease(/month), with the eight state counts inlined in STATE_CODES
    // order. Consumable in one JSON_TABLE('$.rows[*]' ...) call.
    const output = {
      report_date: reportDate,
      last_refreshed: lastRefreshed,
      columns: mode === 'month' ? ['disease', 'year', 'month', ...STATE_CODES]
             :                     ['disease', ...STATE_CODES],
      rows: []
    };

    for(const diseaseName of diseases){
      const result = await getCaseNumbers(capacityUri,token,diseaseName,mode);
      if (!result) continue;   // query failed for this disease; skip rather than crash

      if (mode === 'month') {
        // result[year] = { <monthName>: { <state>: count } } → one row per month
        for (const [year, months] of Object.entries(result)) {
          for (const [monthName, cases] of Object.entries(months)) {
            const month = MONTH_NAMES.indexOf(monthName) + 1;
            output.rows.push([diseaseName, Number(year), month, ...STATE_CODES.map(s => cases[s] ?? 0)]);
          }
        }
      } else {
        // all-time: result = { <state>: count } → a single all-time row per disease
        output.rows.push([diseaseName, ...STATE_CODES.map(s => result[s] ?? 0)]);
      }
    }

    const suffix = mode === 'all-time' ? '' : '_' + mode;   // all-time keeps the bare name
    const fname = reportDate + '_notifications' + suffix + '.json';
    fs.writeFileSync('data/'+ fname,JSON.stringify(output));

    // Deprecated legacy output — daily 'all-time' runs only. See legacy.js.
    if (mode === 'all-time') {
      await writeLegacyCases(capacityUri, token, reportDate, diseases);
    }

  } catch (error) {
    console.log(error);
  }
}
  // Run the scraper. The first argument selects the granularity; with no argument
  // (or 'all-time') it writes the daily all-time-totals file (this is what the
  // daily workflow runs). For 'year', a second argument controls scope:
  //   node index.js                → data/<date>_notifications.json       (all-time totals)
  //   node index.js all-time       → same as above, named explicitly
  //   node index.js year           → data/year/<date>_notifications.json  (current year only, default)
  //   node index.js year 2019      → backfill/refresh just 2019 (data/year/2019_notifications.json)
  //   node index.js year all       → rebuild full history (all years, YEAR_FLOOR..current)
  //   node index.js month          → data/<date>_notifications_month.json (per year+month)
  const arg = process.argv[2];
  const mode = (arg === 'year' || arg === 'month') ? arg : 'all-time';
  const yearArg = process.argv[3];
  getDiseaseList(mode, yearArg);
