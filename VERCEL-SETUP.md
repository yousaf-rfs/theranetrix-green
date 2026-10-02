# TheraNetrix on Vercel

The Vercel build uses native Next.js and the existing Postgres workspace. It opens without a password by default. Everyone with the app URL can read and save the shared records. New actions are attributed to **Shared workspace visitor**, not to a verified owner or clinician.

## Shared workspace setup

1. Connect a dedicated Postgres database for this feedback installation and set `DATABASE_URL`. Use a separate `WORKSPACE_OWNER_KEY` such as `theranetrix-green-feedback` to identify its workspace. Do not copy production records or credentials into this repository.
2. Leave `WORKSPACE_REQUIRE_PASSWORD` unset or set it to `false`. Old `AUTH_SECRET`, `WORKSPACE_PASSWORD_HASH`, owner names, and session cookies do not enable the gate by themselves.
3. Create a new Vercel project from `yousaf-rfs/theranetrix-green`, choose Next.js with Node.js 24, and select `forest-green` as the production branch. No Vercel project is linked by this source checkout. After configuring the database, deploy so the running functions receive `DATABASE_URL`. Do not push to `main`. The home route is `/` and contains only the Forest design, with no variation switcher.

For a new installation only, connect a dedicated Neon database and run `node --env-file=.env.local scripts/prepare-vercel-database.mjs` with its `DATABASE_URL`. The schema setup creates tables without replacing existing records. Deployment does not import the original Sites database.

## Optional password protection

Password protection is explicitly opt-in. Set `WORKSPACE_REQUIRE_PASSWORD=true` alongside `AUTH_SECRET` (at least 32 characters) and `WORKSPACE_PASSWORD_HASH`. Generate credentials with `node scripts/create-workspace-credentials.mjs`, keep the generated password in a password manager, and redeploy. This restores signed, secure, HTTP-only sessions and database-backed login rate limiting. `WORKSPACE_OWNER_NAME` is the shared account display name; this is not individual clinician authentication.

The legacy `scripts/TheraNetrix-Finish-Setup.mjs` helper now requires `--require-password` before doing account setup or rotating credentials. Use `--plan` to inspect its password-protected setup steps. Do not run it to remove the gate.

## Verification

- `npm run build` and `npx tsc --noEmit`: production build and type checks.
- `node --test tests/*.test.mjs`: logic, API, access and rendering checks.
- In shared mode, a new browser can read `/api/workspace` without cookies and receives `accessMode: "shared"`. Saves survive reload and retain the existing workspace key. Stale writes return 409 and cross-origin writes return 403.
- The workspace and account view omit sign-out controls in shared mode. The protected mode tests continue to cover invalid and expired sessions.

Keep `.env*`, credentials, and exported workspace records out of Git and deployment uploads.
