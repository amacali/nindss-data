/*******************************************************************************
  NINDSS PowerBI client — shared DAX query client for the NINDSS PowerBI
  dashboard (https://nindss.health.gov.au/pbi-dashboard/). There is no public
  NINDSS API; this reverse-engineers the embedded PowerBI report:

    getConfig() → getToken() → getLatestUpdateDate() / getCaseNumbers()

  All data queries POST hand-built DAX (SemanticQueryDataShapeCommand) bodies
  copied from the dashboard's own network traffic — the DatasetId, ReportId,
  VisualId and entity/column names inside them are what break if the
  dashboard changes. Used by both index.js and legacy.js.
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
      return {
        reportDate: moment(epoch).tz("GMT").format("YYYYMMDD"),
        lastRefreshed: moment(epoch).tz("Australia/Sydney").format()
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
// 'year' mode here returns the GROUPED (possibly <5-masked) value, used as-is
// by legacy.js (must stay cheap). index.js's own year/month builds instead use
// getYearCumulativeTotal/getMonthCumulativeTotal below for unmasked totals.
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

// getYearCumulativeTotal(capacityUri, token, diseaseName, maxYear) — per-state
// total for DAX_Year <= maxYear (same PRIMARY-axis shape as 'all-time', plus
// an upper-bound filter). A running total resists <5 masking far better than
// a single year's grouped count (confirmed on Measles: the grouped query
// masked ACT/SA/TAS in 2019 and VIC/WA in 2020 to 0; diffing consecutive
// cumulative totals recovered the true nonzero figures). Returns a total
// THROUGH maxYear, not that year's delta — deltas are computed downstream.
export async function getYearCumulativeTotal(capacityUri, token, diseaseName, maxYear) {
  const SEL_MEASURE = "{\"Measure\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"Count_Notification_forgraph\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.M_Notification_ForGraph\",\"NativeReferenceName\":\"Count_Notification_forgraph\"}";
  const ORDER_STATE = "{\"Direction\":1,\"Expression\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}}";
  // ComparisonKind 4 = LessThanOrEqual (confirmed empirically; ComparisonKind 1,
  // used for the floor filter below, is GreaterThanOrEqual).
  const maxYearFilter = "{\"Condition\":{\"Comparison\":{\"ComparisonKind\":4,\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DAX_Year\"}},\"Right\":{\"Literal\":{\"Value\":\"" + maxYear + "L\"}}}}}";

  const body = "{\"version\":\"1.0.0\",\"queries\":[{\"Query\":{\"Commands\":[{\"SemanticQueryDataShapeCommand\":{\"Query\":{\"Version\":2,\"From\":[{\"Name\":\"d1\",\"Entity\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT\",\"Type\":0},{\"Name\":\"d\",\"Entity\":\"DELTALOAD_DATAMART LOCATION_DIM\",\"Type\":0},{\"Name\":\"d11\",\"Entity\":\"DELTALOAD_DATAMART DISEASE_DIM\",\"Type\":0},{\"Name\":\"d3\",\"Entity\":\"DELTALOAD_DATAMART CASE_DIM\",\"Type\":0}],\"Select\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"},\"Name\":\"DELTALOAD_DATAMART LOCATION_DIM.STATE\"}," + SEL_MEASURE + "],\"Where\":[{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'AUS'\"}}],[{\"Literal\":{\"Value\":\"'Unknown'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'" + diseaseName + "'\"}}]]}}}," + maxYearFilter + ",{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE GROUP\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Unknown'\"}}],[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"Age Group\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Hepatitis C (<24 months)'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"CONFIRMATION_STATUS\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Confirmed'\"}}],[{\"Literal\":{\"Value\":\"'Probable'\"}}]]}}}],\"OrderBy\":[" + ORDER_STATE + "]},\"Binding\":{\"Primary\":{\"Groupings\":[{\"Projections\":[0,1]}]},\"DataReduction\":{\"DataVolume\":4,\"Primary\":{\"Window\":{\"Count\":1000}}},\"Version\":1},\"ExecutionMetricsKind\":1}}]},\"QueryId\":\"\",\"ApplicationContext\":{\"DatasetId\":\"3471d96b-c14c-403f-b3a6-016f1deac28e\",\"Sources\":[{\"ReportId\":\"bc027587-5e9e-4920-bf03-a45fd3079f25\",\"VisualId\":\"35d7386fac9435457a0a\"}]}}],\"cancelQueries\":[],\"modelId\":3305775,\"userPreferredLocale\":\"en-GB\",\"allowLongRunningQueries\":true}";

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
      "body": body,
      "method": "POST"
    });

    const data = await response.json();
    if (!data.results) { console.log('Cumulative query failed for ' + diseaseName + ' <=' + maxYear, data); return null; }
    const ds0 = data.results[0].result.data.dsr.DS[0];
    const results = ds0.PH[0].DM0;

    const current = [undefined, undefined];   // [state, measure]
    const cases = {};
    results.forEach(row => {
      const repeatMask = row.R || 0;
      var ci = 0;
      for (var p = 0; p < 2; p++) {
        if (!(repeatMask & (1 << p))) current[p] = row.C[ci++];
      }
      cases[current[0]] = current[1];
    });
    return cases;

  } catch (error) {
    console.log(error);
    return null;
  }
}

// getMonthCumulativeTotal(capacityUri, token, diseaseName, year, month) —
// per-state total through (year, month), used for the per-month cache build.
// A within-year-only window ("just this year's months so far") is just as
// maskable as a plain grouped query — PowerBI masks on the resulting value,
// not the query shape. What resists masking is a running total spanning the
// ENTIRE history, expressed as one query with a genuine OR so PowerBI can only
// mask the single large cumulative result, not two separately-maskable pieces
// summed afterwards in JS:
//   (DAX_Year <= year - 1)  OR  (DAX_Year = year AND Month IN [Jan..month])
// Confirmed by live testing: totals matched getYearCumulativeTotal exactly at
// year boundaries, and revealed genuine unmasked data mid-year (a Measles ACT
// case in H1 2019 every single-year query had masked to 0). Returns a total
// THROUGH (year, month), not that month's delta.
export async function getMonthCumulativeTotal(capacityUri, token, diseaseName, year, month) {
  const SEL_MEASURE = "{\"Measure\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"Count_Notification_forgraph\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.M_Notification_ForGraph\",\"NativeReferenceName\":\"Count_Notification_forgraph\"}";
  const ORDER_STATE = "{\"Direction\":1,\"Expression\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}}";

  // ComparisonKind 4 = LessThanOrEqual, 0 = Equal (4 confirmed empirically in
  // getYearCumulativeTotal; 0 confirmed here by the year-boundary match test).
  const priorYears = "{\"Comparison\":{\"ComparisonKind\":4,\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DAX_Year\"}},\"Right\":{\"Literal\":{\"Value\":\"" + (year - 1) + "L\"}}}}";
  const thisYearEq = "{\"Comparison\":{\"ComparisonKind\":0,\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DAX_Year\"}},\"Right\":{\"Literal\":{\"Value\":\"" + year + "L\"}}}}";
  const monthValues = MONTH_NAMES.slice(0, month).map(m => "[{\"Literal\":{\"Value\":\"'" + m + "'\"}}]").join(",");
  const monthIn = "{\"In\":{\"Expressions\":[{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Month Name\"}}],\"Values\":[" + monthValues + "]}}";
  const thisYearPartial = "{\"And\":{\"Left\":" + thisYearEq + ",\"Right\":" + monthIn + "}}";
  const cumulativeThroughMonthFilter = "{\"Condition\":{\"Or\":{\"Left\":" + priorYears + ",\"Right\":" + thisYearPartial + "}}}";

  const body = "{\"version\":\"1.0.0\",\"queries\":[{\"Query\":{\"Commands\":[{\"SemanticQueryDataShapeCommand\":{\"Query\":{\"Version\":2,\"From\":[{\"Name\":\"d1\",\"Entity\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT\",\"Type\":0},{\"Name\":\"d\",\"Entity\":\"DELTALOAD_DATAMART LOCATION_DIM\",\"Type\":0},{\"Name\":\"d11\",\"Entity\":\"DELTALOAD_DATAMART DISEASE_DIM\",\"Type\":0},{\"Name\":\"d3\",\"Entity\":\"DELTALOAD_DATAMART CASE_DIM\",\"Type\":0}],\"Select\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"},\"Name\":\"DELTALOAD_DATAMART LOCATION_DIM.STATE\"}," + SEL_MEASURE + "],\"Where\":[{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'AUS'\"}}],[{\"Literal\":{\"Value\":\"'Unknown'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'" + diseaseName + "'\"}}]]}}}," + cumulativeThroughMonthFilter + ",{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE GROUP\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Unknown'\"}}],[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"Age Group\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Hepatitis C (<24 months)'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"CONFIRMATION_STATUS\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Confirmed'\"}}],[{\"Literal\":{\"Value\":\"'Probable'\"}}]]}}}],\"OrderBy\":[" + ORDER_STATE + "]},\"Binding\":{\"Primary\":{\"Groupings\":[{\"Projections\":[0,1]}]},\"DataReduction\":{\"DataVolume\":4,\"Primary\":{\"Window\":{\"Count\":1000}}},\"Version\":1},\"ExecutionMetricsKind\":1}}]},\"QueryId\":\"\",\"ApplicationContext\":{\"DatasetId\":\"3471d96b-c14c-403f-b3a6-016f1deac28e\",\"Sources\":[{\"ReportId\":\"bc027587-5e9e-4920-bf03-a45fd3079f25\",\"VisualId\":\"35d7386fac9435457a0a\"}]}}],\"cancelQueries\":[],\"modelId\":3305775,\"userPreferredLocale\":\"en-GB\",\"allowLongRunningQueries\":true}";

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
      "body": body,
      "method": "POST"
    });

    const data = await response.json();
    if (!data.results) { console.log('Cumulative query failed for ' + diseaseName + ' <=' + year + '-' + month, data); return null; }
    const ds0 = data.results[0].result.data.dsr.DS[0];
    const results = ds0.PH[0].DM0;

    const current = [undefined, undefined];   // [state, measure]
    const cases = {};
    results.forEach(row => {
      const repeatMask = row.R || 0;
      var ci = 0;
      for (var p = 0; p < 2; p++) {
        if (!(repeatMask & (1 << p))) current[p] = row.C[ci++];
      }
      cases[current[0]] = current[1];
    });
    return cases;

  } catch (error) {
    console.log(error);
    return null;
  }
}

export async function getCaseNumbers(capacityUri,token,diseaseName,mode) {

  // The three queries differ only in which period dimensions are projected and
  // how STATE is bound. Assemble the varying pieces per mode:
  //   'all-time' → Select [STATE, Measure];        Primary [0,1], no Secondary
  //   'year'     → Select [STATE, Year, Measure];  Primary [1,2], Secondary [STATE]
  //   'month'    → Select [STATE, Year, Month, M]; Primary [1,2,3], Secondary [STATE]
  const SEL_YEAR = "{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Year\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.Diagnosis Year Drill Down.Diagnosis Year\"}";
  const SEL_MONTH = "{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Month Name\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.Diagnosis Year Drill Down.Diagnosis Month Name\"}";
  const SEL_MEASURE = "{\"Measure\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"Count_Notification_forgraph\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.M_Notification_ForGraph\",\"NativeReferenceName\":\"Count_Notification_forgraph\"}";
  const ORDER_YEAR = "{\"Direction\":1,\"Expression\":{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Year\"}}},";
  const ORDER_STATE = "{\"Direction\":1,\"Expression\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}}";

  // Period selects (between STATE and the measure), primary projections, binding,
  // and order-by, per mode.
  const periodSelect = mode === 'month' ? SEL_YEAR + "," + SEL_MONTH + ","
                     : mode === 'year'  ? SEL_YEAR + ","
                     : "";
  const primaryProjections = mode === 'month' ? "[1,2,3]"
                           : mode === 'year'  ? "[1,2]"
                           : "[0,1]";              // all-time: [STATE, measure]
  const binding = mode === 'all-time'
    ? "{\"Primary\":{\"Groupings\":[{\"Projections\":[0,1]}]},\"DataReduction\":{\"DataVolume\":4,\"Primary\":{\"Window\":{\"Count\":1000}}},\"Version\":1}"
    : "{\"Primary\":{\"Groupings\":[{\"Projections\":" + primaryProjections + "}]},\"Secondary\":{\"Groupings\":[{\"Projections\":[0]}]},\"DataReduction\":{\"DataVolume\":4,\"Primary\":{\"Window\":{\"Count\":1000}},\"Secondary\":{\"Top\":{\"Count\":60}}},\"Version\":1}";
  const orderBy = mode === 'all-time' ? ORDER_STATE : ORDER_YEAR + ORDER_STATE;

  const body = "{\"version\":\"1.0.0\",\"queries\":[{\"Query\":{\"Commands\":[{\"SemanticQueryDataShapeCommand\":{\"Query\":{\"Version\":2,\"From\":[{\"Name\":\"d1\",\"Entity\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT\",\"Type\":0},{\"Name\":\"d\",\"Entity\":\"DELTALOAD_DATAMART LOCATION_DIM\",\"Type\":0},{\"Name\":\"d11\",\"Entity\":\"DELTALOAD_DATAMART DISEASE_DIM\",\"Type\":0},{\"Name\":\"d3\",\"Entity\":\"DELTALOAD_DATAMART CASE_DIM\",\"Type\":0}],\"Select\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"},\"Name\":\"DELTALOAD_DATAMART LOCATION_DIM.STATE\"}," + periodSelect + SEL_MEASURE + "],\"Where\":[{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'AUS'\"}}],[{\"Literal\":{\"Value\":\"'Unknown'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'" + diseaseName + "'\"}}]]}}},{\"Condition\":{\"Comparison\":{\"ComparisonKind\":1,\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DAX_Year\"}},\"Right\":{\"Literal\":{\"Value\":\"1990L\"}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE GROUP\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Unknown'\"}}],[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"Age Group\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Hepatitis C (<24 months)'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"CONFIRMATION_STATUS\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Confirmed'\"}}],[{\"Literal\":{\"Value\":\"'Probable'\"}}]]}}}],\"OrderBy\":[" + orderBy + "]},\"Binding\":" + binding + ",\"ExecutionMetricsKind\":1}}]},\"QueryId\":\"\",\"ApplicationContext\":{\"DatasetId\":\"3471d96b-c14c-403f-b3a6-016f1deac28e\",\"Sources\":[{\"ReportId\":\"bc027587-5e9e-4920-bf03-a45fd3079f25\",\"VisualId\":\"35d7386fac9435457a0a\"}]}}],\"cancelQueries\":[],\"modelId\":3305775,\"userPreferredLocale\":\"en-GB\",\"allowLongRunningQueries\":true}";

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

    var number = 0;

    console.log('Fetching ' + diseaseName + ' (' + mode + ')');

    if (mode === 'all-time') {
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
        cases[current[0]] = current[1];
      });
      return cases;
    }

    // 'year'/'month': STATE is on the secondary axis (the per-row X array); its
    // labels live in SH[0].DM1 under G1 ('year') or G2 ('month').
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

          cases[states[i]] = number;

          i++;
        });

        years[year][month] = cases;
      });
    } else {
      // 'year': single primary dimension (year) — no dictionary/bitmask; the year
      // is stored directly on the row as G0. Only measure sparsity applies.
      results.forEach(row => {
        const year = row.G0;
        const cases = {};

        var i = 0;
        row.X.forEach(col => {
          if (typeof col.M0 !== 'undefined') {
            number = col.M0;
          }
          cases[states[i]] = number;
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
