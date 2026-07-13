/*******************************************************************************
  NINDSS notification scraper

  Pulls monthly notifiable-disease notification counts for Australia from the
  NINDSS PowerBI dashboard (https://nindss.health.gov.au/pbi-dashboard/) and
  writes a daily snapshot to data/<report_date>_notifications.json.

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
  getCaseNumbers()

  Queries per-year, per-month, per-state notification counts for a single
  disease and returns them nested as { <year>: { <month>: { <state>: count } } }.

  Decoding the PowerBI response involves two SEPARATE sparse-encoding schemes
  that are easy to confuse:

    1. Row sparsity (the DM0 rows). Because more than one dimension is
       projected (year + month), dimension values are dictionary-encoded:
       ValueDicts.D0 holds the year strings, D1 the month names, and each row
       stores integer indexes into them via row.C. To save bytes a row omits
       any leading dimension that is unchanged from the previous row; row.R is
       a bitmask flagging which of [year, month] repeat, so only the *changed*
       dimensions are present in row.C (consumed left-to-right). We carry the
       last-seen value forward in `current` to fill the gaps.

    2. Measure sparsity (the row.X array, one entry per state). A state's M0 is
       likewise omitted when it repeats the previous state's value, so `number`
       carries forward — see "check if value exists, otherwise repeat" below.

  NOTE: the state labels live on the secondary axis as G2 (not G1). Projecting
  an extra hierarchy level shifts every later dimension's G-number, so this key
  must move in lock-step with the query's Select list.
*******************************************************************************/
async function getCaseNumbers(capacityUri,token,diseaseName) {

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
      "body": "{\"version\":\"1.0.0\",\"queries\":[{\"Query\":{\"Commands\":[{\"SemanticQueryDataShapeCommand\":{\"Query\":{\"Version\":2,\"From\":[{\"Name\":\"d1\",\"Entity\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT\",\"Type\":0},{\"Name\":\"d\",\"Entity\":\"DELTALOAD_DATAMART LOCATION_DIM\",\"Type\":0},{\"Name\":\"d11\",\"Entity\":\"DELTALOAD_DATAMART DISEASE_DIM\",\"Type\":0},{\"Name\":\"d3\",\"Entity\":\"DELTALOAD_DATAMART CASE_DIM\",\"Type\":0}],\"Select\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"},\"Name\":\"DELTALOAD_DATAMART LOCATION_DIM.STATE\"},{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Year\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.Diagnosis Year Drill Down.Diagnosis Year\"},{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Month Name\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.Diagnosis Year Drill Down.Diagnosis Month Name\"},{\"Measure\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"Count_Notification_forgraph\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.M_Notification_ForGraph\",\"NativeReferenceName\":\"Count_Notification_forgraph\"}],\"Where\":[{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'AUS'\"}}],[{\"Literal\":{\"Value\":\"'Unknown'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'" + diseaseName + "'\"}}]]}}},{\"Condition\":{\"Comparison\":{\"ComparisonKind\":1,\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DAX_Year\"}},\"Right\":{\"Literal\":{\"Value\":\"1990L\"}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE GROUP\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Unknown'\"}}],[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"Age Group\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Hepatitis C (<24 months)'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"CONFIRMATION_STATUS\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Confirmed'\"}}],[{\"Literal\":{\"Value\":\"'Probable'\"}}]]}}}],\"OrderBy\":[{\"Direction\":1,\"Expression\":{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Year\"}}},{\"Direction\":1,\"Expression\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}}]},\"Binding\":{\"Primary\":{\"Groupings\":[{\"Projections\":[1,2,3]}]},\"Secondary\":{\"Groupings\":[{\"Projections\":[0]}]},\"DataReduction\":{\"DataVolume\":4,\"Primary\":{\"Window\":{\"Count\":1000}},\"Secondary\":{\"Top\":{\"Count\":60}}},\"Version\":1},\"ExecutionMetricsKind\":1}}]},\"QueryId\":\"\",\"ApplicationContext\":{\"DatasetId\":\"3471d96b-c14c-403f-b3a6-016f1deac28e\",\"Sources\":[{\"ReportId\":\"bc027587-5e9e-4920-bf03-a45fd3079f25\",\"VisualId\":\"35d7386fac9435457a0a\"}]}}],\"cancelQueries\":[],\"modelId\":3305775,\"userPreferredLocale\":\"en-GB\",\"allowLongRunningQueries\":true}",
      "method": "POST"
    });
    
    // Convert the response into text
    const data = await response.json();
    const ds0 = data.results[0].result.data.dsr.DS[0];
    const states = ds0.SH[0].DM1.map(v => v.G2);
    const results = ds0.PH[0].DM0;

    // Year/Month are dictionary-encoded (ValueDicts.D0/D1); each row only carries the
    // dimensions that changed since the previous row (row.R is a bitmask of which of
    // [year, month] repeat — the rest are consumed off row.C in order).
    const dictionaries = [ds0.ValueDicts.D0, ds0.ValueDicts.D1];
    const current = [undefined, undefined];

    const years = {};
    var number = 0;

    console.log('Fetching ' + diseaseName);

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

    return years;

  } catch (error) {
    console.log(error);
  }
}


/*******************************************************************************
  getDiseaseList()

  Entry point. Fetches the full list of disease names, then queries each one in
  turn (sequentially — the endpoint is rate-sensitive and per-disease payloads
  are small) and writes the assembled snapshot to data/<reportDate>_notifications.json.
*******************************************************************************/
async function getDiseaseList() {

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
    // disease/year/month, with the eight state counts inlined in STATE_CODES
    // order. Consumable in one JSON_TABLE('$.rows[*]' ...) call.
    const output = {
      report_date: reportDate,
      last_refreshed: lastRefreshed,
      columns: ['disease', 'year', 'month', ...STATE_CODES],
      rows: []
    };

    for(const diseaseName of diseases){
      const years = await getCaseNumbers(capacityUri,token,diseaseName);
      if (!years) continue;   // query failed for this disease; skip rather than crash
      for (const [year, months] of Object.entries(years)) {
        for (const [monthName, cases] of Object.entries(months)) {
          const month = MONTH_NAMES.indexOf(monthName) + 1;
          output.rows.push([diseaseName, Number(year), month, ...STATE_CODES.map(s => cases[s] ?? 0)]);
        }
      }
    }

    const fname = reportDate + '_notifications.json';
    fs.writeFileSync('data/'+ fname,JSON.stringify(output));

  } catch (error) {
    console.log(error);
  }
}
  // Run the scraper. Invoked directly by the daily GitHub Actions workflow.
  getDiseaseList();
