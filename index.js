/*******************************************************************************
  NINDSS notification scraper

  Pulls notifiable-disease notification counts for Australia from the NINDSS
  PowerBI dashboard (https://nindss.health.gov.au/pbi-dashboard/) and writes a
  snapshot to data/<report_date>_notifications*.json. Three modes:
    node index.js         → all-time totals per state (daily, default)
    node index.js year    → per-year breakdown  (_year.json,  on request)
    node index.js month   → per-month breakdown (_month.json, on request)
  Each mode queries at its own granularity rather than summing a finer file:
  the dashboard masks cells <5, so summing accumulates the loss (see
  getCaseNumbers). Coarser files are the least-masked source for their shape.

  There is no public NINDSS API. Instead this reverse-engineers the embedded
  PowerBI report the dashboard renders. The flow is:

    getConfig()          scrape the page → decode the PowerBI embed config
      → getToken()       embed token → short-lived MWCToken + query endpoint
        → getLatestUpdateDate()  when the data was last refreshed
        → getDiseaseList()       every disease name, then per disease:
          → getCaseNumbers()     year/month/state notification counts

  All data queries POST hand-built DAX (SemanticQueryDataShapeCommand) bodies
  to the PowerBI query endpoint. These bodies are opaque strings copied from
  the dashboard's own network traffic — the DatasetId, ReportId, VisualId and
  entity/column names inside them are what break if the dashboard changes.

  Output schema (see README.md):
    { report_date, last_refreshed, data: { <disease>: { <year>: { <month>: {
        <state code | "AUS">: <count> } } } } }
*******************************************************************************/

  // NPM packages that we installed
  import * as cheerio from 'cheerio';
  import fetch from 'node-fetch';
  import fs from 'fs';
  import moment from 'moment';
  import 'moment-timezone';

  // Canonical column order for the flat output rows. States exclude AUS (the
  // per-disease query filters it out); month names map to 1-12 by position.
  const STATE_CODES = ['ACT','NSW','NT','QLD','SA','TAS','VIC','WA'];
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/*******************************************************************************
  getConfig()

  Fetches the dashboard HTML and pulls the base64 `embedconfig` attribute off
  the <div class="powerbi"> element, decoding it to the PowerBI embed config
  (report id + embed token). Returns the parsed config object.
*******************************************************************************/
  async function getConfig() {

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
  async function getToken() {

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
  async function getLatestUpdateDate(capacityUri,token) {

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
    'total' → all-time per-state counts  → { <state>: count }
    'year'  → per-year per-state counts  → { <year>: { <state>: count } }
    'month' → per-year per-month counts  → { <year>: { <month>: { <state>: count } } }

  WHY THREE GRANULARITIES instead of always querying months and summing up:
  the dashboard masks any displayed cell whose count is <5. Masking bites at
  whatever granularity you query, so summing finer cells accumulates the loss —
  a cell that is <5 per month is usually >=5 per year, and a state's all-time
  total is masked only if it is genuinely <5 forever. Each mode is therefore the
  LEAST-masked source for its own shape (measured against COVID-19's true
  national lifetime total): 'total' = 12,302,011, 'year' summed = 12,302,009,
  'month' summed = 12,301,939. Query each level directly rather than deriving a
  coarser file from a finer one.

  TWO RESPONSE LAYOUTS, because PowerBI rejects a secondary axis with no primary
  ("SecondaryGroupsWithoutPrimary"):
    - 'total' has no period dimension, so STATE must go on the PRIMARY axis: each
      DM0 row is one state, C = [state, measure]. There is no secondary axis / X
      array and no SH state list.
    - 'year'/'month' keep STATE on the SECONDARY axis (the X array, one entry per
      state) with the period(s) as the primary rows; the state labels come from
      SH[0].DM1.

  Decoding involves up to two SEPARATE sparse-encoding schemes:

    1. Row sparsity (the DM0 rows, row.R bitmask). Wherever more than one value
       is projected onto a row, row.R flags which projections REPEAT the previous
       row, so only the *changed* ones appear in row.C (consumed left-to-right);
       the rest carry forward. This drives: 'total' rows over [state, measure];
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
async function getCaseNumbers(capacityUri,token,diseaseName,mode) {

  // The three queries differ only in which period dimensions are projected and
  // how STATE is bound. Assemble the varying pieces per mode:
  //   'total' → Select [STATE, Measure];        Primary [0,1], no Secondary
  //   'year'  → Select [STATE, Year, Measure];  Primary [1,2], Secondary [STATE]
  //   'month' → Select [STATE, Year, Month, M]; Primary [1,2,3], Secondary [STATE]
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
                           : "[0,1]";              // total: [STATE, measure]
  const binding = mode === 'total'
    ? "{\"Primary\":{\"Groupings\":[{\"Projections\":[0,1]}]},\"DataReduction\":{\"DataVolume\":4,\"Primary\":{\"Window\":{\"Count\":1000}}},\"Version\":1}"
    : "{\"Primary\":{\"Groupings\":[{\"Projections\":" + primaryProjections + "}]},\"Secondary\":{\"Groupings\":[{\"Projections\":[0]}]},\"DataReduction\":{\"DataVolume\":4,\"Primary\":{\"Window\":{\"Count\":1000}},\"Secondary\":{\"Top\":{\"Count\":60}}},\"Version\":1}";
  const orderBy = mode === 'total' ? ORDER_STATE : ORDER_YEAR + ORDER_STATE;

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

    if (mode === 'total') {
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


/*******************************************************************************
  getDiseaseList(mode)

  Entry point. Fetches the full list of disease names, then queries each one in
  turn (sequentially — the endpoint is rate-sensitive and per-disease payloads
  are small) and writes a flat { columns, rows } snapshot.

  Three output modes, each querying getCaseNumbers at its own granularity and
  writing its own file:
    'total' (default, run daily) → all-time totals per state → one row per disease
             → data/<reportDate>_notifications.json
    'year'  (on request)         → one row per disease + year
             → data/<reportDate>_notifications_year.json
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
async function getDiseaseList(mode) {

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
    
    // Flat, MySQL-friendly shape: a `columns` legend plus one `rows` entry per
    // disease(/year)(/month), with the eight state counts inlined in STATE_CODES
    // order. Consumable in one JSON_TABLE('$.rows[*]' ...) call.
    const output = {
      report_date: reportDate,
      last_refreshed: lastRefreshed,
      columns: mode === 'month' ? ['disease', 'year', 'month', ...STATE_CODES]
             : mode === 'year'  ? ['disease', 'year', ...STATE_CODES]
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
      } else if (mode === 'year') {
        // result[year] = { <state>: count } → one row per year
        for (const [year, cases] of Object.entries(result)) {
          output.rows.push([diseaseName, Number(year), ...STATE_CODES.map(s => cases[s] ?? 0)]);
        }
      } else {
        // total: result = { <state>: count } → a single all-time row per disease
        output.rows.push([diseaseName, ...STATE_CODES.map(s => result[s] ?? 0)]);
      }
    }

    const suffix = mode === 'total' ? '' : '_' + mode;   // total keeps the bare name
    const fname = reportDate + '_notifications' + suffix + '.json';
    fs.writeFileSync('data/'+ fname,JSON.stringify(output));

  } catch (error) {
    console.log(error);
  }
}
  // Run the scraper. The first argument selects the granularity; with no argument
  // it writes the daily all-time-totals file (this is what the daily workflow runs).
  //   node index.js          → data/<date>_notifications.json       (all-time totals)
  //   node index.js year     → data/<date>_notifications_year.json  (per year)
  //   node index.js month    → data/<date>_notifications_month.json (per year+month)
  const arg = process.argv[2];
  const mode = (arg === 'year' || arg === 'month') ? arg : 'total';
  getDiseaseList(mode);
