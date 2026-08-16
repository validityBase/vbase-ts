# GitHub Actions

## Policy

- Third-party actions are pinned by full commit SHA for reproducibility.
- Shared vBase-owned actions use `validityBase/vbase-github-actions` with reviewed release tags such as `@v1`.
- Workflows default to `permissions: {}`; each job declares only the permissions
  it requires. GHCR pull/test jobs grant `packages: read`.
- Secrets must come from GitHub Secrets or deployment configuration, never from committed files or logs.

## Workflows

### `.github/workflows/test-localhost.yml`

- Runs on pull requests and pushes to `main` and `dev`.
- Checks out the repository with the pinned `actions/checkout` action.
- Installs Node.js dependencies through `validityBase/vbase-github-actions/.github/actions/setup-node-deps@v1` with Node.js 22.
- Logs in to GHCR with the workflow `GITHUB_TOKEN`, then runs `ghcr.io/validitybase/commitment-service-localhost:latest`.
- Runs `npm run test:spec:localhost`.
- Removes the commitment service container with `if: always()`.

### `.github/workflows/update-main-docs.yml`

- Runs on pushes to `main` and manual dispatch.
- Checks out the repository with the pinned `actions/checkout` action.
- Installs Node.js dependencies through `validityBase/vbase-github-actions/.github/actions/setup-node-deps@v1` with Node.js 22.
- Builds Markdown docs into `_docs` with the repository's `npm run docs:build` script.
- Publishes `_docs` with `validityBase/vbase-github-actions/.github/actions/publish-docs@v1`.
- Publishes to the `main` branch of the central docs repository.
- Uses `DOCS_REPO_ACCESS_TOKEN` for the central docs repository.

### `.github/workflows/repo-backup.yml`
- Runs daily and through manual dispatch to create a full-history git bundle
  backup.
- Delegates to `validityBase/vbase-github-actions/.github/workflows/repo-backup.yml@v1`.
- Uses reviewed moving major tags for validityBase-owned shared workflows so
  centrally reviewed fixes roll forward without per-repository pin updates.
- Requires `VBASE_COMMON_REPO_READ_TOKEN` and
  `VBASE_REPO_BACKUP_SECRETS_TOKEN` GitHub Actions secrets.
- Reads object storage credentials from the `vbase-repo-backups` Bitwarden
  project at runtime; bucket lifecycle and restore-test policy live outside
  this repository.
