/*******************************************************************************
  NINDSS notification scraper — pulls notifiable-disease notification counts
  for Australia from the NINDSS PowerBI dashboard. Three modes:
    node index.js / all-time        → data/day/<reportDate>_notifications.json (daily, default)
    node index.js year [Y|all]      → data/year/<year>_notifications.json (on request)
    node index.js month [YM|Y|all]  → data/month/<year>_notifications.json (on request)

  Both write one file per YEAR, holding each period's OWN count rather than a
  running total. A 'year' file is one object with a row per disease; a 'month'
  file is an ARRAY of that year's months, each element keeping the same
  { last_refreshed, year, month, columns, rows } shape. Counts are unmasked:
  every query selects Count_Notification, which returns the real value where
  the dashboard's <5 mask would report 0. Scope defaults to the current year;
  an optional third CLI arg targets a past year, or 'all' rebuilds the full
  history. A targeted year is always fetched live and rewritten whole.

  On 'all-time' runs this also writes the deprecated data/legacy/<reportDate>_cases.json
  — see legacy.js, slated for removal, output format frozen.

  PowerBI query/decoding logic lives in powerbi.js, shared with legacy.js.
  Output schema details: see README.md.
*******************************************************************************/

  import fetch from 'node-fetch';
  import fs from 'fs';
  import { STATE_CODES, MONTH_NAMES, getToken, getLatestUpdateDate, getCaseNumbers } from './powerbi.js';
  import { writeLegacyCases } from './legacy.js';

  // Earliest year any disease has data for, read from the disease year map
  // (data/reference/disease_years.json) rather than hardcoded. The queries
  // carry NO year floor of their own — an earlier hardcoded 1990 silently
  // dropped real pre-1990 cases (Chlamydial infection goes back to 1938,
  // Gonococcal to 1973), which made 'all-time' and the year files disagree.
  const DISEASE_YEARS_PATH = 'data/reference/disease_years.json';
  const YEAR_FLOOR = fs.existsSync(DISEASE_YEARS_PATH)
    ? JSON.parse(fs.readFileSync(DISEASE_YEARS_PATH, 'utf8')).floor_year
    : 1938;
  const DAY_CACHE_DIR = 'data/day';
  const YEAR_CACHE_DIR = 'data/year';
  const MONTH_CACHE_DIR = 'data/month';

// Writes one file per DAX_Year in `yearsToFetch` under
// data/year/<year>_notifications.json — that year's own per-state counts
// across every disease. Every requested year is fetched live and overwritten
// (no reuse-if-exists). `yearsToFetch`: [currentYear] default, [aYear]
// targeted backfill, or YEAR_FLOOR..currentYear for 'all'. Cost is the same
// either way — one query per disease returns every year at once.
async function buildYearOutput(capacityUri, token, diseases, yearsToFetch, lastRefreshed) {
  fs.mkdirSync(YEAR_CACHE_DIR, { recursive: true });

  // One query per disease returns EVERY year at once, so the whole history
  // costs ~67 requests rather than one per disease-year. Counts are that
  // year's own total, not a running total.
  const wanted = new Set(yearsToFetch);
  const byYear = {};   // year -> rows[]
  for (const year of wanted) byYear[year] = [];

  for (const diseaseName of diseases) {
    const perYear = await getCaseNumbers(capacityUri, token, diseaseName, 'year');
    if (!perYear) throw new Error('Year query failed for ' + diseaseName);
    for (const year of wanted) {
      const counts = perYear[year];
      byYear[year].push([diseaseName, ...STATE_CODES.map(s => (counts?.[s]) ?? 0)]);
    }
  }

  for (const year of yearsToFetch) {
    const yearFile = { last_refreshed: lastRefreshed, year, columns: ['disease', ...STATE_CODES], rows: byYear[year] };
    fs.writeFileSync(YEAR_CACHE_DIR + '/' + year + '_notifications.json', JSON.stringify(yearFile));
  }
  console.log('Wrote ' + yearsToFetch.length + ' year file(s)');
}

// Turns the CLI's optional third arg into { year, month } periods. Only the
// YEAR of each period matters now — buildMonthOutput rebuilds a whole year at
// a time — so 'YYYYMM' and 'YYYY' both mean "rewrite that year's file", and
// the month half only serves parseMonthScope's own bounds checking.
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

// Writes one file per YEAR under data/month/<year>_notifications.json. The
// file is an ARRAY of the 12 month objects, each holding that month's own
// per-state counts in the same full shape it had as its own file.
// `periodsToFetch` only picks WHICH years are written; each of those is always
// rebuilt whole (see below). A full 'all' rebuild costs ~1.7k requests and
// about 5 minutes, because the disease year map skips the empty pairs.
async function buildMonthOutput(capacityUri, token, diseases, periodsToFetch, lastRefreshed, reportYear, reportMonth) {
  fs.mkdirSync(MONTH_CACHE_DIR, { recursive: true });

  // Queried per DISEASE-YEAR: PowerBI truncates a result set at 500 year-month
  // cells, so one query for a disease's whole history silently drops
  // everything past ~41 years (COVID-19 stopped at 2023, months 09-12 simply
  // absent). One year at a time returns 12 cells and cannot truncate.
  // Counts are that month's own total, not a running total.
  const diseaseYears = fs.existsSync(DISEASE_YEARS_PATH)
    ? JSON.parse(fs.readFileSync(DISEASE_YEARS_PATH, 'utf8')).diseases
    : {};

  const periodsByYear = {};
  for (const p of periodsToFetch) (periodsByYear[p.year] ??= []).push(p.month);

  // Year OUTERMOST so each year's files are written as soon as they are
  // complete: a long rebuild stays resumable and shows progress, instead of
  // holding all 1,065 files open and losing everything on an interruption.
  const zero = STATE_CODES.map(() => 0);
  for (const yearStr of Object.keys(periodsByYear).sort()) {
    const year = Number(yearStr);

    // A year file must always be written WHOLE, so the months come from the
    // year rather than from the scope. Narrowing it to the requested months
    // would drop the other 11 from the file — and the CI cron requests one
    // month, so that would truncate the current year on every run. Costs
    // nothing: one query already returns all 12 months of a disease-year.
    const lastMonth = year === Number(reportYear) ? Number(reportMonth) : 12;
    const months = Array.from({ length: lastMonth }, (_, i) => i + 1);
    const byMonth = {};
    for (const month of months) byMonth[month] = [];

    // One file per YEAR, and the file IS an array of the 12 month objects.
    // Each keeps the full header it had as its own file — last_refreshed,
    // year, month, columns, rows — so `month` sits beside `year` rather than
    // above it, and a consumer can lift one element out unchanged.
    const yearFile = [];

    let queried = 0;
    for (const diseaseName of diseases) {
      // The reference map lists the exact years each disease has cases in, not
      // just its first and last — 22 diseases have gaps inside their span
      // (Chlamydial infection is active in 39 of 89 years), so a year LIST
      // skips more than a range would. An unlisted year has no cases and is
      // written as zeros without a query.
      const span = diseaseYears[diseaseName];
      const skip = span && span.years && !span.years.includes(year);
      const counts = skip ? null : await getCaseNumbers(capacityUri, token, diseaseName, 'month', year);
      if (!skip) {
        if (!counts) throw new Error('Month query failed for ' + diseaseName + ' ' + year);
        queried++;
      }

      for (const month of months) {
        const c = counts?.[year]?.[MONTH_NAMES[month - 1]];
        byMonth[month].push([diseaseName, ...(c ? STATE_CODES.map(s => c[s] ?? 0) : zero)]);
      }
    }

    // The rows arrive grouped by disease, so collect per month first and add
    // the months in order.
    for (const month of months) {
      yearFile.push({ last_refreshed: lastRefreshed, year, month, columns: ['disease', ...STATE_CODES], rows: byMonth[month] });
    }

    fs.writeFileSync(MONTH_CACHE_DIR + '/' + year + '_notifications.json', JSON.stringify(yearFile));
    console.log('Wrote ' + year + ': ' + months.length + ' month(s), ' + (months.length * diseases.length) + ' rows (' + queried + ' queried, ' + (diseases.length - queried) + ' skipped)');
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
      "body": "{\"version\":\"1.0.0\",\"queries\":[{\"Query\":{\"Commands\":[{\"SemanticQueryDataShapeCommand\":{\"Query\":{\"Version\":2,\"From\":[{\"Name\":\"d\",\"Entity\":\"DELTALOAD_DATAMART DISEASE_DIM\",\"Type\":0},{\"Name\":\"d1\",\"Entity\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT\",\"Type\":0},{\"Name\":\"d2\",\"Entity\":\"DELTALOAD_DATAMART CASE_DIM\",\"Type\":0}],\"Select\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"DISEASE NAME\"},\"Name\":\"DELTALOAD_DATAMART DISEASE_DIM.DISEASE NAME\"},{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"DISEASE GROUP\"},\"Name\":\"DELTALOAD_DATAMART DISEASE_DIM.DISEASE GROUP\"}],\"Where\":[{\"Condition\":{\"Comparison\":{\"ComparisonKind\":1,\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DAX_Year\"}},\"Right\":{\"Literal\":{\"Value\":\"1990L\"}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"DISEASE GROUP\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Unknown'\"}}],[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d2\"}},\"Property\":\"Age Group\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Hepatitis C (<24 months)'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d2\"}},\"Property\":\"CONFIRMATION_STATUS\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Confirmed'\"}}],[{\"Literal\":{\"Value\":\"'Probable'\"}}]]}}}]},\"Binding\":{\"Primary\":{\"Groupings\":[{\"Projections\":[0,1]}]},\"DataReduction\":{\"DataVolume\":3,\"Primary\":{\"Window\":{}}},\"IncludeEmptyGroups\":true,\"Version\":1},\"ExecutionMetricsKind\":1}}]},\"QueryId\":\"\",\"ApplicationContext\":{\"DatasetId\":\"3471d96b-c14c-403f-b3a6-016f1deac28e\",\"Sources\":[{\"ReportId\":\"bc027587-5e9e-4920-bf03-a45fd3079f25\",\"VisualId\":\"fa18ef3590c8cb060361\"}]}}],\"cancelQueries\":[],\"modelId\":3305775,\"userPreferredLocale\":\"en-GB\",\"allowLongRunningQueries\":true}",
      "method": "POST"
    });

    // Convert the response into text
    const data = await response.json();
    // [DISEASE NAME, DISEASE GROUP] are dictionary-encoded (ValueDicts.D0/D1);
    // row.R bitmask marks which of the two repeat from the previous row (see
    // powerbi.js header comment on this same row-sparsity scheme).
    const ds0 = data.results[0].result.data.dsr.DS[0];
    const dictionaries = [ds0.ValueDicts.D0, ds0.ValueDicts.D1];
    const diseaseRows = ds0.PH[0].DM0;
    const current = [undefined, undefined];   // [name, group]
    const diseases = [];
    const diseaseGroups = {};
    diseaseRows.forEach(row => {
      const repeatMask = row.R || 0;
      var ci = 0;
      for (var d = 0; d < dictionaries.length; d++) {
        if (!(repeatMask & (1 << d))) current[d] = dictionaries[d][row.C[ci++]];
      }
      diseases.push(current[0]);
      diseaseGroups[current[0]] = current[1];
    });
    fs.mkdirSync('data/reference', { recursive: true });
    fs.writeFileSync('data/reference/disease_groups.json', JSON.stringify(diseaseGroups, null, 2));

    // 'year' mode has its own build path — see buildYearOutput. Scope defaults
    // to the current (still-accumulating) year; scopeArg can target a specific
    // past year to backfill, or 'all' to rebuild the full history.
    if (mode === 'year') {
      const currentYear = Number(reportDate.slice(0, 4));
      const yearsToFetch = scopeArg === 'all'
        ? Array.from({ length: currentYear - YEAR_FLOOR + 1 }, (_, i) => YEAR_FLOOR + i)
        : scopeArg ? [Number(scopeArg)]
        : [currentYear];
      await buildYearOutput(capacityUri, token, diseases, yearsToFetch, lastRefreshed);
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
      await buildMonthOutput(capacityUri, token, diseases, periodsToFetch, lastRefreshed, currentYear, currentMonth);
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

    fs.mkdirSync(DAY_CACHE_DIR, { recursive: true });
    fs.writeFileSync(DAY_CACHE_DIR + '/' + reportDate + '_notifications.json', JSON.stringify(output));

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
