// Creates the local tables, idempotently. Safe to run on every boot: a fresh
// clone, a wiped volume and a warm restart all converge on the same state.
//
//   npm run db:tables

// First, and before anything that reaches src/schema.ts: TABLE_NAME is resolved
// at module-load time and has no default outside this directory. Moving this
// below the imports below breaks `npm run db:tables` with "TABLE_NAME is unset".
import "./env.js";

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clientConfig } from "../src/db.js";
import { tables } from "../src/schema.js";

// 127.0.0.1, never localhost. On Windows localhost resolves to ::1 first and
// the container only listens on IPv4, so the connection is refused with an
// error that says nothing about IPv6.
const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://127.0.0.1:8000";

const client = new DynamoDBClient(clientConfig({ ...process.env, DYNAMODB_ENDPOINT: ENDPOINT }));

async function tableExists(name: string) {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) return false;
    throw error;
  }
}

/**
 * Polls until the container answers. ListTables rather than a bare GET: a plain
 * request to the root returns HTTP 400, which means healthy but reads like a
 * failure, and a readiness probe waiting for a 200 there waits forever.
 */
export async function waitForDynamoDB(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await client.send(new ListTablesCommand({}));
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(
    `DynamoDB Local did not answer at ${ENDPOINT} within ${timeoutMs}ms. ` +
      `Is the container up? npm run db:up. Last error: ${String(lastError)}`,
  );
}

export async function createTables() {
  for (const table of tables) {
    const name = table.TableName!;

    // Idempotent by existence, not by shape. A table already in the volume is
    // left exactly as it was created, so a change to src/schema.ts - a new
    // index, or the stream episode 05 added - does not reach it and nothing
    // says so. The symptom is a local table that behaves like last week's.
    //
    // ./app.sh --stop --wipe drops the volume and rebuilds from the current
    // schema. Said out loud here rather than left to be rediscovered.
    if (await tableExists(name)) {
      console.log(`  = ${name} already exists (shape not checked - --wipe to rebuild)`);
      continue;
    }

    await client.send(new CreateTableCommand(table));
    console.log(`  + ${name} created`);
  }
}

// Only run when invoked directly, so the helpers above can be imported by a
// local server or a test without creating anything as a side effect.
//
// Compared as resolved paths, not as strings. `file://${process.argv[1]}` never
// matches import.meta.url on Windows - argv[1] is a drive path and the URL is
// file:///C:/... - so the string form silently does nothing and no table is
// ever created. It fails by being quiet, which is the worst way to fail.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  console.log(`==> waiting for DynamoDB Local at ${ENDPOINT}`);
  await waitForDynamoDB();
  console.log("==> creating tables");
  await createTables();
  console.log("==> ready");
}
