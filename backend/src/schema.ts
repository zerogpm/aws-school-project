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
//   PK                      SK                          what it is
//   WINDOW#<id>             META                        an interview window
//   WINDOW#<id>             SLOT#<iso>#<teacher>        a bookable slot
//   STUDENT#<number>        PROFILE                     a student the office loaded
//   STUDENT#<number>        CLAIM#<window>#<teacher>    one-per-teacher guard
//   BOOKING#<ref>           META                        a parent's booking
//
// The keys themselves are built in src/booking/keys.ts, not spelled out at each
// call site - a key assembled two ways does not error, it simply finds nothing.
//
// Two of these are load-bearing in a way their names do not show:
//
// The slot key leads with the timestamp, so one query on WINDOW#<id> returns
// the whole evening already in chronological order. Both the parent's list and
// the office's roster want exactly that, and neither has to sort.
//
// CLAIM# is not data. It exists to be written with attribute_not_exists inside
// the booking transaction, which is what makes "one slot per teacher per
// family" atomic rather than a read followed by a hopeful write.
//
// GSI1 answers "every window", which the primary key cannot without a scan:
// each window's META item carries GSI1PK = "WINDOWS" and GSI1SK = its opening
// time. Slots are deliberately absent from the index - they are only ever read
// through their window's partition, and a sparse GSI costs nothing for the rows
// it does not contain.
//
// Known and accepted: WINDOW#<id> is a low-cardinality partition key, so one
// evening's bookings all land on one partition. That is the textbook hot-key
// anti-pattern. At ~300 bookings across a three-hour evening it is roughly 0.03
// writes a second against a 1000 WCU partition limit, so it is a rounding error
// here - but it is the first thing to revisit if this ever serves a district
// rather than a school.

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

    // Mirrors stream_enabled / stream_view_type in modules/booking/table.tf.
    //
    // NEW_AND_OLD_IMAGES rather than NEW_IMAGE, because a cancellation deletes
    // the BOOKING#<ref>/META item outright - the parent's address survives only
    // in the old image, and under NEW_IMAGE there would be nobody left to mail.
    //
    // DynamoDB Local serves the Streams API, so the table shape is honest here.
    // What it has no equivalent for is the event source mapping that would
    // deliver those records to a function, so nothing locally reads this. See
    // the "What local does not reproduce" table in backend/README.md.
    StreamSpecification: {
      StreamEnabled: true,
      StreamViewType: "NEW_AND_OLD_IMAGES",
    },
  },
];
