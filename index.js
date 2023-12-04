  
  // NPM packages that we installed
  import * as cheerio from 'cheerio';
  import fetch from 'node-fetch';
  import fs from 'fs';
  import moment from 'moment';
  import 'moment-timezone';

/*******************************************************************************
  getEmbedConfig()
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
      const params = [];
      params.push({
        reportId: reportId,
        token: data.exploration.mwcToken,
        capacityUri: data.exploration.capacityUri
      })
      return params;

    } catch (error) {
      console.log(error);
    }
  }

/*******************************************************************************
  getLatestUpdateDate()
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
      const formattedTime = moment(epoch).tz("GMT").format("YYYYMMDD");
      return formattedTime;
      
    } catch (error) {
      console.log(error);
    }
  }


/*******************************************************************************
  getCaseNumbers()
*******************************************************************************/
async function getCaseNumbers(capacityUri,token,reportDate,diseaseName) {


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
      "body": "{\"version\":\"1.0.0\",\"queries\":[{\"Query\":{\"Commands\":[{\"SemanticQueryDataShapeCommand\":{\"Query\":{\"Version\":2,\"From\":[{\"Name\":\"d1\",\"Entity\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT\",\"Type\":0},{\"Name\":\"d\",\"Entity\":\"DELTALOAD_DATAMART LOCATION_DIM\",\"Type\":0},{\"Name\":\"d11\",\"Entity\":\"DELTALOAD_DATAMART DISEASE_DIM\",\"Type\":0},{\"Name\":\"d3\",\"Entity\":\"DELTALOAD_DATAMART CASE_DIM\",\"Type\":0}],\"Select\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"},\"Name\":\"DELTALOAD_DATAMART LOCATION_DIM.STATE\"},{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Year\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.Diagnosis Year Drill Down.Diagnosis Year\"},{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Quarter\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.Diagnosis Year Drill Down.Diagnosis Quarter\"},{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Month Name\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.Diagnosis Year Drill Down.Diagnosis Month Name\"},{\"Measure\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"Count_Notification_ForGraph\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.M_Notification_ForGraph\"}],\"Where\":[{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'AUS'\"}}],[{\"Literal\":{\"Value\":\"'Unknown'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'" + diseaseName + "'\"}}]]}}},{\"Condition\":{\"Comparison\":{\"ComparisonKind\":1,\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DAX_Year\"}},\"Right\":{\"Literal\":{\"Value\":\"1990L\"}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE GROUP\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Unknown'\"}}],[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"Age Group\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Hepatitis C (<24 months)'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"CONFIRMATION_STATUS\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Confirmed'\"}}],[{\"Literal\":{\"Value\":\"'Probable'\"}}]]}}}],\"OrderBy\":[{\"Direction\":1,\"Expression\":{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Year\"}}},{\"Direction\":1,\"Expression\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}}]},\"Binding\":{\"Primary\":{\"Groupings\":[{\"Projections\":[1,4]}]},\"Secondary\":{\"Groupings\":[{\"Projections\":[0]}]},\"DataReduction\":{\"DataVolume\":4,\"Primary\":{\"Window\":{\"Count\":200}},\"Secondary\":{\"Top\":{\"Count\":60}}},\"Version\":1},\"ExecutionMetricsKind\":1}}]},\"QueryId\":\"\",\"ApplicationContext\":{\"DatasetId\":\"3471d96b-c14c-403f-b3a6-016f1deac28e\",\"Sources\":[{\"ReportId\":\"bc027587-5e9e-4920-bf03-a45fd3079f25\",\"VisualId\":\"35d7386fac9435457a0a\"}]}}],\"cancelQueries\":[],\"modelId\":3305775,\"userPreferredLocale\":\"en-AU\"}",
      "method": "POST"
    });
    
    // Convert the response into text
    const data = await response.json();
    const states = data.results[0].result.data.dsr.DS[0].SH[0].DM1.map(v => v.G1);

    // loop through records
    const records = [];
    const results = data.results[0].result.data.dsr.DS[0].PH[0].DM0;
    
    var number = 0;
    var year;
    
    console.log('Fetching ' + diseaseName);

    // each year
    results.forEach(row => {
      
      // assign year
      year = row.G0;

      // incrementor for each state
      var i = 0;
      row.X.forEach(col => {

        // check if value exists, otherwise repeat
        if (typeof col.M0 !== 'undefined') {
          number = col.M0;
        }

        // create array
        records.push({
          REPORT_DATE: reportDate,
          DISEASE: diseaseName,
          YEAR: year,
          CODE: states[i],
          CASES: number
        });

        i++;
      });
    });

    return records;

  } catch (error) {
    console.log(error);
  }
}


/*******************************************************************************
  getDiseaseList()
*******************************************************************************/
async function getDiseaseList() {
  
  const params = await getToken();
  const capacityUri = params[0].capacityUri;
  const token = params[0].token;
  const reportDate = await getLatestUpdateDate(capacityUri,token);

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
      "body": "{\"version\":\"1.0.0\",\"queries\":[{\"Query\":{\"Commands\":[{\"SemanticQueryDataShapeCommand\":{\"Query\":{\"Version\":2,\"From\":[{\"Name\":\"d\",\"Entity\":\"DELTALOAD_DATAMART DISEASE_DIM\",\"Type\":0},{\"Name\":\"d1\",\"Entity\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT\",\"Type\":0},{\"Name\":\"d2\",\"Entity\":\"DELTALOAD_DATAMART CASE_DIM\",\"Type\":0}],\"Select\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"DISEASE NAME\"},\"Name\":\"DELTALOAD_DATAMART DISEASE_DIM.DISEASE NAME\"}],\"Where\":[{\"Condition\":{\"Comparison\":{\"ComparisonKind\":1,\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DAX_Year\"}},\"Right\":{\"Literal\":{\"Value\":\"1990L\"}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"DISEASE GROUP\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Unknown'\"}}],[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d2\"}},\"Property\":\"Age Group\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Hepatitis C (<24 months)'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d2\"}},\"Property\":\"CONFIRMATION_STATUS\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Confirmed'\"}}],[{\"Literal\":{\"Value\":\"'Probable'\"}}]]}}}]},\"Binding\":{\"Primary\":{\"Groupings\":[{\"Projections\":[0]}]},\"DataReduction\":{\"DataVolume\":3,\"Primary\":{\"Window\":{}}},\"IncludeEmptyGroups\":true,\"Version\":1},\"ExecutionMetricsKind\":1}}]},\"QueryId\":\"\",\"ApplicationContext\":{\"DatasetId\":\"3471d96b-c14c-403f-b3a6-016f1deac28e\",\"Sources\":[{\"ReportId\":\"bc027587-5e9e-4920-bf03-a45fd3079f25\",\"VisualId\":\"fa18ef3590c8cb060361\"}]}}],\"cancelQueries\":[],\"modelId\":3305775,\"userPreferredLocale\":\"en-AU\"}",
      "method": "POST"
    });
    
    // Convert the response into text
    const data = await response.json();
    const diseases = data.results[0].result.data.dsr.DS[0].PH[0].DM0.map(v => v.G0);    
    
    var rows = [];
    for(const diseaseName of diseases){
      rows = rows.concat(await getCaseNumbers(capacityUri,token,reportDate,diseaseName));
    }
    
    const fname = reportDate + '_cases.json';
    fs.writeFileSync('data/'+ fname,JSON.stringify(rows));

  } catch (error) {
    console.log(error);
  }
}
  // getCaseNumbers('COVID-19');
  getDiseaseList();
