# COMEX vs MCX Pro Terminal

A browser-based commodity arbitrage dashboard served by a small Node.js web server. The server provides the app files and proxies Yahoo Finance quote requests.

## Deploy on Render

The repository includes a Render Blueprint in [`render.yaml`](./render.yaml), so you do not have to enter build, start, or health-check commands manually.

1. Sign in to [Render](https://render.com/) and choose **New +** → **Blueprint**.
2. Connect your GitHub account if asked, then select `rishipokharna241/AI-Investment-hedging`.
3. Review the service settings from `render.yaml` and choose **Apply**.
4. When the deployment finishes, open the public `onrender.com` URL shown on the service page.

### Deploy from GitHub Actions

To have GitHub trigger deployments to your existing Render service:

1. In Render, open your web service and create a **Deploy Hook** from its settings. Copy the hook URL.
2. In GitHub, open **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
3. Name the secret `RENDER_DEPLOY_HOOK_URL`, paste the URL, and save it. Do not commit the URL to the repository.
4. Choose one deployment trigger: use Render's automatic deploys for pushes, or disable automatic deploys in Render and use this GitHub Actions workflow. Using both can deploy twice.
5. To use GitHub Actions, push a commit to `main`, or go to GitHub **Actions** and run **Deploy to Render** manually.

The workflow in [`.github/workflows/deploy-render.yml`](./.github/workflows/deploy-render.yml) triggers Render when `RENDER_DEPLOY_HOOK_URL` is configured. If the secret is missing, push-triggered runs warn and skip the GitHub-triggered deploy; enable Render automatic deploys instead, or add the secret. Manual deployments require the secret. The Blueprint in [`render.yaml`](./render.yaml) specifies how Render builds and runs the service. The health check at `/api/health` confirms that the server is responding.

## Run locally

Requires Node.js 20 or later.

```bash
npm install
npm start
```

Open [http://localhost:8000](http://localhost:8000). To use a different port, set the `PORT` environment variable.

Check JavaScript syntax with:

```bash
npm run check
```

## Data and simulation notes

- COMEX and USD/INR quote requests are proxied through the Node server to Yahoo Finance. Quote availability and update frequency depend on that third-party service.
- MCX prices and related AutoTrader activity are simulated for demonstration; this dashboard does not execute trades or provide exchange-sourced MCX quotes.
- Arbitrage calculations are estimates, not financial advice. Verify prices and assumptions independently before making financial decisions.
- The app uses third-party fonts, icons, and chart libraries from their public CDNs.

## Deployment options

Use a Node.js web service such as Render for the complete app, including the Yahoo Finance proxy. GitHub Pages can serve static files, but cannot run `server.js`; a Pages-only deployment will not provide the quote API.
