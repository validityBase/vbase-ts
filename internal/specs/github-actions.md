# GitHub Actions

## Policy
- Third-party actions are pinned by full commit SHA for reproducibility.
- Shared vBase-owned actions use `validityBase/vbase-github-actions` with reviewed release tags such as `@v1`.
- Workflow permissions are declared explicitly and kept minimal.
- Secrets must come from GitHub Secrets or deployment configuration, never from committed files or logs.

## Workflows

### `.github/workflows/test-localhost.yml`
- Runs on pull requests and pushes to `main` and `dev`.
- Checks out the repository with the pinned `actions/checkout` action.
- Installs Node.js dependencies through `validityBase/vbase-github-actions/.github/actions/setup-node-deps@v1` with Node.js 18.
- Logs in to GHCR with `GHCR_PAT`, then runs `ghcr.io/validitybase/commitment-service-localhost:latest`.
- Runs `npm run test:spec:localhost`.
- Removes the commitment service container with `if: always()`.

### `.github/workflows/update-main-docs.yml`
- Runs on pushes to `main` and manual dispatch.
- Checks out the repository with the pinned `actions/checkout` action.
- Installs Node.js dependencies through `validityBase/vbase-github-actions/.github/actions/setup-node-deps@v1` with Node.js 18.
- Builds Markdown docs into `_docs` with the repository's `npm run docs:build` script.
- Publishes `_docs` with `validityBase/vbase-github-actions/.github/actions/publish-docs@v1`.
- Publishes to the `main` branch of the central docs repository.
- Uses `DOCS_REPO_ACCESS_TOKEN` for the central docs repository.
