# Testing

All changes require both unit tests AND e2e tests. Run the full suite after
changes and confirm it passes before reporting completion. Show actual test
output as proof — never "this should work".

## Front end (`site/`)

- **Unit:** Vitest + React Testing Library, jsdom environment. Files live beside
  the code as `*.test.ts` / `*.test.tsx`. Run with `npm test`.
- **E2E:** Playwright, in `site/e2e/`. Run with `npm run test:e2e`. It builds
  and serves the production bundle first — the SPA fallback and hashed asset
  names do not exist in the dev server, and those are exactly the things worth
  testing.
- Prefer role-based queries (`getByRole`, `getByLabelText`) over test IDs. Watch
  for strict-mode violations when body copy repeats a word used in a control.

## Terraform

No test framework. The bar for a change is `terraform fmt -check -recursive`,
`terraform validate`, and a `terraform plan` that has actually been read.
