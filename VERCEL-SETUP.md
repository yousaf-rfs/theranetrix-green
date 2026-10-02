# Forest Green home preview on Vercel

This is a static frontend preview. It does **not** require Postgres, `DATABASE_URL`, authentication settings, or a database migration. Sample patients are bundled at build time.

1. Use the `yousaf-rfs/theranetrix-green` repository and `forest-green` production branch.
2. Keep the project root at the repository root and use Node.js 24.
3. The checked-in Vercel configuration runs `npm run build` and publishes `frontend/out/` as static files.
4. Redeploy the latest `forest-green` commit. Open `/` to review the home screen.

Search, filters, notifications, and quick review work locally in the browser. Other-screen navigation and saves explain that this is a home-screen preview. Feedback is not collected by the site; share it separately.

The legacy application/API source remains untouched and is excluded because the build uses the separate `frontend/app` entry point. The original application repository is unchanged.
