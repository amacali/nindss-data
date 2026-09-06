/*******************************************************************************
  NINDSS notification scraper — pulls notifiable-disease notification counts
  for Australia from the NINDSS PowerBI dashboard. Three modes:
    node index.js / all-time        → data/all-time/<reportDate>_notifications.json (daily, default)
    node index.js year [Y|all]      → data/notifications_by_year.json (on request)
    node index.js month [YM|Y|all]  → data/month/<year>_notifications.json (on request)
    node index.js day [YMD|YM]      → data/day/<YYYYMMDD>_notifications.json (rolling 30d)

  Both write one file per YEAR, holding each period's OWN count rather than a
  running total. A 'year' file is one object with a row per disease; a 'month'
  file is an ARRAY of that year's months, each element keeping the same
  { last_refreshed, year, month, columns, rows } shape. Counts are unmasked:
  every query selects Count_Notification, which returns the real value where
  the dashboard's <5 mask would report 0. Scope defaults to the current year;
  an optional third CLI arg targets a past year, or 'all' rebuilds the full
  history. A targeted year is always fetched live and rewritten whole.

  PowerBI query/decoding logic lives in powerbi.js.
  Output schema details: see README.md.
*******************************************************************************/

  import fetch from 'node-fetch';
  import fs from 'fs';
  import { STATE_CODES, MONTH_NAMES, getToken, getLatestUpdateDate, getCaseNumbers } from './powerbi.js';

  // Earliest year any disease has data for, read from the disease year map
  // (data/ref_disease_years.json) rather than hardcoded. The queries
  // carry NO year floor of their own — an earlier hardcoded 1990 silently
  // dropped real pre-1990 cases (Chlamydial infection goes back to 1938,
  // Gonococcal to 1973), which made 'all-time' and the year files disagree.
  const DISEASE_YEARS_PATH = 'data/ref_disease_years.json';
  const YEAR_FLOOR = fs.existsSync(DISEASE_YEARS_PATH)
    ? JSON.parse(fs.readFileSync(DISEASE_YEARS_PATH, 'utf8')).floor_year
    : 1938;
  const ALL_TIME_FILE = 'data/notifications_all_time.json';
  const DAY_FILE = 'data/notifications_by_day.json';
  // Days kept in the rolling data/day/ window. Diagnosis date arrives late, so
  // the newest days are always incomplete and keep rising for weeks; rebuilding
  // the whole window each run lets every file self-correct.
  const DAY_WINDOW = 30;
  const YEAR_FILE = 'data/notifications_by_year.json';
  const MONTH_FILE = 'data/notifications_by_month.json';
  // Years per 'month' query. 25 x 12 = 300 cells, under the 500-row cap.
  const MONTH_BLOCK = 25;
  const RUN_LOG = 'data/log.json';

  // Every PowerBI request goes through getCaseNumbers, so counting calls here
  // gives an exact request count per run without touching the client.
  const metrics = { requests: 0 };
  const countedGetCaseNumbers = (...args) => { metrics.requests++; return getCaseNumbers(...args); };

  // Appends one entry per run: what ran, how long it took, how many requests it
  // cost. Keeps the last 100 so the file stays small and queryable.
  function logRun(mode, scopeArg, startedAt, outcome) {
    const entry = {
      mode, scope: scopeArg || null,
      started_at: new Date(startedAt).toISOString(),
      seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      requests: metrics.requests,
      ...outcome
    };
    let log = [];
    if (fs.existsSync(RUN_LOG)) { try { log = JSON.parse(fs.readFileSync(RUN_LOG, 'utf8')); } catch {} }
    log.push(entry);
    fs.writeFileSync(RUN_LOG, JSON.stringify(log.slice(-100), null, 2));
    console.log(`[${mode}] ${entry.seconds}s, ${entry.requests} requests`);
  }

// Writes data/notifications_by_day.json: an ARRAY of day objects, each holding
// that day's OWN per-state counts by diagnosis date.
//
// ONE query per disease covers the whole window, not one per disease-day: the
// query groups on DIAGNOSIS_DATE (primary) with STATE secondary, so a 30-day
// window is 67 requests and ~9s rather than 2,010 and 5 minutes. The date
// arrives as G0 on each row, the same single-primary-dimension shape 'year'
// mode reads its year from.
//
// The window must stay under the 500-row cap that applies whenever a secondary
// axis is present: one row per day with cases, so ~365 days is the ceiling.
//
// The newest days read low and are NOT final — a diagnosis reaches the system
// days later, so those counts keep rising. Rebuilding the whole window each
// run is what corrects them.
async function buildDayOutput(capacityUri, token, diseases, daysToFetch, lastRefreshed) {
  const from = daysToFetch[0];
  const to = daysToFetch[daysToFetch.length - 1];
  const range = {
    from: from.slice(0, 4) + '-' + from.slice(4, 6) + '-' + from.slice(6, 8),
    to: new Date(Date.UTC(+to.slice(0, 4), +to.slice(4, 6) - 1, +to.slice(6, 8) + 1))
          .toISOString().slice(0, 10)
  };

  const byDay = {};                       // 'YYYY-MM-DD' -> rows[]
  for (const day of daysToFetch) byDay[day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8)] = [];

  for (const diseaseName of diseases) {
    const perDay = await countedGetCaseNumbers(capacityUri, token, diseaseName, 'day', undefined, range);
    if (!perDay) throw new Error('Day query failed for ' + diseaseName);
    for (const date of Object.keys(byDay)) {
      const counts = perDay[date];
      byDay[date].push([diseaseName, ...STATE_CODES.map(st => (counts?.[st]) ?? 0)]);
    }
  }

  const dayFile = Object.keys(byDay).sort().map(date => ({
    last_refreshed: lastRefreshed, date,
    columns: ['disease', ...STATE_CODES], rows: byDay[date]
  }));
  fs.writeFileSync(DAY_FILE, JSON.stringify(dayFile));
  console.log('Wrote ' + dayFile.length + ' days to ' + DAY_FILE);
}

// Turns the CLI's optional third arg into a list of 'YYYYMMDD' days, newest
// last. No arg → the rolling DAY_WINDOW ending on reportDate; 'YYYYMMDD' → that
// one day; 'YYYYMM' → every day of that month (to reportDate if it is current).
function parseDayScope(scopeArg, reportDate) {
  const asDay = d => d.toISOString().slice(0, 10).replace(/-/g, '');
  const end = new Date(Date.UTC(+reportDate.slice(0, 4), +reportDate.slice(4, 6) - 1, +reportDate.slice(6, 8)));
  const span = (startD, endD) => {
    const out = [];
    for (let d = new Date(startD); d <= endD; d = new Date(d.getTime() + 864e5)) out.push(asDay(d));
    return out;
  };
  if (!scopeArg) return span(new Date(end.getTime() - (DAY_WINDOW - 1) * 864e5), end);
  if (/^\d{8}$/.test(scopeArg)) return [scopeArg];
  if (/^\d{6}$/.test(scopeArg)) {
    const year = +scopeArg.slice(0, 4), month = +scopeArg.slice(4, 6);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const last = new Date(Date.UTC(year, month, 0));
    return span(first, last < end ? last : end);
  }
  throw new Error("invalid day scope '" + scopeArg + "' — expected YYYYMMDD, YYYYMM, or no arg");
}

// Writes one file per DAX_Year in `yearsToFetch` under
// data/year/<year>_notifications.json — that year's own per-state counts
// across every disease. Every requested year is fetched live and overwritten
// `yearsToFetch` no longer picks what is WRITTEN — the file is always written
// whole, YEAR_FLOOR..currentYear, for the same reason buildMonthOutput rebuilds
// a whole year: a scoped run would otherwise drop every year it did not target.
// This costs nothing, because one query per disease already returns every year.
async function buildYearOutput(capacityUri, token, diseases, yearsToFetch, lastRefreshed) {
  // One query per disease returns EVERY year at once, so the whole history
  // costs ~67 requests rather than one per disease-year. Counts are that
  // year's own total, not a running total.
  const allYears = [];
  const maxYear = Math.max(...yearsToFetch);
  for (let year = YEAR_FLOOR; year <= maxYear; year++) allYears.push(year);

  const byYear = {};   // year -> rows[]
  for (const year of allYears) byYear[year] = [];

  for (const diseaseName of diseases) {
    const perYear = await countedGetCaseNumbers(capacityUri, token, diseaseName, 'year');
    if (!perYear) throw new Error('Year query failed for ' + diseaseName);
    for (const year of allYears) {
      const counts = perYear[year];
      byYear[year].push([diseaseName, ...STATE_CODES.map(s => (counts?.[s]) ?? 0)]);
    }
  }

  // One file holding every year, as an ARRAY of year objects — each element
  // keeps the full shape it had as its own file. Mirrors data/month/.
  const yearFile = allYears.map(year => ({
    last_refreshed: lastRefreshed, year,
    columns: ['disease', ...STATE_CODES], rows: byYear[year]
  }));
  fs.writeFileSync(YEAR_FILE, JSON.stringify(yearFile));
  console.log('Wrote ' + allYears.length + ' years to ' + YEAR_FILE);
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

// Writes data/notifications_by_month.json: an ARRAY of month objects, each
// holding that month's OWN per-state counts.
//
// Queried per DISEASE-BLOCK of MONTH_BLOCK years, not per disease-year: one
// query returns every month in the block, so the full history costs ~132
// requests rather than ~1,745. A 25-year block is at most 300 cells, under the
// 500-row cap that applies whenever a secondary axis is present (Window.Count
// does NOT raise that cap — 500, 1000, 5000 and 20000 all return exactly 500).
//
// The file is always written WHOLE, for the same reason the year file is: a
// scoped run would otherwise drop every period it did not target.
async function buildMonthOutput(capacityUri, token, diseases, periodsToFetch, lastRefreshed, reportYear, reportMonth) {
  const diseaseYears = fs.existsSync(DISEASE_YEARS_PATH)
    ? JSON.parse(fs.readFileSync(DISEASE_YEARS_PATH, 'utf8')).diseases
    : {};

  const maxYear = Number(reportYear);
  const blocks = [];
  for (let y = YEAR_FLOOR; y <= maxYear; y += MONTH_BLOCK) {
    blocks.push([y, Math.min(y + MONTH_BLOCK - 1, maxYear)]);
  }

  // year -> month -> rows[]
  const byPeriod = {};
  for (let year = YEAR_FLOOR; year <= maxYear; year++) {
    const lastMonth = year === maxYear ? Number(reportMonth) : 12;
    byPeriod[year] = {};
    for (let m = 1; m <= lastMonth; m++) byPeriod[year][m] = [];
  }

  const zero = STATE_CODES.map(() => 0);
  for (const diseaseName of diseases) {
    // The reference map lists the exact years each disease has cases in, so a
    // block with none is skipped entirely rather than queried for zeros.
    const span = diseaseYears[diseaseName];
    const merged = {};
    for (const [from, to] of blocks) {
      if (span && span.years && !span.years.some(y => y >= from && y <= to)) continue;
      const perYearMonth = await countedGetCaseNumbers(capacityUri, token, diseaseName, 'month', [from, to]);
      if (!perYearMonth) throw new Error('Month query failed for ' + diseaseName + ' ' + from + '-' + to);
      for (const y of Object.keys(perYearMonth)) merged[y] = { ...(merged[y] || {}), ...perYearMonth[y] };
    }
    for (const year of Object.keys(byPeriod)) {
      for (const month of Object.keys(byPeriod[year])) {
        const counts = merged[year]?.[MONTH_NAMES[month - 1]];
        byPeriod[year][month].push(counts
          ? [diseaseName, ...STATE_CODES.map(st => counts[st] ?? 0)]
          : [diseaseName, ...zero]);
      }
    }
  }

  const monthFile = [];
  for (let year = YEAR_FLOOR; year <= maxYear; year++) {
    for (const month of Object.keys(byPeriod[year]).map(Number).sort((a, b) => a - b)) {
      monthFile.push({ last_refreshed: lastRefreshed, year, month,
                       columns: ['disease', ...STATE_CODES], rows: byPeriod[year][month] });
    }
  }
  fs.writeFileSync(MONTH_FILE, JSON.stringify(monthFile));
  console.log('Wrote ' + monthFile.length + ' months to ' + MONTH_FILE);
}

async function getDiseaseList(mode, scopeArg) {

  const startedAt = Date.now();
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
    fs.writeFileSync('data/ref_disease_groups.json', JSON.stringify(diseaseGroups, null, 2));

    // 'day' mode — see buildDayOutput. Scope defaults to the rolling
    // DAY_WINDOW ending on reportDate; scopeArg can target one day or a month.
    if (mode === 'day') {
      const daysToFetch = parseDayScope(scopeArg, reportDate);
      await buildDayOutput(capacityUri, token, diseases, daysToFetch, lastRefreshed);
      logRun(mode, scopeArg, startedAt, { days: daysToFetch.length, file: DAY_FILE });
      return;
    }

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
      logRun(mode, scopeArg, startedAt, { file: YEAR_FILE });
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
      logRun(mode, scopeArg, startedAt, { file: MONTH_FILE });
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
      const result = await countedGetCaseNumbers(capacityUri,token,diseaseName,mode);
      if (!result) continue;   // query failed for this disease; skip rather than crash
      output.rows.push([diseaseName, ...STATE_CODES.map(s => result[s] ?? 0)]);
    }

    fs.writeFileSync(ALL_TIME_FILE, JSON.stringify(output));
    console.log('Wrote ' + output.rows.length + ' diseases to ' + ALL_TIME_FILE);
    logRun(mode, scopeArg, startedAt, { diseases: output.rows.length, file: ALL_TIME_FILE });

  } catch (error) {
    console.log(error);
  }
}
  // Run the scraper — see the header comment above for the mode/scope table.
  const arg = process.argv[2];
  const mode = (arg === 'year' || arg === 'month' || arg === 'day') ? arg : 'all-time';
  const scopeArg = process.argv[3];
  getDiseaseList(mode, scopeArg);
