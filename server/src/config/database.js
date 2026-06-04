const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  host:              env.db.host,
  port:              env.db.port,
  database:          env.db.name,
  user:              env.db.user,
  password:          env.db.password,
  max:               env.db.poolMax,
  idleTimeoutMillis: env.db.idleTimeout,
  connectionTimeoutMillis: env.db.connectTimeout,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
  process.exit(1);
});

// Wrapper: single query
const query = (text, params) => pool.query(text, params);

// Wrapper: checkout a client for multi-statement transactions
const transaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, transaction };
