/*******************************************************************************
  Refresh guard — prints the dashboard's current last_refreshed, and compares it
  against what the local data files already hold.

    node refresh-check.js          → prints the live timestamp
    node refresh-check.js --stale  → exit 0 if a scrape is worth running,
                                     exit 1 if the local data is already current

  The scheduled workflow runs 4 times a day but the dashboard refreshes about
  once, so 3 of those runs have nothing to do. The check costs 2 requests
  against the ~333 a full rebuild of all four files takes.
*******************************************************************************/

  import fs from 'fs';
  import { getToken, getLatestUpdateDate } from './powerbi.js';

  // Every mode writes one flat file in data/. The OLDEST timestamp across them
  // gates the run: if any is behind the source, there is work to do. A missing
  // file or a missing stamp reads as null, which forces the scrape — the guard
  // fails OPEN, so a bug in it cannot silently stop the cron.
  const DATA_FILES = [
    'data/notifications_all_time.json',
    'data/notifications_by_day_diagnostic.json',
    'data/notifications_by_month.json',
    'data/notifications_by_year.json'
  ];

  function storedRefresh() {
    let oldest = null;
    for (const file of DATA_FILES) {
      if (!fs.existsSync(file)) return null;
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Array documents (day/month/year) carry the stamp on each element; the
      // all-time file carries it at the top.
      const stamp = Array.isArray(doc) ? doc[doc.length - 1]?.last_refreshed : doc.last_refreshed;
      if (!stamp) return null;
      if (oldest === null || stamp < oldest) oldest = stamp;
    }
    return oldest;
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
