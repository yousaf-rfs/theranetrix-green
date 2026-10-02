import {readFile} from 'node:fs/promises';
import {neon} from '@neondatabase/serverless';
if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL before preparing the database.');
const sql=neon(process.env.DATABASE_URL);
const migration=await readFile(new URL('../migrations/vercel/001-workspaces.sql',import.meta.url),'utf8');
for(const statement of migration.split(';').filter(s=>s.trim()))await sql.query(statement,[]);
console.log('TheraNetrix database schema is ready.');
