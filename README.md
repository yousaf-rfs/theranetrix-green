# TheraNetrix Forest Green

A password-protected home-screen preview with 11 fictional patients. No database or paid Vercel Password Protection add-on is required. Ordinary Vercel hosting/function usage still applies.

Search, filters, notifications, quick review, and presentation dialogs run locally in the browser. Other-screen navigation and saving changes show a preview message. Feedback is shared separately.

## Run locally

Use Node.js 24 and `npm ci`. Put a strong, unique password of 12–256 characters in an ignored `.env.local` file as `PREVIEW_PASSWORD=...`, then run `npm run build` and `npm start`. Open http://127.0.0.1:3032. Without a password, access stays locked.

`npm run dev` is a local design-only workflow without the gate. Use `npm start` to review the actual protected deployment behavior.

## Deployment

The `forest-green` branch builds the frontend, then packages it inside a single Vercel function. Every page, script, image, and rendered data request passes through the password check. There is no public static directory in the deployment output. The clinical APIs and other application routes are excluded.

See [Vercel setup](./VERCEL-SETUP.md). Never push to `main`.

## Verify

`npm run test:preview` checks the production build, exported sample cards/assets, the protected deployment package, login failure/success, cookie security, expiry, rotation, traversal, logout, and basic per-instance throttling.
