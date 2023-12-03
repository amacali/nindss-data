  
  // NPM packages that we installed
  import * as cheerio from 'cheerio';
  import fetch from 'node-fetch';
  import fs from 'fs';
  import moment from 'moment';
  import 'moment-timezone';

  const REPORTID = 'bc027587-5e9e-4920-bf03-a45fd3079f25';
  const GROUPID = '7939b090-7b24-4c18-907e-ec58908cddbd';

/*******************************************************************************
  getEmbedConfig()
*******************************************************************************/
async function getToken() {

  const embedToken = 'H4sIAAAAAAAEAB2Ut660ZgAF3-W2WCJ8REt_Qd4lLxk6clxytvzuvnI_1WjO-efHSu5-TPKfv39O8QMlLUu0MeOniivQyPrVbgZEyPIUPuTLLCaACLJJ2gJNVrvKon2wzibEAn3R3jcAonFeqnA_Ab57RPuRtZyHdLNkstqCU4t1T2o6trcm7ezueRR6do-dyeHJTRf17i5fOxVoQNQvI42p3Dth2hVaqJS2u4GuqTZUUV-U9GWwq-_xWchxFzib4j6ID5samVcLQ41KhNp0FHY7ZUynFxYLwCnY14xBRxk8feDrJtnXziEItZVI5BSOj7OD8AlE8la2LJ_5jorzWUxMw--1HMrgw-2qIJxWSbuuhJnkZYdcs7a214qWfJ-B6FUgaCt7Q0UXDxbOdYOSGCJJwKSj6l23Ms72PBk-dAQFTFXBuvJ2LmJSKlSPTpPnuOmJz8XHjq5UpsWRS_u4XXiJCaT7OncycqaAp23fPGNxw1vaYUhfWcDG23BwvKPqVp7DrX7aGErOdlAjh9mKBtkKqXKEYpsbo5HH_Xh2hHhV5B3xG4TttMksqEhambirHA6q65jm0ArMLPTQalO3954oYKtgN7G85pI4kBoQSqxTsyn8ylaATV8hG5MBqEv0e-H5ZCJNXbkZJsVKz8kqO_DzYjlDcGUnMoI-emFL8Kpzq1oBYqJU1TGjQB486w-6coezjEdzFF3pQ8CQvyeW-F3vuIKlR0HnQFFCfqBgJgqPiGunTl2WDiYc2AOFua4DGSg5QuFjOeyQVb-Ub6CjI4Bx5prm_ta36xGj7gtpchs7SVZOjXRukZ79-fnrh1_uaRvV4v5NX1xVWcHc-lOKqKG3TIINxXTd33f_Fs-HcIuCBOxQ3rOZ5LY63yHzEfySZa7nrl7p6s1Bf6SUgUj9dDzBbcPJ63Pt6x7VByWYqZbve67aIDPuI42GZkin0DX1FDweinvxV4OQUT7LESey08qcHQGfMxQ939YDh0I6Ur8mWLgaK4M2t9tOHYLBmCX2ulzsSiVlyK9hNkVlEWXWh7j42dfAY4oPoNNv7qtT8YamLXVpMm6EMaiR79QWBu_n55aLH3O0EqLpwFWmW6h2IuJPpjLoQdabfa959CutKC6hq_LJrZduSoeFZWW3oBjw6YZoXczd-EHQ5v0D3ygeyGRAQMP2vj_458__mu-pLpa3_2uZeUS_aFGQf1GBapdjYOtQqf6nnKYakm1fil9MutkKbXfVW6vZGatZS084Y58JwdqOyBVIHSnFqIetY9Ms0vNTt0lM6gTM3kxvVYiH9ofVqGrRP5wl8EIzvrOCsO1PjnfuN8SVi6VBR7PvECzSAbcfIRoyNcSXPO3j_m3gMk_RMGdutbF0GL2lzS52bFOEZabI3PxW30kLee1RrowCSfdvJ1xQn20dlt7Ubwu3QyMD7li0rLNoXjwyZeI1AGFZVEXyDCKxmPzt-uZ-DAvvJL02kEMu264-C_7AQE1tjL87d01ujGUkmA0AKyVIy9UBxBJU5l0dLIFPiO-DYdY5auEb2pcnS6Sb-7arlLtF7feus9y_1f4h1vBcnrhj5vNX87__ATC40_TuBQAA.eyJjbHVzdGVyVXJsIjoiaHR0cHM6Ly9XQUJJLUFVU1RSQUxJQS1TT1VUSEVBU1QtcmVkaXJlY3QuYW5hbHlzaXMud2luZG93cy5uZXQiLCJleHAiOjE3MDE2NDk5NzEsImFsbG93QWNjZXNzT3ZlclB1YmxpY0ludGVybmV0Ijp0cnVlfQ==';

  try {
    const response = await fetch(
      "https://wabi-australia-southeast-redirect.analysis.windows.net/explore/reports/" + REPORTID + "/modelsAndExploration?preferReadOnlySession=true&skipQueryData=true", {
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
  async function getLatestUpdateDate() {

    const params = await getToken();

    try {
      const response = await fetch(
        params[0].capacityUri + 'query', {
        "headers": {
          "accept": "application/json, text/plain, */*",
          "accept-language": "en-AU,en-US;q=0.9,en;q=0.8,fr;q=0.7",
          "authorization": "MWCToken " + await params[0].token,
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
async function getCaseNumbers(disease) {
  const params = await getToken();

  try {
    // Fetch data from URL and store the response into a const
    const response = await fetch(
      params[0].capacityUri + 'query', {
      "headers": {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-AU,en-US;q=0.9,en;q=0.8,fr;q=0.7",
        "authorization": "MWCToken " + await params[0].token,
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
      "body": "{\"version\":\"1.0.0\",\"queries\":[{\"Query\":{\"Commands\":[{\"SemanticQueryDataShapeCommand\":{\"Query\":{\"Version\":2,\"From\":[{\"Name\":\"d1\",\"Entity\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT\",\"Type\":0},{\"Name\":\"d\",\"Entity\":\"DELTALOAD_DATAMART LOCATION_DIM\",\"Type\":0},{\"Name\":\"d11\",\"Entity\":\"DELTALOAD_DATAMART DISEASE_DIM\",\"Type\":0},{\"Name\":\"d3\",\"Entity\":\"DELTALOAD_DATAMART CASE_DIM\",\"Type\":0}],\"Select\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"},\"Name\":\"DELTALOAD_DATAMART LOCATION_DIM.STATE\"},{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Year\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.Diagnosis Year Drill Down.Diagnosis Year\"},{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Quarter\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.Diagnosis Year Drill Down.Diagnosis Quarter\"},{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Month Name\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.Diagnosis Year Drill Down.Diagnosis Month Name\"},{\"Measure\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"Count_Notification_ForGraph\"},\"Name\":\"DELTALOAD_DATAMART NOTIFIABLE_EVENT_FACT.M_Notification_ForGraph\"}],\"Where\":[{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'AUS'\"}}],[{\"Literal\":{\"Value\":\"'Unknown'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'" + disease + "'\"}}]]}}},{\"Condition\":{\"Comparison\":{\"ComparisonKind\":1,\"Left\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Property\":\"DAX_Year\"}},\"Right\":{\"Literal\":{\"Value\":\"1990L\"}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE GROUP\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Unknown'\"}}],[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"Age Group\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"null\"}}]]}}}}},{\"Condition\":{\"Not\":{\"Expression\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d11\"}},\"Property\":\"DISEASE NAME\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Hepatitis C (<24 months)'\"}}]]}}}}},{\"Condition\":{\"In\":{\"Expressions\":[{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d3\"}},\"Property\":\"CONFIRMATION_STATUS\"}}],\"Values\":[[{\"Literal\":{\"Value\":\"'Confirmed'\"}}],[{\"Literal\":{\"Value\":\"'Probable'\"}}]]}}}],\"OrderBy\":[{\"Direction\":1,\"Expression\":{\"HierarchyLevel\":{\"Expression\":{\"Hierarchy\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d1\"}},\"Hierarchy\":\"Diagnosis Year Drill Down\"}},\"Level\":\"Diagnosis Year\"}}},{\"Direction\":1,\"Expression\":{\"Column\":{\"Expression\":{\"SourceRef\":{\"Source\":\"d\"}},\"Property\":\"STATE\"}}}]},\"Binding\":{\"Primary\":{\"Groupings\":[{\"Projections\":[1,4]}]},\"Secondary\":{\"Groupings\":[{\"Projections\":[0]}]},\"DataReduction\":{\"DataVolume\":4,\"Primary\":{\"Window\":{\"Count\":200}},\"Secondary\":{\"Top\":{\"Count\":60}}},\"Version\":1},\"ExecutionMetricsKind\":1}}]},\"QueryId\":\"\",\"ApplicationContext\":{\"DatasetId\":\"3471d96b-c14c-403f-b3a6-016f1deac28e\",\"Sources\":[{\"ReportId\":\"bc027587-5e9e-4920-bf03-a45fd3079f25\",\"VisualId\":\"35d7386fac9435457a0a\"}]}}],\"cancelQueries\":[],\"modelId\":3305775,\"userPreferredLocale\":\"en-AU\"}",
      "method": "POST"
    });
    
    // Convert the response into text
    const data = await response.json();
    const states = data.results[0].result.data.dsr.DS[0].SH[0].DM1.map(v => v.G1);

    // loop through records
    const records = [];
    const results = data.results[0].result.data.dsr.DS[0].PH[0].DM0;

    const reportDate = await getLatestUpdateDate();
    var number = 0;
    var year;

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
          DISEASE: disease,
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

  try {
    // Fetch data from URL and store the response into a const
    const response = await fetch(
      params[0].capacityUri + 'query', {
        "headers": {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-AU,en-US;q=0.9,en;q=0.8,fr;q=0.7",
        "authorization": "MWCToken " + await params[0].token,
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
    
    const rows = [];

    for(const diseaseName of diseases){
      console.log('Fetching ' + diseaseName);
      rows.push(...await getCaseNumbers(diseaseName));
    }
    
    const fname = await getLatestUpdateDate() + '_cases.json';
    fs.writeFileSync('data/'+ fname,JSON.stringify(rows));

    // console.log(diseases);
    return diseases;
    
  } catch (error) {
    console.log(error);
  }
}

  getDiseaseList();
