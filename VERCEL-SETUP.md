# Forest Green password-protected preview

1. In the Vercel project for this repository, open **Settings → Environment Variables**.
2. Add **`PREVIEW_PASSWORD`** with a strong, unique password of 12–256 characters. Select **Production and Preview**. Use the same value in the two projects if one shared password is preferred. Do not prefix it with `NEXT_PUBLIC_` or add it to Git.
3. Keep the repository root as Root Directory, Node.js 24, and `forest-green` as the production branch.
4. Redeploy the latest commit. The configuration runs `npm run build` and uses Vercel Build Output API from `.vercel/output`. Remove any dashboard Output Directory override for `frontend/out`; those files must not be served publicly. Framework Preset is **Other** (`framework: null`).
5. Check the deployed URL in a private browser window: it should show **Welcome to the preview**, and only the correct password should load the dashboard. Test an image or `index.txt` URL without signing in too; it should be blocked.

No database is needed. The original clinical APIs are not deployed. The small access function only checks the shared password and serves the compiled frontend.

## Password behavior

- Missing or invalid configuration stays locked with HTTP 503. No default password exists.
- The password is read only on the server at runtime, never embedded in the browser bundle or deployment config.
- Successful sign-in sets a signed, host-only, HttpOnly, Secure, SameSite=Lax cookie for 12 hours on Vercel. Local HTTP uses a separate non-Secure development cookie.
- **Lock preview** clears access in that browser. Changing `PREVIEW_PASSWORD` and redeploying invalidates previous cookies on the new deployment.
- Login and logout require a same-origin form submission. Repeated attempts have bounded, best-effort per-instance throttling; this is not a distributed account system. Use a long password.
- Pages and assets use private/no-store cache headers, and the deployment contains no public static files.

## Existing deployment URLs

The new gate protects the new deployment. Previous Vercel deployments remain independent and may still be public at their old URLs. Remove those older unprotected deployments or restrict their access in Vercel separately after confirming the new protected deployment works. Changing an environment variable does not update old deployments automatically.
