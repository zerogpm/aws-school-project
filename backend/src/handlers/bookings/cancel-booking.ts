// A parent gives a slot back.
//
// "Cancellations free the slot immediately for the next family" is promised on
// the interviews page, and it is the reason this is public rather than an
// errand for the office on the one evening they have none to spare.
//
// Authorisation without accounts: the booking reference is a v4 uuid, so it is
// not guessable, and it is only ever sent to the parent who made the booking.
// It is a capability - holding it is the permission. The student number is
// required alongside it as a second factor, so a reference that leaks in a
// forwarded email is not on its own enough to cancel someone's interview.
//
// The write is the booking transaction in reverse, and conditional for the same
// reason: two cancellations of the same booking, or a cancellation racing the
// office editing the window, must not leave a slot half-freed.
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { TABLE_NAME, docClient } from "../../db.js";
import {
  BOOKING_META_SK,
  bookingPk,
  claimSk,
  studentPk,
  timeSk,
  windowPk,
} from "../../booking/keys.js";
import { isValidStudentNumber, normaliseStudentNumber } from "../../booking/student-number.js";
import type { ApiEvent, ApiResult } from "../http.js";
import { badRequest, forbidden, notFound, ok, parseBody, serverError } from "../http.js";

type CancelRequest = {
  studentNumber?: unknown;
};

export const handler = async (event: ApiEvent): Promise<ApiResult> => {
  try {
    const ref = event.pathParameters?.ref;
    if (!ref) return notFound(event, "No such booking");

    const body = parseBody<CancelRequest>(event);
    const studentNumber = typeof body?.studentNumber === "string" ? body.studentNumber.trim() : "";

    if (!isValidStudentNumber(studentNumber)) {
      return badRequest(event, "Enter a student number in the format S00481");
    }

    const booking = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: bookingPk(ref), SK: BOOKING_META_SK },

        // Strongly consistent: a parent cancelling seconds after booking must
        // not be told their own booking does not exist.
        ConsistentRead: true,
      }),
    );

    const item = booking.Item;
    if (!item) return notFound(event, "No such booking");

    // The second factor. 403 rather than 404 because the reference was valid -
    // and distinguishing them is safe here precisely because the reference is
    // the unguessable half.
    if (item.studentNumber !== normaliseStudentNumber(studentNumber)) {
      return forbidden(event, "That student number does not match this booking");
    }

    const windowId = String(item.windowId ?? "");
    const slotId = String(item.slotId ?? "");
    const teacherId = String(item.teacherId ?? "");
    const startsAt = String(item.startsAt ?? "");

    if (!windowId || !slotId || !teacherId || !startsAt) {
      // A booking item that cannot name its slot. Nothing writes one, so this
      // is corruption rather than a case - loud, and not silently swallowed.
      console.error("cancel-booking: booking is missing its slot reference", { ref });
      return serverError(event);
    }

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // Free the slot, but only if it is still this booking holding it. A
          // bare REMOVE would let a stale reference wipe a booking made by the
          // next family after this one already cancelled.
          {
            Update: {
              TableName: TABLE_NAME,
              Key: { PK: windowPk(windowId), SK: slotId },
              ConditionExpression: "bookingRef = :ref",
              UpdateExpression: "REMOVE bookedBy, bookingRef, bookedAt",
              ExpressionAttributeValues: { ":ref": ref },
            },
          },

          // Release the one-per-teacher guard, so the family can rebook with
          // the same teacher at a different time.
          {
            Delete: {
              TableName: TABLE_NAME,
              Key: {
                PK: studentPk(String(item.studentNumber)),
                SK: claimSk(windowId, teacherId),
              },
            },
          },

          // Release the one-per-time guard, so the family can book a different
          // teacher at this hour. Missed here and the slot frees while the
          // family stays blocked from ever using that time again.
          {
            Delete: {
              TableName: TABLE_NAME,
              Key: {
                PK: studentPk(String(item.studentNumber)),
                SK: timeSk(windowId, startsAt),
              },
            },
          },

          // And the booking itself, which is what makes the reference dead.
          {
            Delete: {
              TableName: TABLE_NAME,
              Key: { PK: bookingPk(ref), SK: BOOKING_META_SK },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
        ],
      }),
    );

    // The booking's own Delete above - TransactItems[3] - is what the stream
    // consumer watches, not the slot's REMOVE.
    //
    // That was the original guess and it was wrong. The slot carries a student
    // number and no address, so mailing from it would mean a second read to
    // find out who to tell. The booking item carries everything, and both
    // events land on it: INSERT when it is made, REMOVE when it is cancelled.
    // Its old image is where parentEmail survives, which is why the table is
    // NEW_AND_OLD_IMAGES. See backend/src/consumers/booking-email.ts.
    return ok(event, { bookingRef: ref, windowId, slotId, cancelled: true });
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      // Both conditions describe the same situation: this booking was already
      // cancelled, or the slot has moved on. Idempotent from the caller's point
      // of view - they wanted it gone, and it is gone.
      console.warn("cancel-booking: already cancelled", error.CancellationReasons);
      return notFound(event, "No such booking");
    }

    console.error("cancel-booking failed", error);
    return serverError(event);
  }
};
