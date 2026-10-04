import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const lifetime = 12 * 60 * 60;
const mime = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.txt':'text/plain; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.ttf':'font/ttf', '.woff2':'font/woff2'};
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const sign = (payload, password) => createHmac('sha256', password).update('theranetrix-preview-v1:' + payload).digest('base64url');

function loginPage(message = '', configured = true) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Private preview | TheraNetrix</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#f4f6f1;color:#243931;font:16px/1.5 system-ui,sans-serif}main{width:100%;max-width:420px;background:white;padding:36px;border:1px solid #e0e7dd;border-radius:22px;box-shadow:0 14px 48px #2439310d}.brand{font-size:23px;font-weight:650;letter-spacing:-.6px;display:flex;align-items:center;gap:10px}.brand svg{background:#e8efdf;border-radius:10px;padding:7px;width:38px;height:38px;color:#24634f}.eyebrow{margin:30px 0 8px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#617067;font-weight:600}h1{font-size:27px;letter-spacing:-.7px;margin:0 0 10px;line-height:1.2}p{color:#617067;margin:0 0 26px;font-size:14px}label{display:block;font-weight:600;font-size:14px;margin-bottom:7px}input{width:100%;border:1px solid #cbd6c8;border-radius:9px;padding:12px;font:inherit;background:#fff;color:#243931}button{width:100%;margin-top:18px;border:0;border-radius:9px;padding:13px;background:#24634f;color:#fff;font:600 15px system-ui;cursor:pointer}button:hover{background:#1b513f}input:focus-visible,button:focus-visible{outline:3px solid #8aaf9d;outline-offset:3px}.message{color:#9d3732;margin:12px 0 0;font-size:14px}small{display:block;margin-top:24px;text-align:center;color:#617067;font-size:12px}
</style></head><body><main><div class="brand"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12h4l3-8 6 16 3-8h4"/></svg>TheraNetrix</div><div class="eyebrow">Design review</div><h1>Welcome to the preview</h1><p>${configured ? 'Enter the shared password to explore the design.' : 'This preview is locked while access is being set up. Please check back shortly.'}</p>${configured ? `<form action="/__preview/login" method="post"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256" ${message ? 'aria-invalid="true" aria-describedby="message"' : ''}>${message ? `<p class="message" id="message" role="alert">${message}</p>` : ''}<button type="submit">View preview</button></form><small>Access is remembered for 12 hours on this browser.</small>` : ''}</main></body></html>`;
}

/** The exported frontend lives inside the function, never in Vercel's public static folder. */
export function createPreviewHandler({root, getPassword = () => process.env.PREVIEW_PASSWORD, now = Date.now, secure = process.env.VERCEL === '1'} = {}) {
  const directory = resolve(root || fileURLToPath(new URL('./site/', import.meta.url)));
  const cookieName = secure ? '__Host-preview_access' : 'preview_access';
  // Best-effort per-instance throttling; a long shared password remains essential.
  const attempts = new Map();
  function cookie(value, age) {
    return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  }
  function authenticated(request, password, host) {
    const value = (request.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!value || value.length > 1024) return false;
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra !== undefined || !equal(sign(payload, password), signature)) return false;
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const seconds = Math.floor(now() / 1000);
      return session.host === host && Number.isInteger(session.exp) && session.exp > seconds && session.exp <= seconds + lifetime;
    } catch { return false; }
  }
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('CDN-Cache-Control', 'no-store');
    response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, {'Content-Type': type});
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    const page = (status, message = '', configured = true) => {
      response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
      send(status, loginPage(message, configured), 'text/html; charset=utf-8');
    };
    const redirect = () => { response.writeHead(303, {Location: '/'}); response.end(); };
    try {
      const host = request.headers.host || '';
      if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return send(400, 'Invalid request.');
      const path = decodeURIComponent(new URL(request.url, 'http://' + host).pathname);
      const password = getPassword();
      if (typeof password !== 'string' || password.length < 12 || password.length > 256) return page(503, '', false);
      if (path === '/__preview/login' || path === '/__preview/logout') {
        if (request.method === 'GET' && path === '/__preview/login') return authenticated(request, password, host) ? redirect() : page(200);
        if (request.method !== 'POST') return send(405, 'Method not allowed.');
        let origin;
        try { origin = new URL(request.headers.origin || ''); } catch { return send(403, 'Invalid request origin.'); }
        if (origin.host !== host || (secure && origin.protocol !== 'https:')) return send(403, 'Invalid request origin.');
        if (path === '/__preview/logout') {
          response.setHeader('Set-Cookie', cookie('', 0));
          return redirect();
        }
        if (!(request.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) return send(415, 'Use the password form.');
        const client = String(request.headers['x-real-ip'] || request.socket?.remoteAddress || 'unknown');
        const stamp = now();
        for (const [key, entry] of attempts) if (entry.until <= stamp) attempts.delete(key);
        const entry = attempts.get(client) || {count: 0, until: stamp + 15 * 60 * 1000};
        if (entry.count >= 10 || (!attempts.has(client) && attempts.size >= 1000)) {
          response.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.until - stamp) / 1000))));
          return page(429, 'Too many attempts. Please try again in 15 minutes.');
        }
        entry.count += 1;
        attempts.set(client, entry);
        let size = 0;
        const chunks = [];
        for await (const chunk of request) {
          size += Buffer.byteLength(chunk);
          if (size <= 4096) chunks.push(Buffer.from(chunk));
        }
        if (size > 4096) return send(413, 'Request too large.');
        const candidate = new URLSearchParams(Buffer.concat(chunks).toString()).get('password') || '';
        if (!equal(candidate, password)) return page(401, 'That password is incorrect. Please try again.');
        attempts.delete(client);
        const payload = Buffer.from(JSON.stringify({host, exp: Math.floor(now() / 1000) + lifetime, nonce: randomBytes(16).toString('hex')})).toString('base64url');
        response.setHeader('Set-Cookie', cookie(payload + '.' + sign(payload, password), lifetime));
        return redirect();
      }
      if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'Method not allowed.');
      if (!authenticated(request, password, host)) {
        return (path === '/' || path === '/design-preview') && !request.headers.rsc ? page(200) : send(401, 'Enter the preview password at the home page.');
      }
      if (path === '/design-preview') return redirect();
      if (path.includes('\\') || path.includes('\0') || path.split('/').some(segment => segment === '..' || segment.startsWith('.'))) return send(404, 'Not found.');
      const base = await realpath(directory);
      const target = resolve(base, '.' + (path.endsWith('/') ? path + 'index.html' : path));
      if (!target.startsWith(base + sep)) return send(404, 'Not found.');
      const real = await realpath(target);
      if (!real.startsWith(base + sep)) return send(404, 'Not found.');
      const body = await readFile(real);
      return send(200, body, mime[extname(real)] || 'application/octet-stream');
    } catch (error) {
      if (error instanceof URIError || ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) return send(404, 'Not found.');
      return send(500, 'The preview could not load. Please try again.');
    }
  };
}

export default createPreviewHandler();
