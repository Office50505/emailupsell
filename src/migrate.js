import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db.js';

const schemaPath = path.join(process.cwd(), 'db', 'schema.sql');
const sql = await fs.readFile(schemaPath, 'utf8');

try {
  await pool.query(sql);
  console.log('Database schema is ready.');
} finally {
  await pool.end();
}
