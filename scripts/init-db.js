// Optional: run once to create tables + seed data.  npm run db:init
require('../db').init().then(() => { console.log('database ready'); process.exit(0); }, (e) => { console.error(e); process.exit(1); });
