// Reference data for local development.
//
// Written only when absent, never overwritten and never deleted first. A
// delete-then-insert seed makes every restart destroy whatever you were in the
// middle of, which is a bad trade for the one thing it buys - and a plain Put
// would silently revert an edit you made to a seeded window while testing.
//
// Two interview evenings, matching the copy already in site/src/data.ts.
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { TABLE_NAME, docClient } from "../src/db.js";

const windows = [
  {
    id: "autumn-2026",
    label: "Autumn parent-teacher interviews",
    opensAt: "2026-10-14T17:00:00Z",
    closesAt: "2026-10-14T20:00:00Z",
    published: true,
  },
  {
    id: "spring-2027",
    label: "Spring parent-teacher interviews",
    opensAt: "2027-03-10T17:00:00Z",
    closesAt: "2027-03-10T20:00:00Z",
    published: false,
  },
];

export async function seed(): Promise<void> {
  for (const window of windows) {
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `WINDOW#${window.id}`,
            SK: "META",

            // The index that answers "every window", which no primary key
            // layout can do without a scan. GSI1SK is the opening time as an
            // ISO-8601 string: it sorts correctly lexicographically, and
            // written as a number the row would be absent from the index with
            // no error to say so.
            GSI1PK: "WINDOWS",
            GSI1SK: window.opensAt,

            label: window.label,
            opensAt: window.opensAt,
            closesAt: window.closesAt,
            published: window.published,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        }),
      );
      console.log(`  + ${window.id} seeded`);
    } catch (error) {
      // The item is already there, which is the normal case on every restart
      // after the first. Anything else is a real failure and should surface.
      if (error instanceof ConditionalCheckFailedException) {
        console.log(`  = ${window.id} already present`);
        continue;
      }
      throw error;
    }
  }
}
