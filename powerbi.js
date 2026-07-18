/*******************************************************************************
  NINDSS PowerBI client

  Shared DAX query client for the NINDSS PowerBI dashboard
  (https://nindss.health.gov.au/pbi-dashboard/). There is no public NINDSS API;
  this reverse-engineers the embedded PowerBI report the dashboard renders:

    getConfig()          scrape the page → decode the PowerBI embed config
      → getToken()       embed token → short-lived MWCToken + query endpoint
        → getLatestUpdateDate()  when the data was last refreshed
        → getCaseNumbers()       per disease: year/month/state notification counts

  All data queries POST hand-built DAX (SemanticQueryDataShapeCommand) bodies
  to the PowerBI query endpoint. These bodies are opaque strings copied from
  the dashboard's own network traffic — the DatasetId, ReportId, VisualId and
  entity/column names inside them are what break if the dashboard changes.

  Used by both index.js (current schema) and legacy.js (deprecated schema).
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

/*******************************************************************************
  getConfig()

  Fetches the dashboard HTML and pulls the base64 `embedconfig` attribute off
  the <div class="powerbi"> element, decoding it to the PowerBI embed config
  (report id + embed token). Returns the parsed config object.
*******************************************************************************/
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

/*******************************************************************************
  getToken()

  Trades the (longer-lived) embed token for the short-lived MWCToken and the
  `capacityUri` that DAX queries must be POSTed to. Returns
  { reportId, token, capacityUri }.
*******************************************************************************/
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

/*******************************************************************************
  getLatestUpdateDate()

  Reads the DataRefreshAEST table — the same value shown as "Last refreshed on"
  on the dashboard — and returns:
    { reportDate:    "YYYYMMDD" (GMT), used for the filename/grouping key,
      lastRefreshed: full ISO timestamp in Australian Eastern time }
  Both derive from the same epoch; reportDate is just the truncated form.
*******************************************************************************/
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


/*******************************************************************************
  getCaseNumbers(capacityUri, token, diseaseName, mode)

  Queries per-state notification counts for a single disease and returns them
  nested by period. `mode` picks BOTH the query granularity and the return shape:
    'all-time' → all-time per-state counts  → { <state>: count }
    'year'     → per-year per-state counts  → { <year>: { <state>: count } }
    'month'    → per-year per-month counts  → { <year>: { <month>: { <state>: count } } }

  NOTE: 'year' mode's per-state counts here are the GROUPED (possibly masked,
  <5) values — used as-is by legacy.js's daily writeLegacyCases, which must
  stay cheap (one request per disease). index.js's own 'year'-mode file build
  does NOT use this mode; it calls getYearCumulativeTotal() below directly, per
  year per disease, to get unmasked cumulative totals instead — see index.js.

  WHY THREE GRANULARITIES instead of always querying months and summing up:
  the dashboard masks any displayed cell whose count is <5. Masking bites at
  whatever granularity you query, so summing finer cells accumulates the loss —
  a cell that is <5 per month is usually >=5 per year, and a state's all-time
  total is masked only if it is genuinely <5 forever. Each mode is therefore the
  LEAST-masked source for its own shape (measured against COVID-19's true
  national lifetime total): 'all-time' = 12,302,011, 'year' summed = 12,302,009,
  'month' summed = 12,301,939. Query each level directly rather than deriving a
  coarser file from a finer one.

  TWO RESPONSE LAYOUTS, because PowerBI rejects a secondary axis with no primary
  ("SecondaryGroupsWithoutPrimary"):
    - 'all-time' has no period dimension, so STATE must go on the PRIMARY axis: each
      DM0 row is one state, C = [state, measure]. There is no secondary axis / X
      array and no SH state list.
    - 'year'/'month' keep STATE on the SECONDARY axis (the X array, one entry per
      state) with the period(s) as the primary rows; the state labels come from
      SH[0].DM1.

  Decoding involves up to two SEPARATE sparse-encoding schemes:

    1. Row sparsity (the DM0 rows, row.R bitmask). Wherever more than one value
       is projected onto a row, row.R flags which projections REPEAT the previous
       row, so only the *changed* ones appear in row.C (consumed left-to-right);
       the rest carry forward. This drives: 'all-time' rows over [state, measure];
       and 'month' rows over dictionary-encoded [year, month] (ValueDicts.D0/D1).
       'year' projects a single primary dimension, so the year is stored directly
       as row.G0 with no dictionary/bitmask.

    2. Measure sparsity (the row.X array in 'year'/'month'). A state's M0 is
       omitted when it repeats the previous state's value, so `number` carries
       forward — see "check if value exists, otherwise repeat" below.

  NOTE: in 'year'/'month' the STATE secondary-axis key is G<n> where n = number
  of primary dimensions: G1 for 'year' (year only), G2 for 'month' (year+month).
  Projecting an extra hierarchy level shifts every later dimension's G-number, so
  this key must move in lock-step with the Select list.
*******************************************************************************/
/*******************************************************************************
  getYearCumulativeTotal(capacityUri, token, diseaseName, maxYear)

  Per-state notification total for a disease restricted to DAX_Year <= maxYear
  — the same STATE-on-primary-axis shape as 'all-time' (no year grouping), just
  with an extra upper-bound filter. Used by index.js's per-year cache build
  (data/year/<year>_notifications.json, one file per DAX_Year) to get counts
  that are far less likely to be masked (<5) than a single year's grouped
  count would be, since a running total only grows. Confirmed empirically
  against Measles: the grouped 'year'-mode query (see getCaseNumbers above)
  masked ACT/SA/TAS in 2019 and VIC/WA in 2020 to 0, while diffing consecutive
  cumulative totals recovered the true (non-zero) figures.

  Each returned value is a running total THROUGH maxYear, not that year's
  delta — the delta is computed downstream in the database.
*******************************************************************************/
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
