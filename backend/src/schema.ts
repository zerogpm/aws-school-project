import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb";
import { requireEnv } from "./env.js";

// The single source of truth for local table shape.
//
// This is a hand-written mirror of the Terraform in modules/booking. Nothing
// keeps them in sync automatically, so changing one without the other is the
// failure mode to watch for: local passes, deployed breaks. Change both in the
// same commit.
//
// Single-table design, so one table holds bookings, interview windows, the
// published timetable and staff profiles, distinguished by key prefix:
//
//   PK                      SK                      what it is
//   WINDOW#<id>             META                    an interview window
//   WINDOW#<id>             SLOT#<iso>              a bookable slot
//   BOOKING#<id>            META                    a parent's booking
//   STUDENT#<number>        BOOKING#<id>            that student's bookings
//
// GSI1 answers "everything for this teacher, newest first", which no primary
// key layout can serve without duplicating the item.

// No default. A deployed Lambda that never received TABLE_NAME would otherwise
// address a table called "local-school" in real AWS and fail with a
// ResourceNotFoundException naming a table nobody meant to create. The local
// default lives in local/env.ts, where it is obviously local.
export const TABLE_NAME = requireEnv("TABLE_NAME");

export const tables: CreateTableCommandInput[] = [
  {
    TableName: TABLE_NAME,

    // On-demand, matching the deployed table. Two busy evenings a year and
    // near-dead traffic the rest of it is the case provisioned capacity is
    // worst at.
    BillingMode: "PAY_PER_REQUEST",

    // Only key attributes are declared. DynamoDB is schemaless for everything
    // else, and declaring an attribute that no key or index uses is rejected.
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
      { AttributeName: "GSI1PK", AttributeType: "S" },
      { AttributeName: "GSI1SK", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],

    GlobalSecondaryIndexes: [
      {
        IndexName: "GSI1",
        KeySchema: [
          { AttributeName: "GSI1PK", KeyType: "HASH" },
          { AttributeName: "GSI1SK", KeyType: "RANGE" },
        ],
        // Sort keys are strings, including timestamps. An ISO-8601 string sorts
        // correctly lexicographically, and writing a timestamp as {N} against a
        // key declared {S} makes the row silently absent from the index - no
        // error, just an empty query.
        Projection: { ProjectionType: "ALL" },
      },
    ],
  },
];
