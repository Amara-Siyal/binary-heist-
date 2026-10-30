// Database layer: libSQL (Turso). Same SQL dialect as SQLite.
//  - On Vercel:  set TURSO_DATABASE_URL (libsql://...) and TURSO_AUTH_TOKEN
//  - Locally:    nothing to set, it uses a file (DB_PATH, default ./heist.db)
const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

let url = process.env.TURSO_DATABASE_URL;
if (!url) {
  if (process.env.VERCEL) throw new Error('TURSO_DATABASE_URL is not set (Vercel has no persistent disk).');
  const file = process.env.DB_PATH || path.join(__dirname, 'heist.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  url = 'file:' + file;
}
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const num = (v) => (typeof v === 'bigint' ? Number(v) : v);
const plain = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, num(r[i])])));

// Helpers bound to either the client or an open transaction
function bind(exec) {
  const all = async (sql, args = []) => plain(await exec.execute({ sql, args }));
  return {
    all,
    get: async (sql, args = []) => (await all(sql, args))[0],
    run: async (sql, args = []) => {
      const rs = await exec.execute({ sql, args });
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid == null ? null : Number(rs.lastInsertRowid) };
    },
  };
}

async function transaction(fn) {
  const tx = await client.transaction('write');
  try {
    const result = await fn(bind(tx));
    await tx.commit();
    return result;
  } catch (e) {
    try { await tx.rollback(); } catch { /* ignore */ }
    throw e;
  } finally {
    tx.close();
  }
}

// Create tables + seed default cases/achievements once per server instance (idempotent SQL)
let ready = null;
function init() {
  if (!ready) {
    ready = client
      .executeMultiple(
        fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8') + '\n' +
        fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8')
      )
      .then(async () => { for (const c of ['password_hash TEXT', 'display_name TEXT']) { try { await client.execute('ALTER TABLE players ADD COLUMN ' + c); } catch (e) { /* already exists */ } } })
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}

module.exports = { ...bind(client), transaction, init, client };
