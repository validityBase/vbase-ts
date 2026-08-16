# Agent Memory

- [HH3 migration incompatibilities and fixes](project_hh3_migration.md) — All root causes and fixes for test failures from the HH2→HH3 migration on dev-greg branch

## Module System

- The project is ESM (`"type": "module"` in `package.json`) because Hardhat 3 requires it.
- `tsconfig.json` uses `"module": "NodeNext"` to emit ESM-compatible output; `"commonjs"` would produce unloadable `.js` files under `"type": "module"`.
- All relative imports in `src/` must use explicit `.js` extensions (e.g. `"./txSettings.js"` not `"./txSettings"`) — NodeNext module resolution enforces Node.js ESM rules. Write `.js` even though the source file is `.ts`; tsc resolves it correctly.
- Test files are exempt: `@nomicfoundation/hardhat-mocha` injects `tsx/esm` as a loader, which is extension-agnostic and handles TypeScript natively.
- Under Node 22.18+, `node` can run `.ts` files directly via native type-stripping. That stripping does **not** erase plain `import { SomeType }` from CJS packages. Use `import type { ... }` for type-only symbols (e.g. mockttp interfaces in `test/proxy-stress.ts`), or Node throws `Named export 'X' not found` against CommonJS modules.

## GitHub Actions

- Third-party GitHub Actions are pinned to full commit SHAs.
- vBase-owned shared actions use reviewed `validityBase/vbase-github-actions` version tags.
- Node dependency setup uses `validityBase/vbase-github-actions/.github/actions/setup-node-deps@v1`.
- CI passes `node-version: "22"` to match `.nvmrc`.
- Documentation publishing uses `validityBase/vbase-github-actions/.github/actions/publish-docs@v1`.
- Repository backup delegates to `validityBase/vbase-github-actions/.github/workflows/repo-backup.yml@v1`;
  details stay in `internal/specs/github-actions.md`.
- Docs build remains local because it runs TypeDoc with `typedoc-plugin-markdown`.
- `test-localhost.yml` uses the repository `GITHUB_TOKEN` with `packages: read`
  to pull the localhost commitment service image from GHCR.
