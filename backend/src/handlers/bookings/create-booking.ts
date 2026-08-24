// A parent books an interview slot. The episode's headline.
//
// Public and unauthenticated by design: there are no parent accounts, and the
// student number is the whole gate. API Gateway throttles the route, and the
// three conditions below are what make the write safe rather than the identity
// of the caller.
//
// The problem this solves is two parents clicking the same slot in the same
// moment. Reading the slot and then writing it cannot solve that - however
// small the gap between the two calls, another Lambda fits inside it, and the
// second write silently overwrites the first. A parent is then holding a
// confirmation for a slot somebody else also holds, and nobody finds out until
// the evening itself.
//
// So the read and the write are the same operation: a conditional write, which
// DynamoDB evaluates atomically against the item as it exists at that instant.
// One caller wins, the other is rejected cleanly, and there is no interval in
// between for anything to slip through.
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { TABLE_NAME, docClient } from "../../db.js";
import {
  BOOKING_META_SK,
  STUDENT_PROFILE_SK,
  bookingPk,
  claimSk,
  studentPk,
  timeSk,
  windowPk,
} from "../../booking/keys.js";
import { parseSlotSk } from "../../booking/slots.js";
import { isValidStudentNumber, normaliseStudentNumber } from "../../booking/student-number.js";
import { isEmail } from "../../validate.js";
import type { ApiEvent, ApiResult } from "../http.js";
import { badRequest, conflict, created, notFound, parseBody, serverError } from "../http.js";

type BookingRequest = {
  studentNumber?: unknown;
  windowId?: unknown;
  slotId?: unknown;
  parentName?: unknown;
  parentEmail?: unknown;
};

/**
 * The transaction's items, in order. The order is not cosmetic: DynamoDB
 * returns CancellationReasons as an array positionally parallel to this one,
 * and that positional match is the only way to tell which condition failed.
 */
const STUDENT_EXISTS = 0;
const SLOT_IS_FREE = 1;
const FAMILY_IS_FREE = 2;
const TIME_IS_FREE = 3;
const REF_IS_UNUSED = 4;

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export const handler = async (event: ApiEvent): Promise<ApiResult> => {
  try {
    const body = parseBody<BookingRequest>(event);
    if (!body) return badRequest(event, "A JSON body is required");

    const studentNumber = asString(body.studentNumber);
    const windowId = asString(body.windowId);
    const slotId = asString(body.slotId);
    const parentName = asString(body.parentName);
    const parentEmail = asString(body.parentEmail);

    // Format first, and separately from existence. A malformed number is the
    // caller's typo and costs nothing to reject; whether the student is real
    // is a question only the table can answer, and it is answered inside the
    // transaction rather than by a read before it.
    if (!isValidStudentNumber(studentNumber)) {
      return badRequest(event, "Enter a student number in the format S00481");
    }
    if (!windowId) return badRequest(event, "windowId is required");

    const slot = parseSlotSk(slotId);
    if (!slot) return badRequest(event, "slotId is not a valid slot");

    // Optional, but validated when given. Episode 05 hands this to SES, and an
    // address stored now that bounces then is a confirmation nobody receives
    // for a booking that did happen - the worst shape of failure this system
    // has, because it is silent on both ends.
    if (parentEmail && !isEmail(parentEmail)) {
      return badRequest(event, "That email address does not look right");
    }

    const student = normaliseStudentNumber(studentNumber);
    const ref = randomUUID();
    const now = new Date().toISOString();

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // [0] Is this a real student? A ConditionCheck reads and asserts
          // without writing, so the check happens at the same instant as the
          // claim rather than in a separate call that could go stale.
          {
            ConditionCheck: {
              TableName: TABLE_NAME,
              Key: { PK: studentPk(student), SK: STUDENT_PROFILE_SK },
              ConditionExpression: "attribute_exists(PK)",
            },
          },

          // [1] Claim the slot. attribute_not_exists(bookedBy) is the line the
          // whole episode rests on: two concurrent callers both send this, and
          // DynamoDB applies exactly one.
          {
            Update: {
              TableName: TABLE_NAME,
              Key: { PK: windowPk(windowId), SK: slotId },
              ConditionExpression: "attribute_exists(SK) AND attribute_not_exists(bookedBy)",
              UpdateExpression:
                "SET bookedBy = :student, bookingRef = :ref, bookedAt = :now",
              ExpressionAttributeValues: { ":student": student, ":ref": ref, ":now": now },

              // Without this, a slot that does not exist and a slot somebody
              // else just took are the same ConditionalCheckFailed at the same
              // index, and a parent who followed a stale link is told the time
              // was taken. With it, the cancellation reason carries the item
              // when there was one - so presence alone separates the two.
              ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
          },

          // [2] One slot per teacher per family, as promised on the interviews
          // page. A guard item whose only job is to already exist the second
          // time this family tries the same teacher.
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: studentPk(student),
                SK: claimSk(windowId, slot.teacherId),
                bookingRef: ref,
                createdAt: now,
              },
              ConditionExpression: "attribute_not_exists(SK)",
            },
          },

          // [3] And not already somewhere else at this exact time. Two
          // different teachers at 5:00 is one parent in two rooms - each
          // booking is fine on its own, which is precisely why this needs a
          // guard rather than the caller's attention.
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: studentPk(student),
                SK: timeSk(windowId, slot.startsAt),
                bookingRef: ref,
                createdAt: now,
              },
              ConditionExpression: "attribute_not_exists(SK)",
            },
          },

          // [4] The booking itself, keyed by the reference. Cancellation finds
          // the slot through this. The condition is paranoia about uuid
          // collision and costs nothing.
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: bookingPk(ref),
                SK: BOOKING_META_SK,
                bookingRef: ref,
                windowId,
                slotId,
                teacherId: slot.teacherId,
                startsAt: slot.startsAt,
                studentNumber: student,
                // Optional. removeUndefinedValues in db.ts drops them rather
                // than rejecting the write, so an absent name is simply absent.
                parentName: parentName || undefined,
                parentEmail: parentEmail || undefined,
                createdAt: now,
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      }),
    );

    // 201 with the reference. It is the parent's only way back to this booking
    // - episode 05 puts it in a confirmation email; for now it is the response.
    return created(event, {
      bookingRef: ref,
      windowId,
      slotId,
      startsAt: slot.startsAt,
      teacherId: slot.teacherId,
      studentNumber: student,
    });
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      return explain(event, error);
    }

    console.error("create-booking failed", error);
    return serverError(event);
  }
};

/**
 * Turns a cancelled transaction into the status the caller can act on.
 *
 * Every failure here is a 409 if you do not look at CancellationReasons, and
 * then a parent who mistyped their child's number is told the slot was taken.
 * The array is positional - reasons[n] belongs to TransactItems[n] - and only
 * the failing entries carry Code "ConditionalCheckFailed".
 */
function explain(event: ApiEvent, error: TransactionCanceledException): ApiResult {
  const reasons = error.CancellationReasons ?? [];
  const failed = (index: number) => reasons[index]?.Code === "ConditionalCheckFailed";

  if (failed(STUDENT_EXISTS)) {
    // 404 and not 403: the number is the credential, but saying "no student
    // with that number" is not a leak - the format is on every report card and
    // the route is throttled. Telling a parent their typo is a typo is worth
    // more than the confusion of a generic refusal.
    return notFound(event, "No student with that number");
  }

  if (failed(SLOT_IS_FREE)) {
    // Presence of the old item, not its contents - the document client does
    // not promise to unmarshall this field, so nothing here reads an attribute
    // out of it. No item means the condition failed on attribute_exists(SK):
    // the slot is not there at all.
    return reasons[SLOT_IS_FREE]?.Item
      ? conflict(event, "That time was just taken - please choose another")
      : notFound(event, "No such slot in that window");
  }

  if (failed(FAMILY_IS_FREE)) {
    return conflict(event, "You already have a slot with this teacher");
  }

  if (failed(TIME_IS_FREE)) {
    return conflict(event, "You already have an interview at that time");
  }

  if (failed(REF_IS_UNUSED)) {
    // A uuid4 collision, which will not happen. Logged rather than retried,
    // because a retry loop here would hide the day it means something else.
    console.error("create-booking: booking reference collision", error);
    return serverError(event);
  }

  // Cancelled for a reason that is not one of ours - a throughput limit, or a
  // transaction conflicting with another transaction on the same item.
  console.error("create-booking: transaction cancelled", error.CancellationReasons);
  return conflict(event, "That booking could not be completed - please try again");
}
