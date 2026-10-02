import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';

const root = new URL('../frontend/', import.meta.url);
const html = await readFile(new URL('out/index.html', root), 'utf8');
const routes = JSON.parse(await readFile(new URL('.next/server/app-paths-manifest.json', root), 'utf8'));
assert.deepEqual(Object.keys(routes).sort(), ['/_global-error/page', '/_not-found/page', '/page']);
assert.equal((html.match(/class="triage-patient"/g) || []).length, 11, 'All sample patients must render without an API');
assert.match(html, /Emma Carter/);
assert.match(html, /Care overview/);
assert.doesNotMatch(html, /Workspace unavailable|feedback-pin\/loader\.js/);
for (const asset of ['favicon.svg', 'design-preview/care-conversation.png', 'fonts/plex-preview/regular.ttf', 'fonts/plex-preview/semibold.ttf']) {
  assert.ok((await stat(new URL('out/' + asset, root))).size > 0, `Missing design asset: ${asset}`);
}
console.log('Static home verified: 11 patients, design assets included, no backend routes or feedback loader.');
