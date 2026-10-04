import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPreviewHandler} from '../preview-access/handler.mjs';

const secret = 'Test-only-long-preview-password';
const host = 'preview.example.test';
async function request(handler, path = '/', {method = 'GET', cookie, body = '', headers = {}} = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, {url: path, method, socket: {remoteAddress: '127.0.0.1'}, headers: {host, ...(cookie ? {cookie} : {}), ...headers}});
  const response = {status: 200, headers: {}, body: ''};
  const res = {
    setHeader: (name, value) => {response.headers[name.toLowerCase()] = value;},
    writeHead: (status, headers = {}) => {response.status = status; for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);},
    end: body => {response.body = body ? Buffer.from(body).toString() : '';},
  };
  await handler(req, res);
  return response;
}
const login = (handler, password = secret, headers = {}) => request(handler, '/__preview/login', {
  method: 'POST', body: new URLSearchParams({password}).toString(),
  headers: {origin: 'https://' + host, 'content-type': 'application/x-www-form-urlencoded', ...headers},
});

test('password gate protects the exported home and its data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'theranetrix-preview-access-'));
  await mkdir(join(root, '_next/static'), {recursive: true});
  await writeFile(join(root, 'index.html'), '<h1>Care overview</h1><p>Emma Carter</p>');
  await writeFile(join(root, 'index.txt'), 'private rendered patient payload');
  await writeFile(join(root, '_next/static/app.js'), 'private bundle');
  let password = secret, stamp = Date.now();
  const handler = createPreviewHandler({root, getPassword: () => password, now: () => stamp, secure: true});
  let session;
  try {
    await t.test('missing or too-short configuration stays locked, including assets', async () => {
      for (const value of [undefined, '', 'short']) {
        password = value;
        for (const path of ['/', '/index.html', '/_next/static/app.js']) {
          const response = await request(handler, path);
          assert.equal(response.status, 503);
          assert.doesNotMatch(response.body, /Emma Carter|private bundle/);
        }
      }
      password = secret;
    });
    await t.test('anonymous requests cannot read HTML, RSC payloads, scripts or rewritten paths', async () => {
      const home = await request(handler);
      assert.equal(home.status, 200);
      assert.match(home.body, /Welcome to the preview/);
      assert.equal(home.headers['referrer-policy'], 'same-origin', 'Browser form POSTs must retain their same-origin Origin header');
      assert.doesNotMatch(home.body, /Emma Carter/);
      for (const path of ['/index.html', '/index.txt', '/_next/static/app.js', '/preview/site/index.html', '/api/workspace', '/?__rsc=1']) {
        const response = await request(handler, path, {headers: {rsc: '1'}});
        assert.equal(response.status, 401);
        assert.doesNotMatch(response.body, /Emma Carter|private rendered|private bundle/);
      }
    });
    await t.test('wrong passwords and cross-site submissions never grant a session', async () => {
      const wrong = await login(handler, 'incorrect');
      assert.equal(wrong.status, 401);
      assert.match(wrong.body, /incorrect/);
      assert.equal(wrong.headers['set-cookie'], undefined);
      assert.equal((await login(handler, secret, {origin: 'https://other.example.test'})).status, 403);
      assert.equal((await login(handler, secret, {origin: ''})).status, 403);
      assert.equal((await request(handler, '/__preview/login', {method: 'POST', body: 'password=' + 'a'.repeat(5000), headers: {origin: 'https://' + host, 'content-type': 'application/x-www-form-urlencoded'}})).status, 413);
    });
    await t.test('correct password issues a secure session and unlocks the home and assets', async () => {
      const response = await login(handler);
      assert.equal(response.status, 303);
      assert.equal(response.headers.location, '/');
      assert.match(response.headers['set-cookie'], /^__Host-preview_access=/);
      assert.match(response.headers['set-cookie'], /HttpOnly; SameSite=Lax; Max-Age=43200; Secure/);
      assert.doesNotMatch(response.headers['set-cookie'], new RegExp(secret));
      session = response.headers['set-cookie'].split(';')[0];
      assert.match((await request(handler, '/', {cookie: session})).body, /Emma Carter/);
      assert.equal((await request(handler, '/_next/static/app.js', {cookie: session})).body, 'private bundle');
      const head = await request(handler, '/', {cookie: session, method: 'HEAD'});
      assert.equal(head.status, 200); assert.equal(head.body, '');
      assert.match(head.headers['cache-control'], /private, no-store/);
      assert.equal(head.headers['vercel-cdn-cache-control'], 'no-store');
    });
    await t.test('tampering, different hosts, expiration, and password rotation revoke access', async () => {
      for (const cookie of [session + 'x', '__Host-preview_access=malformed', session + '.extra']) assert.doesNotMatch((await request(handler, '/', {cookie})).body, /Emma Carter/);
      assert.doesNotMatch((await request(handler, '/', {cookie: session, headers: {host: 'another.example.test'}})).body, /Emma Carter/);
      stamp += 43201 * 1000;
      assert.doesNotMatch((await request(handler, '/', {cookie: session})).body, /Emma Carter/);
      stamp -= 43201 * 1000;
      password = secret + '-rotated';
      assert.doesNotMatch((await request(handler, '/', {cookie: session})).body, /Emma Carter/);
      password = secret;
    });
    await t.test('authenticated requests cannot read files outside the exported frontend', async () => {
      for (const path of ['/%2e%2e%2fhandler.mjs', '/%2eenv', '/%00', '/%GG', '/index.html%5c..%5chandler.mjs']) {
        assert.equal((await request(handler, path, {cookie: session})).status, 404);
      }
    });
    await t.test('lock preview clears the browser session with a same-origin POST', async () => {
      assert.equal((await request(handler, '/__preview/logout', {method: 'GET', cookie: session})).status, 405);
      const response = await request(handler, '/__preview/logout', {method: 'POST', cookie: session, headers: {origin: 'https://' + host}});
      assert.equal(response.status, 303);
      assert.match(response.headers['set-cookie'], /Max-Age=0; Secure/);
      assert.match((await request(handler)).body, /Welcome to the preview/);
    });
    await t.test('repeated guesses are throttled', async () => {
      const limited = createPreviewHandler({root, getPassword: () => secret, now: () => stamp, secure: true});
      for (let i = 0; i < 10; i++) assert.equal((await login(limited, 'wrong')).status, 401);
      const blocked = await login(limited);
      assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers['retry-after']) > 0);
      stamp += 15 * 60 * 1000 + 1;
      assert.equal((await login(limited)).status, 303);
    });
  } finally {await rm(root, {recursive: true, force: true});}
});
