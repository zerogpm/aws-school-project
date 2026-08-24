// Seed a deployed stage's table: students, windows, and the whole slot grid.
//
//   npm run seed:aws -- --table school-school --region ca-central-1
//   npm run seed:aws -- --table school-school --dry-run
//
// The local stack gets all of this from backend/local/seed.ts when app.sh
// starts. A deployed stage got nothing, which meant a fresh apply produced a
// booking page that correctly said "not open yet" and a demo that could not
// start. scripts/seed-students.sh covered students only; windows were supposed
// to come from POST /windows, which needs an office account and a token first -
// too many steps to hit before filming.
//
// This writes with the caller's own credentials rather than through the API, on
// purpose. It is an operator tool, not a feature: the API path is still the one
// staff use and the one under test. Reusing generateSlots is what keeps a
// seeded window identical to one opened through the handler.
import {
  DynamoDBClient,
  ConditionalCheckFailedException,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { generateSlots, type Teacher } from "../src/booking/slots.js";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const TABLE = flag("table");
const REGION = flag("region") ?? "ca-central-1";
const DRY_RUN = args.includes("--dry-run");

if (!TABLE) {
  console.error("usage: npm run seed:aws -- --table <name> [--region <region>] [--dry-run]");
  console.error("  the table name is `terraform output -raw table_name`");
  process.exit(2);
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

// The same four the front end shows and backend/local/seed.ts writes, so a
// deployed demo reads identically to a local one.
const teachers: Teacher[] = [
  { id: "okafor", name: "Ms. Okafor - Mathematics" },
  { id: "levesque", name: "Mr. Levesque - Science" },
  { id: "whitfield", name: "Mrs. Whitfield - English" },
  { id: "arsenault", name: "M. Arsenault - Francais" },
];

// 21:00Z is 5:00 pm America/Toronto in October - daylight time, UTC-4. Writing
// "17:00:00Z" and meaning "5 pm" is the bug that put every slot three hours
// early once the front end started formatting these for real.
const windows = [
  {
    id: "autumn-2026",
    label: "Autumn parent-teacher interviews",
    opensAt: "2026-10-14T21:00:00Z",
    closesAt: "2026-10-15T00:00:00Z",
    published: true,
    slotMinutes: 20,
  },
  {
    id: "spring-2027",
    label: "Spring parent-teacher interviews",
    opensAt: "2027-03-10T21:00:00Z",
    closesAt: "2027-03-11T00:00:00Z",
    // Unpublished, so the deployed site has something for the "not open yet"
    // path to actually be about.
    published: false,
    slotMinutes: 20,
  },
];

const students = [
  { number: "S00481", name: "Amara Okonkwo", grade: 11 },
  { number: "S00482", name: "Daniel Tremblay", grade: 11 },
  { number: "S00483", name: "Priya Raman", grade: 9 },
  { number: "S00484", name: "Noah Fitzgerald", grade: 12 },
];

/**
 * Put unless it is already there.
 *
 * Conditional for the same reason the local seed is: re-running must not revert
 * a booking made while testing, or wipe a window the office edited. On a
 * deployed table that matters more, not less.
 */
async function putIfAbsent(item: Record<string, unknown>): Promise<boolean> {
  if (DRY_RUN) return true;

  try {
    await client.send(
      new PutCommand({
        TableName: TABLE,
        Item: item,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

console.log(`==> ${DRY_RUN ? "[dry run] " : ""}${TABLE} (${REGION})`);

for (const student of students) {
  const wrote = await putIfAbsent({
    PK: `STUDENT#${student.number}`,
    SK: "PROFILE",
    studentNumber: student.number,
    name: student.name,
    grade: student.grade,
  });
  console.log(`  ${wrote ? "+" : "="} ${student.number} ${student.name}`);
}

for (const window of windows) {
  const wrote = await putIfAbsent({
    PK: `WINDOW#${window.id}`,
    SK: "META",
    // The index that answers "every window". An ISO-8601 string, because it
    // sorts lexicographically and a number would be silently absent from the
    // index with no error to say so.
    GSI1PK: "WINDOWS",
    GSI1SK: window.opensAt,
    label: window.label,
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    published: window.published,
    slotMinutes: window.slotMinutes,
  });
  console.log(`  ${wrote ? "+" : "="} ${window.id}${window.published ? "" : " (unpublished)"}`);

  const slots = generateSlots({
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    slotMinutes: window.slotMinutes,
    teachers,
  });

  let added = 0;
  for (const slot of slots) {
    const ok = await putIfAbsent({
      PK: `WINDOW#${window.id}`,
      SK: slot.sk,
      teacherId: slot.teacherId,
      teacherName: slot.teacherName,
      startsAt: slot.startsAt,
      // No bookedBy. Its absence is what "free" means, and what the booking
      // transaction asserts with attribute_not_exists.
    });
    if (ok) added++;
  }

  console.log(`    ${added} of ${slots.length} slots written`);
}

console.log(
  DRY_RUN
    ? "\n[dry run] nothing was written."
    : "\nDone. The interviews page should now list the autumn evening.",
);
