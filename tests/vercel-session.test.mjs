import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {scryptSync} from 'node:crypto';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/vercel-session.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {vercelIdentity,issueSession,sessionCookie,sessionHeader,verifyPassword,sameOrigin}=mod.exports;
process.env.AUTH_SECRET='test-only-signing-key-'.repeat(3);
process.env.WORKSPACE_REQUIRE_PASSWORD='true';
process.env.WORKSPACE_PASSWORD_HASH='test-salt:'+scryptSync('test-password','test-salt',64).toString('hex');
const headers=token=>new Headers({cookie:sessionCookie+'='+token});
test('valid sessions identify only the configured owner and forged platform headers grant no access',async()=>{
 assert.equal(await vercelIdentity(new Headers({'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test','x-vercel-user-id':'owner'})),null);
 const token=issueSession();const user=await vercelIdentity(headers(token));assert.equal(user.primaryKey,'workspace-owner');
 assert.equal(await vercelIdentity(headers(token+'x')),null);
 const parts=token.split('.');const payload=JSON.parse(Buffer.from(parts[0],'base64url').toString());payload.sub='attacker';parts[0]=Buffer.from(JSON.stringify(payload)).toString('base64url');assert.equal(await vercelIdentity(headers(parts.join('.'))),null);
 assert.equal(await vercelIdentity(headers(issueSession(Date.now()-13*60*60*1000))),null);
});
test('password verification, secure cookie flags, origin checks, and key rotation',async()=>{
 assert.equal(verifyPassword('test-password'),true);assert.equal(verifyPassword('incorrect'),false);
 assert.match(sessionHeader('session'),/HttpOnly; Secure; SameSite=Lax; Path=\//);assert.match(sessionHeader(''),/Max-Age=0/);
 assert.equal(sameOrigin(new Request('https://app.test/api/session',{headers:{origin:'https://other.test'}})),false);
 assert.equal(sameOrigin(new Request('https://app.test/api/session',{headers:{origin:'https://app.test'}})),true);
 const token=issueSession();process.env.AUTH_SECRET='rotated-test-key-'.repeat(4);assert.equal(await vercelIdentity(headers(token)),null);
});
