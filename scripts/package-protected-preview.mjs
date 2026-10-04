import {cp, mkdir, rm, writeFile} from 'node:fs/promises';

const output = new URL('../.vercel/output/', import.meta.url);
// Only generated deployment output is replaced. Project-link settings are untouched.
await rm(output, {recursive: true, force: true});
const fn = new URL('functions/preview.func/', output);
await mkdir(fn, {recursive: true});
await cp(new URL('../frontend/out/', import.meta.url), new URL('site/', fn), {recursive: true});
await cp(new URL('../preview-access/handler.mjs', import.meta.url), new URL('handler.mjs', fn));
await writeFile(new URL('.vc-config.json', fn), JSON.stringify({runtime: 'nodejs24.x', handler: 'handler.mjs', launcherType: 'Nodejs', maxDuration: 15}, null, 2));
await writeFile(new URL('config.json', output), JSON.stringify({version: 3, routes: [{src: '/(.*)', dest: '/preview'}]}, null, 2));
console.log('Protected preview packaged: every page and asset is served through the password gate.');
