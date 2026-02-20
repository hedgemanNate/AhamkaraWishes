This folder contains a small test harness for the `owned-inventory-index` module.

Run locally:

```bash
npm install
npm test
```

The test runs `tests/owned-index-test.js`, which evaluates the browser-oriented module in a simulated Node `global` and validates basic `rolledPerkSet` computation and wishlist matching.

CI:

The repository includes a GitHub Actions workflow at `.github/workflows/ci.yml` which runs `npm install` and `npm test` on pushes and pull requests to `main`/`master`.
