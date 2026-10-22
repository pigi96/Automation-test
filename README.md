# Coinpulse

Public crypto market dashboard, news and social radar, and experimental price projections.

[Live website](https://coinpulse-social-radar.janlovsin.chatgpt.site/)

## Features
- Top 100 assets, price history, comparisons, market map.
- News RSS and public social posts with source availability indicators.
- Experimental 1-, 7-, 30-, 90- and 365-day projections with optional uncertainty ranges.
- Browser-local watchlists, portfolio and alerts. No login needed to use the site.

Predictions use heuristic momentum and keyword sentiment. They have no verified predictive edge.

## Develop
Use Node 24 and pnpm 11.25.0.
Run `pnpm install --frozen-lockfile`, then `pnpm dev`.
Run `pnpm test`, `pnpm exec tsc --noEmit` and `pnpm build` before submitting changes.

## Report an issue
Use [GitHub Issues](https://github.com/pigi96/Automation-test/issues/new/choose) to report a bug or propose an improvement. Include the asset, horizon, browser, steps and expected behavior. Do not post credentials or personal portfolio information.

## Publication and automation
GitHub Actions validates pushes and pull requests without an AI service or API key.
Production is hosted by Sites. A GitHub push alone does not deploy it.
Repository: https://github.com/pigi96/Automation-test
Existing Sites project: appgprj_6ad9f29006588191b0be6188564694af.
See [maintenance policy](docs/maintenance.md). Unattended AI maintenance is paused pending an enforceable usage budget.
