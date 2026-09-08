/*******************************************************************************
  NINDSS PowerBI client — shared DAX query client for the NINDSS PowerBI
  dashboard (https://nindss.health.gov.au/pbi-dashboard/). There is no public
  NINDSS API; this reverse-engineers the embedded PowerBI report:

    getConfig() → getToken() → getLatestUpdateDate() / getCaseNumbers()

  All data queries POST hand-built DAX (SemanticQueryDataShapeCommand) bodies
  copied from the dashboard's own network traffic — the DatasetId, ReportId,
  VisualId and entity/column names inside them are what break if the
  dashboard changes. Used by index.js.
*******************************************************************************/

  // NPM packages that we installed
  import * as cheerio from 'cheerio';
  import fetch from 'node-fetch';
  import moment from 'moment';
  import 'moment-timezone';

  // Canonical column order for the flat output rows. States exclude AUS (the
  // per-disease query filters it out); month names map to 1-12 by position.
  export const STATE_CODES = ['ACT','NSW','NT','QLD','SA','TAS','VIC','WA'];
  export const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Count_Notification returns a FORMATTED DISPLAY STRING for any nonzero
  // count — quoted, and comma-grouped past 999, e.g. "'1'" or "'7,208'". A
  // true zero comes back as the integer 0 (DAX "0L") instead. Strip both the
  // quotes and the separators before parsing; missing the commas silently
  // truncates 7,208 to 7.
  //
  // The reason to pay that cost: Count_Notification_forgraph (the measure the
  // visuals use) applies the dashboard's <5 mask and reports those cells as a
  // plain 0, while this measure returns the real value. Confirmed on Measles
  // 2019 (ACT/SA/TAS) and 2020 (VIC/WA), and on Rabies 2026 QLD.
  // On the SECONDARY axis ('year'/'month' per-row X arrays) this measure is
  // additionally DICTIONARY-ENCODED: M0 is an INDEX into one of ds0.ValueDicts,
  // not the value itself. WHICH dict varies by mode — 'year' uses D0, 'month'
  // uses D2 (D0/D1 there are the year/month DIMENSION dicts) — so the name is
  // read off the X header's "DN" field rather than hardcoded. Pass it as
  // `dict`. On the PRIMARY axis ('all-time') values are literal and `dict` is
  // omitted. Reading an index as a count yields plausible-looking wrong
  // numbers, so this distinction matters.
  function parseMeasure(value, dict) {
    if (dict && typeof value === 'number') value = dict[value];
    if (typeof value === 'number') return value;
    if (value === undefined || value === null) return 0;
    const parsed = parseInt(String(value).replace(/[',]/g, ''), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

// Fetches the dashboard HTML and decodes the base64 `embedconfig` attribute
// off <div class="powerbi"> into the PowerBI embed config (report id + token).
  export async function getConfig() {

    try {
      const response = await fetch("https://nindss.health.gov.au/pbi-dashboard/");
      const body = await response.text();
      const $ = cheerio.load(body);

      var decode = '';
      $('div.powerbi').map((i, el) => {
        var b64string = $(el).attr('embedconfig');
        decode = Buffer.from(b64string,'base64').toString('utf8');
      });

      return JSON.parse(decode);
    } catch (error) {
      console.log(error);
    }
  }

// Trades the embed token for a short-lived MWCToken + the `capacityUri` that
// DAX queries POST to. Returns { reportId, token, capacityUri }.
  export async function getToken() {

    var config = await getConfig();
    const reportId = config.Id;
    const embedToken = config.EmbedToken['token'];

    try {
      const response = await fetch(
        "https://wabi-australia-southeast-redirect.analysis.windows.net/explore/reports/" + reportId + "/modelsAndExploration?preferReadOnlySession=true&skipQueryData=true", {
        "headers": {
          "accept": "application/json, text/plain, */*",
          "accept-language": "en-AU,en-US;q=0.9,en;q=0.8,fr;q=0.7",
          "authorization": "EmbedToken " + embedToken,
          "sec-ch-ua": "\"Google Chrome\";v=\"119\", \"Chromium\";v=\"119\", \"Not?A_Brand\";v=\"24\"",
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": "\"Windows\"",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "cross-site",
          "x-powerbi-hostenv": "Embed for Customers",
          "Referer": "https://app.powerbi.com/",
          "Referrer-Policy": "strict-origin-when-cross-origin"
        },
        "body": null,
        "method": "GET"
      });

      // Convert the response into text
      const data = await response.json();
      return {
        reportId: reportId,
        token: data.exploration.mwcToken,
        capacityUri: data.exploration.capacityUri
      };

    } catch (error) {
      console.log(error);
    }
  }

// Reads the DataRefreshAEST table (the dashboard's "Last refreshed on" value)
// and returns { reportDate: "YYYYMMDD" (GMT), lastRefreshed: full AEST/AEDT
// timestamp } — both derived from the same epoch.
  export async function getLatestUpdateDate(capacityUri,token) {

    try {
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
        "body": "{\"version\":\"1.0.0\",\"queries\":[{\"Query\":{\"Commands\":[{\"SemanticQueryDataShapeCommand\":{\"Query\":{\"Version\":2,\"From\":[{\"Name\":\"d1\",\"Entity\":\"DataRefreshAEST\",\"Type\":0},{\"Name\":\"d\",\"Entity\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT\",\"Type\":0},{\"Name\":\"d11\",\"Entity\":\"DELTALOAD_DATAMART DISEASE_DIM\",\"Type\":0},{\"Name\":\"d2\",\"Entity\":\"DELTALOAD_DATAMART CASE_DIM\",\"Type\":0}],\"Select\":[{\"Aggregation\":{\"Expression\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DateTimeAEST\"}},\"Function\":3},\"Name\":\"Min(DataRefreshAEST.DateTimeAEST)\"}],\"Where\":[{\"Condition\":{\"Comparison\":{\"ComparisonKind\":1,\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"DAX_Year\"}},\"Right\":{\"Literal\":{\"Value\":\"1990L\"}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE GROUP\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Unknown'\"}}],[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d2\"}},\"Property\":\"Age Group\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Hepatitis C (<24 months)'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d2\"}},\"Property\":\"CONFIRMATION_STATUS\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Confirmed'\"}}],[{\"Literal\":{\"Value\":\"'Probable'\"}}]]}}}]},\"Binding\":{\"Primary\":{\"Groupings\":[{\"Projections\":[0]}]},\"DataReduction\":{\"DataVolume\":3,\"Primary\":{\"Top\":{}}},\"Version\":1},\"ExecutionMetricsKind\":1}}]},\"CacheKey\":\"{\\\"Commands\\\":[{\\\"SemanticQueryDataShapeCommand\\\":{\\\"Query\\\":{\\\"Version\\\":2,\\\"From\\\":[{\\\"Name\\\":\\\"d1\\\",\\\"Entity\\\":\\\"DataRefreshAEST\\\",\\\"Type\\\":0},{\\\"Name\\\":\\\"d\\\",\\\"Entity\\\":\\\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT\\\",\\\"Type\\\":0},{\\\"Name\\\":\\\"d11\\\",\\\"Entity\\\":\\\"DELTALOAD_DATAMART DISEASE_DIM\\\",\\\"Type\\\":0},{\\\"Name\\\":\\\"d2\\\",\\\"Entity\\\":\\\"DELTALOAD_DATAMART CASE_DIM\\\",\\\"Type\\\":0}],\\\"Select\\\":[{\\\"Aggregation\\\":{\\\"Expression\\\":{\\\"Column\\\":{\\\"Expression\\\":{\\\"SourceRef\\\":{\\\"Source\\\":\\\"d1\\\"}},\\\"Property\\\":\\\"DateTimeAEST\\\"}},\\\"Function\\\":3},\\\"Name\\\":\\\"Min(DataRefreshAEST.DateTimeAEST)\\\"}],\\\"Where\\\":[{\\\"Condition\\\":{\\\"Comparison\\\":{\\\"ComparisonKind\\\":1,\\\"Left\\\":{\\\"Column\\\":{\\\"Expression\\\":{\\\"SourceRef\\\":{\\\"Source\\\":\\\"d\\\"}},\\\"Property\\\":\\\"DAX_Year\\\"}},\\\"Right\\\":{\\\"Literal\\\":{\\\"Value\\\":\\\"1990L\\\"}}}}},{\\\"Condition\\\":{\\\"Not\\\":{\\\"Expression\\\":{\\\"In\\\":{\\\"Expressions\\\":[{\\\"Column\\\":{\\\"Expression\\\":{\\\"SourceRef\\\":{\\\"Source\\\":\\\"d11\\\"}},\\\"Property\\\":\\\"DISEASE GROUP\\\"}}],\\\"Values\\\":[[{\\\"Literal\\\":{\\\"Value\\\":\\\"'Unknown'\\\"}}],[{\\\"Literal\\\":{\\\"Value\\\":\\\"null\\\"}}]]}}}}},{\\\"Condition\\\":{\\\"Not\\\":{\\\"Expression\\\":{\\\"In\\\":{\\\"Expressions\\\":[{\\\"Column\\\":{\\\"Expression\\\":{\\\"SourceRef\\\":{\\\"Source\\\":\\\"d2\\\"}},\\\"Property\\\":\\\"Age Group\\\"}}],\\\"Values\\\":[[{\\\"Literal\\\":{\\\"Value\\\":\\\"null\\\"}}]]}}}}},{\\\"Condition\\\":{\\\"Not\\\":{\\\"Expression\\\":{\\\"In\\\":{\\\"Expressions\\\":[{\\\"Column\\\":{\\\"Expression\\\":{\\\"SourceRef\\\":{\\\"Source\\\":\\\"d11\\\"}},\\\"Property\\\":\\\"DISEASE NAME\\\"}}],\\\"Values\\\":[[{\\\"Literal\\\":{\\\"Value\\\":\\\"'Hepatitis C (<24 months)'\\\"}}]]}}}}},{\\\"Condition\\\":{\\\"In\\\":{\\\"Expressions\\\":[{\\\"Column\\\":{\\\"Expression\\\":{\\\"SourceRef\\\":{\\\"Source\\\":\\\"d2\\\"}},\\\"Property\\\":\\\"CONFIRMATION_STATUS\\\"}}],\\\"Values\\\":[[{\\\"Literal\\\":{\\\"Value\\\":\\\"'Confirmed'\\\"}}],[{\\\"Literal\\\":{\\\"Value\\\":\\\"'Probable'\\\"}}]]}}}]},\\\"Binding\\\":{\\\"Primary\\\":{\\\"Groupings\\\":[{\\\"Projections\\\":[0]}]},\\\"DataReduction\\\":{\\\"DataVolume\\\":3,\\\"Primary\\\":{\\\"Top\\\":{}}},\\\"Version\\\":1},\\\"ExecutionMetricsKind\\\":1}}]}\",\"QueryId\":\"\",\"ApplicationContext\":{\"DatasetId\":\"3471d96b-c14c-403f-b3a6-016f1deac28e\",\"Sources\":[{\"ReportId\":\"bc027587-5e9e-4920-bf03-a45fd3079f25\",\"VisualId\":\"01d26fd2c7be60912440\"}]}}],\"cancelQueries\":[],\"modelId\":3305775,\"userPreferredLocale\":\"en-AU\"}",
        "method": "POST"
      });

      // Convert the response into text
      const data = await response.json();
      const epoch = data.results[0].result.data.dsr.DS[0].PH[0].DM0[0].M0;
      // The epoch already carries the wall-clock time the dashboard prints in
      // its "Last Refreshed On" card, so read it as GMT to recover those
      // digits, then LABEL them Australia/Melbourne. Converting instead of
      // labelling shifts it a further 10 hours and can roll it into the next
      // day (dashboard 05/09 3:31:23 PM became 2026-09-06T01:31:23+10:00).
      return {
        reportDate: moment(epoch).tz("GMT").format("YYYYMMDD"),
        lastRefreshed: moment.tz(moment(epoch).tz("GMT").format("YYYY-MM-DDTHH:mm:ss"), "Australia/Melbourne").format()
      };

    } catch (error) {
      console.log(error);
    }
  }


// getCaseNumbers(capacityUri, token, diseaseName, mode) — per-state counts for
// one disease, nested by period. `mode` picks both query granularity and shape:
//   'all-time' → { <state>: count }
//   'year'     → { <year>: { <state>: count } }
//   'month'    → { <year>: { <month>: { <state>: count } } }
// Every mode selects Count_Notification, which returns the real value rather
// than the <5-masked one — see parseMeasure. This is the only query path now:
// index.js's year/month builds all come through here.
//
// Each mode is queried at its own granularity rather than summed from a finer
// one, because the dashboard masks any cell <5 and summing finer cells
// accumulates that loss (COVID-19 lifetime total: 12,302,011 all-time vs
// 12,302,009 year-summed vs 12,301,939 month-summed).
//
// Two response layouts (PowerBI rejects a secondary axis with no primary):
// 'all-time' has no period, so STATE is the PRIMARY axis (each DM0 row is one
// state, C=[state, measure]). 'year'/'month' keep STATE on the SECONDARY axis
// (the per-row X array, labelled via SH[0].DM1) with period(s) as primary rows.
//
// Decoding uses two sparse-encoding schemes: row sparsity (row.R bitmask marks
// which of a row's projected values repeat the previous row, so only changed
// ones appear in row.C) and measure sparsity (a state's M0 in row.X is omitted
// when it repeats the previous state's value). 'month' additionally
// dictionary-encodes [year, month] via ValueDicts.D0/D1; 'year' has a single
// primary dimension so the year sits directly on row.G0.
//
// Gotcha: the STATE secondary-axis key is G<n> where n = number of primary
// dimensions (G1 for 'year', G2 for 'month') — projecting an extra hierarchy
// level shifts every later dimension's G-number.

// `onlyYear` (optional) restricts the query by DAX_Year: a NUMBER for one year,
// or [from, to] for a block. 'month' mode needs it — PowerBI truncates a result
// set at 500 rows whenever a SECONDARY axis is present, and Window.Count does
// NOT raise that (500, 1000, 5000 and 20000 all return exactly 500), so a
// full-history month query silently loses everything past ~41 years. A 25-year
// block returns at most 300 cells and cannot truncate.

// `dayRange` (optional) is { from, to } as 'YYYY-MM-DD', half-open: from <= d < to.
// Only 'day' needs it. The filter constrains the date column on the FACT table
// rather than the grouping, so a day, a month and a year on the same column
// always reconcile exactly — verified to 0 difference across every disease
// for September 2026, and for year 2025 against its 12 months.
//
// 'day' uses DIAGNOSIS_DATE, and it is the basis the year and month files share:
// the dashboard's own filter reads
// "Diagnosis Year, Diagnosis Quarter, Diagnosis Month Name", and a diagnosis
// year query matches data/year/2025_notifications.json to the case (1,171,052).
export async function getCaseNumbers(capacityUri,token,diseaseName,mode,onlyYear,dayRange) {

  // The three queries differ only in which period dimensions are projected and
  // how STATE is bound. Assemble the varying pieces per mode:
  //   'all-time' → Select [STATE, Measure];        Primary [0,1], no Secondary
  //   'day'      → as 'all-time', plus a DIAGNOSIS_DATE range filter
  //   'year'     → Select [STATE, Year, Measure];  Primary [1,2], Secondary [STATE]
  //   'month'    → Select [STATE, Year, Month, M]; Primary [1,2,3], Secondary [STATE]
  const SEL_YEAR = "{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Year\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.Diagnosis Year Drill Down.Diagnosis Year\"}";
  const SEL_MONTH = "{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Month Name\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.Diagnosis Year Drill Down.Diagnosis Month Name\"}";
  // Count_Notification, NOT Count_Notification_forgraph: the _forgraph variant
  // applies the dashboard's <5 mask and reports masked cells as 0. See
  // parseMeasure above for the encoding this measure returns.
  const SEL_MEASURE = "{\"Measure\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"Count_Notification\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.Count_Notification\",\"NativeReferenceName\":\"Count_Notification\"}";
  const ORDER_YEAR = "{\"Direction\":1,\"Expression\":{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Year\"}}},";
  const ORDER_STATE = "{\"Direction\":1,\"Expression\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}}";

  // Period selects (between STATE and the measure), primary projections, binding,
  // and order-by, per mode.
  // 'day' groups and filters on DIAGNOSIS_DATE, the basis the year and month
  // files share.
  const dayMode = mode === 'day';
  const SEL_DATE = "{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DIAGNOSIS_DATE\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.DIAGNOSIS_DATE\"}";
  const periodSelect = mode === 'month' ? SEL_YEAR + "," + SEL_MONTH + ","
                     : mode === 'year'  ? SEL_YEAR + ","
                     : dayMode          ? SEL_DATE + ","
                     : "";                    // 'all-time': no period dimension
  const primaryProjections = mode === 'month' ? "[1,2,3]"
                           : dayMode          ? "[1,2]"   // [date, measure]
                           : mode === 'year'  ? "[1,2]"
                           : "[0,1]";              // all-time: [STATE, measure]
  const flatMode = mode === 'all-time';   // STATE on the PRIMARY axis
  const binding = flatMode
    ? "{\"Primary\":{\"Groupings\":[{\"Projections\":[0,1]}]},\"DataReduction\":{\"DataVolume\":4,\"Primary\":{\"Window\":{\"Count\":1000}}},\"Version\":1}"
    : "{\"Primary\":{\"Groupings\":[{\"Projections\":" + primaryProjections + "}]},\"Secondary\":{\"Groupings\":[{\"Projections\":[0]}]},\"DataReduction\":{\"DataVolume\":4,\"Primary\":{\"Window\":{\"Count\":5000}},\"Secondary\":{\"Top\":{\"Count\":100}}},\"Version\":1}";
  const ORDER_DATE = "{\"Direction\":1,\"Expression\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DIAGNOSIS_DATE\"}}},";
  const orderBy = flatMode        ? ORDER_STATE
                : dayMode         ? ORDER_DATE + ORDER_STATE
                : ORDER_YEAR + ORDER_STATE;

  // Half-open DIAGNOSIS_DATE range for 'day'. ComparisonKind: 0 '=', 1 '>',
  // 2 '>=', 3 '<', 4 '<=' — verified against DAX_Year, where the totals for
  // kinds 2 and 4 must equal the sum of their parts. Using 1 as an upper bound
  // (the intuitive but wrong reading) returns plausible garbage, not an error.
  const dayFilter = dayRange
    ? ",{\"Condition\":{\"Comparison\":{\"ComparisonKind\":2,\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DIAGNOSIS_DATE\"}},\"Right\":{\"Literal\":{\"Value\":\"datetime'" + dayRange.from + "T00:00:00'\"}}}}}"
    + ",{\"Condition\":{\"Comparison\":{\"ComparisonKind\":3,\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DIAGNOSIS_DATE\"}},\"Right\":{\"Literal\":{\"Value\":\"datetime'" + dayRange.to + "T00:00:00'\"}}}}}"
    : "";

  // `onlyYear` is either one year (equality) or [from, to] for a BLOCK of
  // years (>= and <=). A block lets 'month' mode cover 25 years in one query
  // instead of one per disease-year: 300 cells against the 500 cap.
  const yearBound = (kind, year) =>
    ",{\"Condition\":{\"Comparison\":{\"ComparisonKind\":" + kind + ",\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DAX_Year\"}},\"Right\":{\"Literal\":{\"Value\":\"" + year + "L\"}}}}}";
    const yearFilter = Array.isArray(onlyYear)
    ? yearBound(2, onlyYear[0]) + yearBound(4, onlyYear[1])
    : onlyYear ? yearBound(0, onlyYear)
    : "";
const body = "{\"version\":\"1.0.0\",\"queries\":[{\"Query\":{\"Commands\":[{\"SemanticQueryDataShapeCommand\":{\"Query\":{\"Version\":2,\"From\":[{\"Name\":\"d1\",\"Entity\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT\",\"Type\":0},{\"Name\":\"d\",\"Entity\":\"DELTALOAD_DATAMART LOCATION_DIM\",\"Type\":0},{\"Name\":\"d11\",\"Entity\":\"DELTALOAD_DATAMART DISEASE_DIM\",\"Type\":0},{\"Name\":\"d3\",\"Entity\":\"DELTALOAD_DATAMART CASE_DIM\",\"Type\":0}],\"Select\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"},\"Name\":\"DELTALOAD_DATAMART LOCATION_DIM.STATE\"}," + periodSelect + SEL_MEASURE + "],\"Where\":[{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'AUS'\"}}],[{\"Literal\":{\"Value\":\"'Unknown'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'" + diseaseName + "'\"}}]]}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE GROUP\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Unknown'\"}}],[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"Age Group\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Hepatitis C (<24 months)'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"CONFIRMATION_STATUS\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Confirmed'\"}}],[{\"Literal\":{\"Value\":\"'Probable'\"}}]]}}}" + yearFilter + dayFilter + "],\"OrderBy\":[" + orderBy + "]},\"Binding\":" + binding + ",\"ExecutionMetricsKind\":1}}]},\"QueryId\":\"\",\"ApplicationContext\":{\"DatasetId\":\"3471d96b-c14c-403f-b3a6-016f1deac28e\",\"Sources\":[{\"ReportId\":\"bc027587-5e9e-4920-bf03-a45fd3079f25\",\"VisualId\":\"35d7386fac9435457a0a\"}]}}],\"cancelQueries\":[],\"modelId\":3305775,\"userPreferredLocale\":\"en-GB\",\"allowLongRunningQueries\":true}";

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
      "body": body,
      "method": "POST"
    });

    // Convert the response into text
    const data = await response.json();
    const ds0 = data.results[0].result.data.dsr.DS[0];
    const results = ds0.PH[0].DM0;
    // Measure value dictionary for the secondary axis. The X header names it
    // in "DN" (D0 for 'year', D2 for 'month'); absent on the primary axis.
    const measureDictName = ((((results[0] || {}).X || [])[0] || {}).S || [])
      .reduce((found, col) => found || (col.N === 'M0' ? col.DN : null), null);
    const measureDict = measureDictName
      ? (ds0.ValueDicts || {})[measureDictName]
      : undefined;

    var number = 0;

    console.log('Fetching ' + diseaseName + ' (' + mode + ')');

    if (flatMode) {
      // STATE is on the PRIMARY axis: each row is one state, projected as
      // [state, measure] with row.R flagging which of the two repeat (the
      // measure repeats for runs of equal counts — e.g. long stretches of 0).
      const current = [undefined, undefined];   // [state, measure]
      const cases = {};
      results.forEach(row => {
        const repeatMask = row.R || 0;
        var ci = 0;
        for (var p = 0; p < 2; p++) {
          if (!(repeatMask & (1 << p))) current[p] = row.C[ci++];
        }
        cases[current[0]] = parseMeasure(current[1]);
      });
      return cases;
    }

    // Every mode but 'all-time': STATE is on the secondary axis (the per-row X
    // array); its labels live in SH[0].DM1 under G1 ('year'/'day') or G2
    // ('month' — projecting Month bumps every later dimension's G-number).
    const stateKey = mode === 'month' ? 'G2' : 'G1';
    const states = ds0.SH[0].DM1.map(v => v[stateKey]);
    const years = {};

    if (mode === 'month') {
      // Year/Month are dictionary-encoded (ValueDicts.D0/D1); each row only carries the
      // dimensions that changed since the previous row (row.R is a bitmask of which of
      // [year, month] repeat — the rest are consumed off row.C in order).
      const dictionaries = [ds0.ValueDicts.D0, ds0.ValueDicts.D1];
      const current = [undefined, undefined];

      results.forEach(row => {

        const repeatMask = row.R || 0;
        var ci = 0;
        for (var d = 0; d < dictionaries.length; d++) {
          if (!(repeatMask & (1 << d))) {
            current[d] = dictionaries[d][row.C[ci++]];
          }
        }
        const [year, month] = current;

        if (!years[year]) years[year] = {};
        const cases = {};

        // incrementor for each state
        var i = 0;
        row.X.forEach(col => {

          // check if value exists, otherwise repeat
          if (typeof col.M0 !== 'undefined') {
            number = col.M0;
          }

          // `number` holds the RAW carried-forward value; parse at assignment so
          // a repeated masked string still repeats correctly.
          cases[states[i]] = parseMeasure(number, measureDict);

          i++;
        });

        years[year][month] = cases;
      });
    } else {
      // 'year'/'day': a single primary dimension — no dictionary/bitmask; the
      // period is stored directly on the row as G0. Only measure sparsity
      // applies. 'day' carries an epoch in ms, keyed out as 'YYYY-MM-DD'.
      results.forEach(row => {
        const year = dayMode
          ? new Date(row.G0).toISOString().slice(0, 10)
          : row.G0;
        const cases = {};

        var i = 0;
        row.X.forEach(col => {
          if (typeof col.M0 !== 'undefined') {
            number = col.M0;
          }
          cases[states[i]] = parseMeasure(number, measureDict);
          i++;
        });

        years[year] = cases;
      });
    }

    return years;

  } catch (error) {
    console.log(error);
  }
}
