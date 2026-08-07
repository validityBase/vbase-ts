# Agent Memory

## GitHub Actions
- Third-party GitHub Actions are pinned to full commit SHAs.
- vBase-owned shared actions use reviewed `validityBase/vbase-github-actions` version tags.
- Node dependency setup uses `validityBase/vbase-github-actions/.github/actions/setup-node-deps@v1`.
- CI passes `node-version: "18"` to match `.nvmrc`.
- Documentation publishing uses `validityBase/vbase-github-actions/.github/actions/publish-docs@v1`.
- Repository backup delegates to `validityBase/vbase-github-actions/.github/workflows/repo-backup.yml@v1`;
  details stay in `internal/specs/github-actions.md`.
- Docs build remains local because it runs TypeDoc with `typedoc-plugin-markdown`.
- `test-localhost.yml` requires `GHCR_PAT` to pull the localhost commitment service image.
