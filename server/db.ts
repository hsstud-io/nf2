import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://nfe_user:nfe_pass@localhost:5432/nfe_db',
});

pool.on('error', (err) => {
  console.error('Postgres pool error:', err);
});
