/*******************************************************************************
  NINDSS notification scraper

  Pulls notifiable-disease notification counts for Australia from the NINDSS
  PowerBI dashboard (https://nindss.health.gov.au/pbi-dashboard/). Three modes:
    node index.js                 → all-time totals per state (daily, default)
    node index.js all-time        → same as above, named explicitly
    node index.js year [Y|all]    → cumulative-per-year breakdown  (data/year/,  on request)
    node index.js month [YM|Y|all] → cumulative-per-month breakdown (data/month/, on request)

  'all-time' is the only mode still writing the "classic" flat
  data/<reportDate>_notifications.json shape via the shared loop at the bottom
  of getDiseaseList. 'year' and 'month' each have their own build path
  (buildYearOutput / buildMonthOutput, below) writing entirely under their own
  subdirectory (data/year/ or data/month/) — NOT data/<reportDate>_..., and NOT
  the plain (possibly masked) getCaseNumbers query.

  Both subdirectory modes share the same design: one cache file per period
  (data/year/<year>_notifications.json, data/month/<YYYYMM>_notifications.json)
  holding a CUMULATIVE per-state total THROUGH that period (via
  getYearCumulativeTotal / getMonthCumulativeTotal in powerbi.js — a running
  total resists PowerBI's <5 masking far better than a single period's own
  count), plus a combined snapshot (<subdirectory>/<reportDate>_notifications.json)
  rebuilt from every cache file on disk. Per-period deltas are computed
  downstream in the database, not here. Scope defaults to the current
  (still-accumulating) period (cheap); an optional third CLI arg can target a
  specific past period to backfill, or 'all' to rebuild the full history (very
  expensive for month — ~30k requests) — see getDiseaseList's CLI parsing and
  parseMonthScope. No period is ever reused from an existing cache file once
  targeted — every targeted period is always fetched live.

  Neither of these touches legacy.js — legacy.js's own 'year'-mode query (via
  getCaseNumbers, the plain grouped query) is untouched and stays exactly as
  it was: it serves an old site whose format must not change.

  On 'all-time' mode (the daily run) this also writes the deprecated
  data/<report_date>_cases.json — see legacy.js, slated for removal.

  PowerBI query/decoding logic (getConfig/getToken/getLatestUpdateDate/
  getCaseNumbers) lives in powerbi.js, shared with legacy.js.

  Output schema (see README.md):
    { report_date, last_refreshed, columns, rows }
*******************************************************************************/

  import fetch from 'node-fetch';
  import fs from 'fs';
  import { STATE_CODES, getToken, getLatestUpdateDate, getCaseNumbers, getYearCumulativeTotal, getMonthCumulativeTotal } from './powerbi.js';
  import { writeLegacyCases } from './legacy.js';

  // Matches the DAX_Year >= 1990 floor filter already baked into every powerbi.js query.
  const YEAR_FLOOR = 1990;
  const YEAR_CACHE_DIR = 'data/year';
  const MONTH_CACHE_DIR = 'data/month';

/*******************************************************************************
  buildYearOutput(capacityUri, token, diseases, yearsToFetch)

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
*******************************************************************************/
async function buildYearOutput(capacityUri, token, diseases, yearsToFetch) {
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
}

/*******************************************************************************
  parseMonthScope(scopeArg, currentYear, currentMonth)

  Turns the CLI's optional third arg into a list of { year, month } periods for
  buildMonthOutput to fetch:
    (no arg)   → [{ currentYear, currentMonth }]           — default, cheap
    'YYYYMM'   → that single period                         — targeted backfill
    'YYYY'     → every month of that year (Jan..currentMonth if it's the
                 current year, else Jan..Dec)                — targeted backfill
    'all'      → every month from YEAR_FLOOR through the current month — full
                 history rebuild. Unlike year mode's 'all' (~2.4k requests),
                 this is ~37 years × 12 months × ~67 diseases ≈ 30k requests —
                 large enough that it should be a deliberate, explicit choice.
*******************************************************************************/
function parseMonthScope(scopeArg, currentYear, currentMonth) {
  if (!scopeArg) return [{ year: currentYear, month: currentMonth }];
  if (scopeArg === 'all') {
    const periods = [];
    for (let year = YEAR_FLOOR; year <= currentYear; year++) {
      const maxMonth = year === currentYear ? currentMonth : 12;
      for (let month = 1; month <= maxMonth; month++) periods.push({ year, month });
    }
    return periods;
  }
  if (/^\d{6}$/.test(scopeArg)) {
    return [{ year: Number(scopeArg.slice(0, 4)), month: Number(scopeArg.slice(4, 6)) }];
  }
  if (/^\d{4}$/.test(scopeArg)) {
    const year = Number(scopeArg);
    const maxMonth = year === currentYear ? currentMonth : 12;
    const periods = [];
    for (let month = 1; month <= maxMonth; month++) periods.push({ year, month });
    return periods;
  }
  throw new Error("invalid month scope '" + scopeArg + "' — expected YYYYMM, YYYY, or 'all'");
}

/*******************************************************************************
  buildMonthOutput(capacityUri, token, diseases, periodsToFetch)

  Writes one file per (year, month) in `periodsToFetch` under
  data/month/<YYYYMM>_notifications.json — cumulative per-state totals through
  that month across every disease, via getMonthCumulativeTotal in powerbi.js.
  Every requested period is fetched live and its cache file overwritten — no
  reuse-if-exists caching, same as buildYearOutput.
*******************************************************************************/
async function buildMonthOutput(capacityUri, token, diseases, periodsToFetch) {
  fs.mkdirSync(MONTH_CACHE_DIR, { recursive: true });

  for (const { year, month } of periodsToFetch) {
    const periodFile = { year, month, columns: ['disease', ...STATE_CODES], rows: [] };
    for (const diseaseName of diseases) {
      const cumulative = await getMonthCumulativeTotal(capacityUri, token, diseaseName, year, month);
      if (!cumulative) continue;   // query failed for this disease; skip rather than crash
      periodFile.rows.push([diseaseName, ...STATE_CODES.map(s => cumulative[s] ?? 0)]);
    }
    const period = String(year) + String(month).padStart(2, '0');
    fs.writeFileSync(MONTH_CACHE_DIR + '/' + period + '_notifications.json', JSON.stringify(periodFile));
  }
}

/*******************************************************************************
  getDiseaseList(mode, scopeArg)

  Entry point. Fetches the full list of disease names, then dispatches:
    'year'     → buildYearOutput  (scopeArg: nothing | a year | 'all')
    'month'    → buildMonthOutput (scopeArg: nothing | 'YYYYMM' | 'YYYY' | 'all',
                 parsed by parseMonthScope)
    'all-time' → falls through to the loop below: one all-time row per disease
                 via getCaseNumbers, written to data/<reportDate>_notifications.json,
                 plus the deprecated legacy.js output (see writeLegacyCases).
*******************************************************************************/
async function getDiseaseList(mode, scopeArg) {

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
    // to the current (still-accumulating) year; scopeArg can target a specific
    // past year to backfill, or 'all' to rebuild the full history.
    if (mode === 'year') {
      const currentYear = Number(reportDate.slice(0, 4));
      const yearsToFetch = scopeArg === 'all'
        ? Array.from({ length: currentYear - YEAR_FLOOR + 1 }, (_, i) => YEAR_FLOOR + i)
        : scopeArg ? [Number(scopeArg)]
        : [currentYear];
      await buildYearOutput(capacityUri, token, diseases, yearsToFetch);
      return;
    }

    // 'month' mode also has its own build path — see buildMonthOutput. Scope
    // defaults to the current (still-accumulating) year+month; scopeArg can
    // be 'YYYYMM' (one period), 'YYYY' (a whole year), or 'all' (full
    // history) — see parseMonthScope.
    if (mode === 'month') {
      const currentYear = Number(reportDate.slice(0, 4));
      const currentMonth = Number(reportDate.slice(4, 6));
      const periodsToFetch = parseMonthScope(scopeArg, currentYear, currentMonth);
      await buildMonthOutput(capacityUri, token, diseases, periodsToFetch);
      return;
    }

    // Only 'all-time' reaches here now — one all-time row per disease.
    const output = {
      report_date: reportDate,
      last_refreshed: lastRefreshed,
      columns: ['disease', ...STATE_CODES],
      rows: []
    };

    for(const diseaseName of diseases){
      const result = await getCaseNumbers(capacityUri,token,diseaseName,mode);
      if (!result) continue;   // query failed for this disease; skip rather than crash
      output.rows.push([diseaseName, ...STATE_CODES.map(s => result[s] ?? 0)]);
    }

    fs.writeFileSync('data/' + reportDate + '_notifications.json', JSON.stringify(output));

    // Deprecated legacy output — daily 'all-time' runs only. See legacy.js.
    await writeLegacyCases(capacityUri, token, reportDate, diseases);

  } catch (error) {
    console.log(error);
  }
}
  // Run the scraper. The first argument selects the granularity; with no argument
  // (or 'all-time') it writes the daily all-time-totals file (this is what the
  // daily workflow runs). For 'year'/'month', a second argument controls scope:
  //   node index.js                → data/<date>_notifications.json         (all-time totals)
  //   node index.js all-time       → same as above, named explicitly
  //   node index.js year           → data/year/<date>_notifications.json    (current year only, default)
  //   node index.js year 2019      → backfill/refresh just 2019 (data/year/2019_notifications.json)
  //   node index.js year all       → rebuild full history (all years, YEAR_FLOOR..current)
  //   node index.js month          → data/month/<date>_notifications.json   (current year+month only, default)
  //   node index.js month 201907   → backfill/refresh just July 2019 (data/month/201907_notifications.json)
  //   node index.js month 2019     → backfill/refresh every month of 2019
  //   node index.js month all      → rebuild full history (very expensive — ~30k requests)
  const arg = process.argv[2];
  const mode = (arg === 'year' || arg === 'month') ? arg : 'all-time';
  const scopeArg = process.argv[3];
  getDiseaseList(mode, scopeArg);
