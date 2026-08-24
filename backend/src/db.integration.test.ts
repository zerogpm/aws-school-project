import { describe, expect, it } from "vitest";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { clientConfig } from "./db.js";
import { TABLE_NAME } from "./schema.js";

// Against the real container, so this is skipped rather than failed when it is
// not running - a clean checkout without Docker should still get a green suite.
//
//   ./app.sh --start
const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://127.0.0.1:8000";
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient(clientConfig({ ...process.env, DYNAMODB_ENDPOINT: ENDPOINT })),
);

// Probed at module scope, not in beforeAll. describe.skipIf and it.runIf are
// evaluated while tests are being collected, which happens before any hook has
// run - deciding from a hook leaves the flag false and silently skips
// everything it was meant to gate.
const reachable = await (async () => {
  try {
    const { TableNames } = await client.send(new ListTablesCommand({}));
    return (TableNames ?? []).includes(TABLE_NAME);
  } catch {
    return false;
  }
})();

if (!reachable) {
  console.warn(
    `[skipped] no ${TABLE_NAME} at ${ENDPOINT} - run ./app.sh --start to include these`,
  );
}

describe.skipIf(!reachable)("DynamoDB Local round trip", () => {
  // Unique per run, because -sharedDb means one database for every client and
  // a fixed key would have concurrent runs overwriting each other.
  const suffix = Date.now().toString(36);
  const pk = `WINDOW#test-${suffix}`;

  it("writes an item and reads it back", async () => {
    await client.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: pk, SK: "META", label: "Autumn interviews", capacity: 12 },
      }),
    );

    const { Item } = await client.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK: pk, SK: "META" } }),
    );

    expect(Item).toMatchObject({ label: "Autumn interviews", capacity: 12 });
  });

  it("finds an item through GSI1 when the key types match", async () => {
    await client.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `BOOKING#${suffix}`,
          SK: "META",
          GSI1PK: `TEACHER#hart-${suffix}`,
          // ISO-8601 string, not a number. The index declares GSI1SK as {S};
          // writing it as a number makes the row silently absent from the
          // index - no error, just an empty result.
          GSI1SK: "2026-11-19T18:20:00Z",
        },
      }),
    );

    const { Items } = await client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `TEACHER#hart-${suffix}` },
      }),
    );

    expect(Items).toHaveLength(1);
    expect(Items?.[0].PK).toBe(`BOOKING#${suffix}`);
  });

  it("returns nothing from GSI1 for an item that never set the index keys", async () => {
    // A sparse index: an item without GSI1PK is simply not in it. This is a
    // feature, and also the reason a typo'd index attribute looks like data
    // loss rather than a mistake.
    const { Items } = await client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": pk },
      }),
    );

    expect(Items).toHaveLength(0);
  });
});
