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

## Backend (`backend/`)

Three layers, all in `npm test` (vitest, from `backend/`). A handler change
needs all three — see `.claude/rules/handlers.md`.

- **Handlers:** pure functions. Build the event with `src/handlers/test-event.ts`
  and assert on the returned object — no HTTP, no server, no transport mocking.
  Cover the shapes API Gateway really sends: absent body, absent
  `pathParameters`, missing claims.
- **Wrapper:** supertest against `createApp()` from `local/app.ts` — param
  mapping, status and header copying, route ordering, and that a public route
  reaches its handler with no authorizer. This only works because `createApp()`
  has no side effects; keep it that way.
- **Parity with the IaC:** `src/routes.parity.test.ts`. Terraform has no
  `Template.fromStack`, so this reads `modules/booking/*.tf` and asserts what a
  CDK assertion test would — every declared env var has a value, every route
  exists, the authorizer is on staff routes and absent from public ones, log
  groups have retention, `routes.json` is current.

**E2E:** `site/e2e/api.spec.ts`, real HTTP against the real wrapper and the real
container. Needs `./app.sh --start --api`; it skips when the API is not
answering, so a checkout without Docker still goes green.

A test that cannot fail is decoration. When adding a parity or env-var
assertion, break the thing it guards once and confirm it goes red.

## Terraform

No test framework. The bar for a change is `terraform fmt -check -recursive`,
`terraform validate`, and a `terraform plan` that has actually been read.
