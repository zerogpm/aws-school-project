// Reference data for local development.
//
// Written only when absent, never overwritten and never deleted first. A
// delete-then-insert seed makes every restart destroy whatever you were in the
// middle of, which is a bad trade for the one thing it buys - and a plain Put
// would silently revert an edit you made to a seeded window while testing.
//
// Two interview evenings, matching the copy already in site/src/data.ts, the
// slot grid each one is made of, and the students a parent can book against.
// Without the students every booking would fail its first condition, and the
// only thing the local stack could demonstrate is the rejection.
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { TABLE_NAME, docClient } from "../src/db.js";
import {
  STUDENT_PROFILE_SK,
  WINDOW_META_SK,
  studentPk,
  windowPk,
} from "../src/booking/keys.js";
import { generateSlots, type Teacher } from "../src/booking/slots.js";

// The two names the front end already shows, plus two more so a family can hit
// the one-slot-per-teacher rule without running out of teachers to try.
const teachers: Teacher[] = [
  { id: "okafor", name: "Ms. Okafor - Mathematics" },
  { id: "levesque", name: "Mr. Levesque - Science" },
  { id: "whitfield", name: "Mrs. Whitfield - English" },
  { id: "arsenault", name: "M. Arsenault - Francais" },
];

// Stored as the real instant, in UTC.
//
// The school runs these 5:00-8:00 pm local, and October and March are both in
// daylight time, so 5:00 pm America/Toronto is 21:00Z. Writing "17:00:00Z" here
// and meaning "5 pm" is the bug this comment exists to prevent: the Z is not
// decoration, and a front end that formats in the school's timezone then
// correctly renders it as 1:00 pm - three hours before anybody arrives.
//
// Slot keys are built from these, so getting it wrong renames every item.
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
    // Unpublished on purpose: the public slot list must hide it, and there has
    // to be something for that test to hide.
    published: false,
    slotMinutes: 20,
  },
];

// S00481 is the number printed in the placeholder on the booking form.
//
// Two blocks, because the API suite and the browser suite run in parallel
// against this one database - Playwright parallelises across files - and a
// student shared between them produces a "you already have an interview at that
// time" from the *other* suite's in-flight booking. That failure looks exactly
// like a bug in the code under test, and is not.
//
//   S00481-S00484   site/e2e/api.spec.ts, and anything done by hand
//   S00485-S00488   site/e2e/site.spec.ts, the browser suite
// Every student's parent is the same inbox, on purpose.
//
// This is a demo school. There is no parent contact list and there is not going
// to be one - the point is to show a real message arriving from a real booking,
// and one verified address does that for any student you happen to pick on
// camera. It also keeps the SES sandbox happy: until production access lands,
// SES will only deliver to addresses that have been verified, and this is the
// one that has.
//
// Kept identical in backend/local/seed.ts and backend/scripts/seed-aws.ts - one
// for the container, one for a deployed table. If it drifts you find out
// immediately, because the mail stops arriving.
const DEMO_PARENT_EMAIL = "uptimeunicorn@gmail.com";

const students = [
  { number: "S00481", name: "Amara Okonkwo", grade: 11 },
  { number: "S00482", name: "Daniel Tremblay", grade: 11 },
  { number: "S00483", name: "Priya Raman", grade: 9 },
  { number: "S00484", name: "Noah Fitzgerald", grade: 12 },

  { number: "S00485", name: "Yusuf Demir", grade: 10 },
  { number: "S00486", name: "Claire Beauchamp", grade: 11 },
  { number: "S00487", name: "Mateo Silva", grade: 9 },
  { number: "S00488", name: "Hana Kobayashi", grade: 12 },
];

/**
 * Put unless it is already there.
 *
 * The condition is the whole idempotency story: a restart re-runs this and
 * every item reports "already present" instead of reverting an edit made while
 * testing. Only ConditionalCheckFailedException is swallowed - anything else is
 * a real failure and should surface rather than leaving a half-seeded table.
 */
async function putIfAbsent(item: Record<string, unknown>, describe: string): Promise<boolean> {
  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;

    console.error(`  ! ${describe} failed`);
    throw error;
  }
}

export async function seed(): Promise<void> {
  for (const student of students) {
    const created = await putIfAbsent(
      {
        PK: studentPk(student.number),
        SK: STUDENT_PROFILE_SK,
        studentNumber: student.number,
        name: student.name,
        grade: student.grade,
        parentEmail: DEMO_PARENT_EMAIL,
      },
      `student ${student.number}`,
    );

    console.log(`  ${created ? "+" : "="} ${student.number} ${student.name}`);
  }

  for (const window of windows) {
    const created = await putIfAbsent(
      {
        PK: windowPk(window.id),
        SK: WINDOW_META_SK,

        // The index that answers "every window", which no primary key layout
        // can do without a scan. GSI1SK is the opening time as an ISO-8601
        // string: it sorts correctly lexicographically, and written as a number
        // the row would be absent from the index with no error to say so.
        GSI1PK: "WINDOWS",
        GSI1SK: window.opensAt,

        label: window.label,
        opensAt: window.opensAt,
        closesAt: window.closesAt,
        published: window.published,
        slotMinutes: window.slotMinutes,
      },
      `window ${window.id}`,
    );

    console.log(`  ${created ? "+" : "="} ${window.id} seeded`);

    // The same generator the create-window handler uses, so a seeded window and
    // one opened through the API are the same shape - and a slot key bug shows
    // up locally rather than only against a deployed stage.
    const slots = generateSlots({
      opensAt: window.opensAt,
      closesAt: window.closesAt,
      slotMinutes: window.slotMinutes,
      teachers,
    });

    let added = 0;
    for (const slot of slots) {
      const wrote = await putIfAbsent(
        {
          PK: windowPk(window.id),
          SK: slot.sk,
          teacherId: slot.teacherId,
          teacherName: slot.teacherName,
          startsAt: slot.startsAt,
          // No bookedBy. Its absence is what "free" means, and what the booking
          // transaction asserts with attribute_not_exists.
        },
        `slot ${slot.sk}`,
      );
      if (wrote) added++;
    }

    console.log(`    ${added} of ${slots.length} slots written (${slots.length - added} already there)`);
  }
}
