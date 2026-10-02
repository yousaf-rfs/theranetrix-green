#!/usr/bin/env node
// Local development only. Speaks the Neon serverless HTTP protocol and forwards
// to a plain Postgres server, so `@neondatabase/serverless` works against a
// local database. Never deploy this; production talks to Neon directly.
//
//   node scripts/local-neon-proxy.mjs --init    # write a self-signed localhost cert
//   node scripts/local-neon-proxy.mjs           # run the proxy on https://localhost/sql
//
// See docs/LOCAL-DEV.md.

import {createServer} from 'node:https';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const certDir = join(root, '.local-cert');
const certFile = join(certDir, 'cert.pem');
const keyFile = join(certDir, 'key.pem');

if (process.argv.includes('--init')) {
  mkdirSync(certDir, {recursive: true});
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyFile, '-out', certFile, '-days', '365',
    '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ], {stdio: 'inherit'});
  console.log(`\nCertificate written to ${certDir}`);
  console.log('Start the app with: NODE_EXTRA_CA_CERTS=.local-cert/cert.pem npx next dev');
  process.exit(0);
}

if (!existsSync(certFile) || !existsSync(keyFile)) {
  console.error('No certificate found. Run: node scripts/local-neon-proxy.mjs --init');
  process.exit(1);
}

// Where the real Postgres lives. Defaults match docs/LOCAL-DEV.md.
const pool = new pg.Pool({
  connectionString: process.env.LOCAL_POSTGRES_URL
    ?? 'postgres://postgres:localdev@127.0.0.1:5432/theranetrix',
  max: 5,
});

// Neon sets Neon-Raw-Text-Output, so the driver does its own type parsing.
// Hand every column back as text and let it.
const rawText = {getTypeParser: () => (value) => value};

const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (chunk) => {data += chunk;});
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

async function runQuery({query, params}, arrayMode) {
  const result = await pool.query({
    text: query,
    values: params ?? [],
    rowMode: arrayMode ? 'array' : undefined,
    types: rawText,
  });
  return {
    command: result.command,
    rowCount: result.rowCount,
    fields: (result.fields ?? []).map((f) => ({
      name: f.name, dataTypeID: f.dataTypeID, tableID: f.tableID,
      columnID: f.columnID, dataTypeSize: f.dataTypeSize,
      dataTypeModifier: f.dataTypeModifier, format: f.format,
    })),
    rows: result.rows,
    rowAsArray: !!arrayMode,
  };
}

const port = Number(process.env.LOCAL_NEON_PORT ?? 443);

createServer({key: readFileSync(keyFile), cert: readFileSync(certFile)}, async (req, res) => {
  if (req.method !== 'POST' || !req.url.startsWith('/sql')) {
    res.writeHead(404, {'content-type': 'application/json'}).end('{}');
    return;
  }
  const arrayMode = req.headers['neon-array-mode'] === 'true';
  try {
    const parsed = JSON.parse(await readBody(req));
    const payload = Array.isArray(parsed.queries)
      ? {results: await Promise.all(parsed.queries.map((q) => runQuery(q, arrayMode)))}
      : await runQuery(parsed, arrayMode);
    res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(payload));
  } catch (error) {
    res.writeHead(400, {'content-type': 'application/json'})
      .end(JSON.stringify({message: error.message, code: error.code, severity: 'ERROR'}));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Local Neon proxy on https://localhost${port === 443 ? '' : ':' + port}/sql`);
});
