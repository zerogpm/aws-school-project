// Boots the local API.
//
//   npm run dev            (or ./app.sh --start --api from the repo root)
//
// Ordering in this file is load-bearing. src/schema.ts resolves TABLE_NAME and
// src/db.ts builds its client at module-load time, so every environment value
// has to be set before the first handler import - and in ESM, imports are
// evaluated before any statement in this file runs. Hence the side-effect
// import below, first and alone. Move it and the server fails with "TABLE_NAME
// is unset", which reads like a Terraform problem and is not one.
import "./env.js";

import { createApp, registrationOrder } from "./app.js";
import { createTables, waitForDynamoDB } from "./create-tables.js";
import { seed } from "./seed.js";

const PORT = Number(process.env.PORT);

// Set only by ./app.sh when it is asked to expose the API beyond loopback.
// Unset means the default bind, which is what you want on a laptop.
const HOST = process.env.HOST;

async function start(): Promise<void> {
  // A retry loop, not a single check: on `docker compose up` the container
  // accepts TCP before it accepts queries, so a naive probe races and the
  // server dies on a cold machine while working perfectly on a warm one.
  console.log("==> waiting for DynamoDB Local");
  await waitForDynamoDB();

  console.log("==> tables");
  await createTables();

  console.log("==> seed");
  await seed();

  const app = createApp();

  const onListen = () => {
    console.log(`==> API on http://127.0.0.1:${PORT}`);

    // Not decoration. This is the fastest way to catch "I wrote the handler and
    // forgot the manifest entry", and it prints in the order Express will
    // actually match, which is the order that differs from API Gateway's.
    for (const route of registrationOrder()) {
      const auth = route.auth === "staff" ? "staff" : "public";
      console.log(`    ${route.method.padEnd(6)} ${route.path.padEnd(24)} ${auth}`);
    }
  };

  if (HOST) {
    app.listen(PORT, HOST, onListen);
  } else {
    app.listen(PORT, onListen);
  }
}

start().catch((error) => {
  console.error("failed to start:", error);
  process.exitCode = 1;
});
