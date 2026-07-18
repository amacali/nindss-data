/*******************************************************************************
  NINDSS notification scraper — pulls notifiable-disease notification counts
  for Australia from the NINDSS PowerBI dashboard. Three modes:
    node index.js / all-time        → data/<reportDate>_notifications.json (daily, default)
    node index.js year [Y|all]      → data/year/<year>_notifications.json (on request)
    node index.js month [YM|Y|all]  → data/month/<YYYYMM>_notifications.json (on request)

  'year'/'month' each write one cache file per period holding a CUMULATIVE
  per-state total THROUGH that period (via getYearCumulativeTotal /
  getMonthCumulativeTotal in powerbi.js — resists <5 masking far better than a
  single period's own count); deltas are computed downstream. Scope defaults
  to the current period; an optional third CLI arg backfills a specific past
  period or 'all' rebuilds full history (expensive for month, ~20-30k
  requests) — see parseMonthScope. Targeted periods are always fetched live,
  never reused from cache.

  'year' mode also maintains data/year/changed_years.json (writeYearChangeMap):
  for any disease/year proven flat (no new cases), buildMonthOutput skips the
  live month query for that whole year and carries the prior total forward.

  On 'all-time' runs this also writes the deprecated data/legacy/<reportDate>_cases.json
  — see legacy.js, slated for removal, output format frozen.

  PowerBI query/decoding logic lives in powerbi.js, shared with legacy.js.
  Output schema details: see README.md.
*******************************************************************************/

  import fetch from 'node-fetch';
  import fs from 'fs';
  import { STATE_CODES, getToken, getLatestUpdateDate, getCaseNumbers, getYearCumulativeTotal, getMonthCumulativeTotal } from './powerbi.js';
  import { writeLegacyCases } from './legacy.js';

  // Matches the DAX_Year >= 1990 floor filter already baked into every powerbi.js query.
  const YEAR_FLOOR = 1990;
  const YEAR_CACHE_DIR = 'data/year';
  const MONTH_CACHE_DIR = 'data/month';
  const YEAR_CHANGE_MAP_PATH = YEAR_CACHE_DIR + '/changed_years.json';

// Writes one file per DAX_Year in `yearsToFetch` under
// data/year/<year>_notifications.json — cumulative per-state totals for
// DAX_Year <= year across every disease. Every requested year is fetched live
// and overwritten (no reuse-if-exists). `yearsToFetch`: [currentYear] default
// (~1 request/disease), [aYear] targeted backfill, or YEAR_FLOOR..currentYear
// for 'all' (~2.4k requests). Afterwards rewrites changed_years.json (cheap,
// local reads only) from whatever per-year cache files exist on disk.
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

  writeYearChangeMap();
}

// Reads every data/year/<year>_notifications.json on disk and writes
// data/year/changed_years.json: { generated_from_years: [<cached years>],
// changed_years: { <disease>: [<years where the cumulative total changed>] } }.
// A year absent for a disease (but within generated_from_years) is FLAT —
// identical to the prior year, so buildMonthOutput can skip it entirely. A
// year outside generated_from_years is UNKNOWN (cache missing) and must be
// queried live.
function writeYearChangeMap() {
  const years = fs.readdirSync(YEAR_CACHE_DIR)
    .filter(f => /^\d{4}_notifications\.json$/.test(f))
    .map(f => Number(f.split('_')[0]))
    .sort((a, b) => a - b);

  const cumulativeByYear = {};
  for (const year of years) {
    const yearFile = JSON.parse(fs.readFileSync(YEAR_CACHE_DIR + '/' + year + '_notifications.json', 'utf8'));
    cumulativeByYear[year] = Object.fromEntries(yearFile.rows.map(([name, ...counts]) => [name, counts]));
  }

  const diseases = new Set();
  years.forEach(y => Object.keys(cumulativeByYear[y]).forEach(d => diseases.add(d)));

  const changedYears = {};
  for (const disease of diseases) {
    const changed = [];
    for (const year of years) {
      const current = cumulativeByYear[year][disease];
      const previous = year === YEAR_FLOOR ? STATE_CODES.map(() => 0) : cumulativeByYear[year - 1]?.[disease];
      if (!current || !previous) continue;   // gap in the cache — leave unlisted, treated as unknown, not flat
      if (STATE_CODES.some((s, i) => current[i] !== previous[i])) changed.push(year);
    }
    changedYears[disease] = changed;
  }

  fs.writeFileSync(YEAR_CHANGE_MAP_PATH, JSON.stringify({ generated_from_years: years, changed_years: changedYears }));
}

// Turns the CLI's optional third arg into { year, month } periods to fetch:
// no arg → [current period]; 'YYYYMM' → that period; 'YYYY' → every month of
// that year; 'all' → every month from YEAR_FLOOR to now (~30k requests —
// large enough to be a deliberate, explicit choice).
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

// Writes one file per (year, month) in `periodsToFetch` under
// data/month/<YYYYMM>_notifications.json — cumulative per-state totals
// through that month, via getMonthCumulativeTotal. Optimization: if
// changed_years.json shows a disease/year had no change from the prior year,
// every month in it is flat — skip the live query and carry the prior total
// forward (cuts a full 'all' rebuild from ~29k requests to ~20k). Years
// outside the map's coverage always fall back to a live query.
async function buildMonthOutput(capacityUri, token, diseases, periodsToFetch) {
  fs.mkdirSync(MONTH_CACHE_DIR, { recursive: true });

  const changeMap = fs.existsSync(YEAR_CHANGE_MAP_PATH)
    ? JSON.parse(fs.readFileSync(YEAR_CHANGE_MAP_PATH, 'utf8'))
    : null;
  const yearCumulativeCache = {};   // year -> { disease -> [8 counts] }, lazily loaded
  function yearCumulative(year, diseaseName) {
    if (!(year in yearCumulativeCache)) {
      const path = YEAR_CACHE_DIR + '/' + year + '_notifications.json';
      yearCumulativeCache[year] = fs.existsSync(path)
        ? Object.fromEntries(JSON.parse(fs.readFileSync(path, 'utf8')).rows.map(([name, ...counts]) => [name, counts]))
        : {};
    }
    return yearCumulativeCache[year][diseaseName];
  }

  const periodsByYear = {};
  for (const { year, month } of periodsToFetch) (periodsByYear[year] ??= []).push(month);

  const periodFiles = {};   // 'YYYYMM' -> { year, month, columns, rows }
  for (const { year, month } of periodsToFetch) {
    const period = String(year) + String(month).padStart(2, '0');
    periodFiles[period] = { year, month, columns: ['disease', ...STATE_CODES], rows: [] };
  }

  for (const diseaseName of diseases) {
    for (const [yearStr, months] of Object.entries(periodsByYear)) {
      const year = Number(yearStr);

      const coveredByMap = changeMap?.generated_from_years.includes(year);
      const isFlat = coveredByMap && !changeMap.changed_years[diseaseName]?.includes(year);
      const priorTotal = year === YEAR_FLOOR ? STATE_CODES.map(() => 0) : yearCumulative(year - 1, diseaseName);

      if (isFlat && priorTotal) {
        for (const month of months) {
          const period = String(year) + String(month).padStart(2, '0');
          periodFiles[period].rows.push([diseaseName, ...priorTotal]);
        }
        continue;
      }

      for (const month of months) {
        const cumulative = await getMonthCumulativeTotal(capacityUri, token, diseaseName, year, month);
        if (!cumulative) continue;   // query failed for this disease; skip rather than crash
        const period = String(year) + String(month).padStart(2, '0');
        periodFiles[period].rows.push([diseaseName, ...STATE_CODES.map(s => cumulative[s] ?? 0)]);
      }
    }
  }

  for (const [period, periodFile] of Object.entries(periodFiles)) {
    fs.writeFileSync(MONTH_CACHE_DIR + '/' + period + '_notifications.json', JSON.stringify(periodFile));
  }
}

// Entry point: fetches the disease list, then dispatches to buildYearOutput,
// buildMonthOutput, or (for 'all-time') the loop below plus writeLegacyCases.
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
  // Run the scraper — see the header comment above for the mode/scope table.
  const arg = process.argv[2];
  const mode = (arg === 'year' || arg === 'month') ? arg : 'all-time';
  const scopeArg = process.argv[3];
  getDiseaseList(mode, scopeArg);
