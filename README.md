# TheraNetrix Forest Green

A frontend-only home-screen preview for design feedback. It includes the Forest Green design and 11 fictional patients, with no theme switcher. No database, login, or environment variables are required.

Search, patient filters, notifications, quick review, and presentation dialogs run in the browser. Navigation to other screens and saving changes show a preview message. Records are not saved, and the original feedback service is not loaded. Reviewers should share feedback separately.

## Run locally

Use Node.js 24 and `npm ci`, then `npm run build` and `npm start`. Open http://127.0.0.1:3032. For development, use `npm run dev`.

## Deployment

The `forest-green` branch builds a static site into `frontend/out/`. Only `frontend/app/page.tsx` and `frontend/app/layout.tsx` are included as application entry points. The inherited API and other screen source remains in the repository for reference but is excluded from the deployment. No backend functions are published.

See [Vercel setup](./VERCEL-SETUP.md). Never push to `main`.
