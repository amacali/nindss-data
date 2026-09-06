/*******************************************************************************
  Refresh guard — prints the dashboard's current last_refreshed, and compares it
  against what the newest local file already holds.

    node refresh-check.js          → prints the live timestamp
    node refresh-check.js --stale  → exit 0 if a scrape is worth running,
                                     exit 1 if the local data is already current

  The scheduled workflow runs 4 times a day but the dashboard refreshes about
  once, so 3 of those runs have nothing to do. The check costs 2 requests
  against ~2,000 for a full day rebuild.
*******************************************************************************/

  import fs from 'fs';
  import { getToken, getLatestUpdateDate } from './powerbi.js';

  // Newest last_refreshed across the folders a scheduled run writes. A folder
  // with no files reads as null, which forces the scrape.
  function storedRefresh() {
    const dirs = ['data/all-time', 'data/day', 'data/year', 'data/month'];
    let newest = null;
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) return null;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
      if (!files.length) return null;
      const doc = JSON.parse(fs.readFileSync(dir + '/' + files[files.length - 1], 'utf8'));
      // data/month/ files are an ARRAY of months; the rest are plain objects.
      const stamp = Array.isArray(doc) ? doc[doc.length - 1]?.last_refreshed : doc.last_refreshed;
      if (!stamp) return null;
      if (newest === null || stamp < newest) newest = stamp;   // oldest folder gates the run
    }
    return newest;
  }

  const { capacityUri, token } = await getToken();
  const { lastRefreshed } = await getLatestUpdateDate(capacityUri, token);

  if (!process.argv.includes('--stale')) {
    console.log(lastRefreshed);
    process.exit(0);
  }

  const stored = storedRefresh();
  if (stored === null) {
    console.log('no complete local data — scrape needed');
    process.exit(0);
  }
  if (stored < lastRefreshed) {
    console.log('source refreshed ' + lastRefreshed + ', local holds ' + stored + ' — scrape needed');
    process.exit(0);
  }
  console.log('local already at ' + stored + ' — nothing to do');
  process.exit(1);
