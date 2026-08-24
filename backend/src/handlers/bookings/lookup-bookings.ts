// Everything this family has booked for one evening.
//
// The problem it solves: a family books three teachers and gets three
// references. A week later they hold whichever confirmation they did not delete
// and want to change one of them - but there is nothing to choose from, because
// a reference addresses exactly one booking and nothing lists the rest.
//
// The obvious fix is a public lookup by student number. It is also a leak: the
// number is printed on every report card, the format is S plus five digits, and
// anyone who guesses one could see which teachers that child's parents are
// meeting and when. So the key here is not the student number alone.
//
// Instead: one reference *plus* the student number. Holding a valid reference
// already proves this caller made a booking for this family - it is an
// unguessable v4 uuid that was only ever shown to them - so showing them the
// rest of that family's evening reveals nothing they did not already have. A
// stranger guessing a student number still gets nothing, because they cannot
// produce a reference to go with it.
//
// POST rather than GET, because the reference is a credential and does not
// belong in a URL, a browser history or an access log.
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, docClient } from "../../db.js";
import { BOOKING_META_SK, bookingPk, windowPk } from "../../booking/keys.js";
import { parseSlotSk, SLOT_PREFIX } from "../../booking/slots.js";
import { isValidStudentNumber, normaliseStudentNumber } from "../../booking/student-number.js";
import { isUuidV4 } from "../../validate.js";
import type { ApiEvent, ApiResult } from "../http.js";
import { badRequest, forbidden, notFound, ok, parseBody, serverError } from "../http.js";

type LookupRequest = {
  bookingRef?: unknown;
  studentNumber?: unknown;
};

export type FamilyBooking = {
  bookingRef: string;
  slotId: string;
  teacherName: string;
  startsAt: string;
};

export const handler = async (event: ApiEvent): Promise<ApiResult> => {
  try {
    const body = parseBody<LookupRequest>(event);
    if (!body) return badRequest(event, "A JSON body is required");

    const ref = typeof body.bookingRef === "string" ? body.bookingRef.trim() : "";
    const studentNumber =
      typeof body.studentNumber === "string" ? body.studentNumber.trim() : "";

    // Shape-checked before the table is touched, so a stranger poking at this
    // route costs a validation branch rather than a read.
    if (!isUuidV4(ref)) return badRequest(event, "That does not look like a booking reference");
    if (!isValidStudentNumber(studentNumber)) {
      return badRequest(event, "Enter a student number in the format S00481");
    }

    const student = normaliseStudentNumber(studentNumber);

    const found = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: bookingPk(ref), SK: BOOKING_META_SK },
        ConsistentRead: true,
      }),
    );

    const booking = found.Item;
    if (!booking) return notFound(event, "No booking with that reference");

    // The pair has to match. A reference alone is not enough, which is the
    // whole reason this is safe to answer.
    if (booking.studentNumber !== student) {
      return forbidden(event, "That student number does not match this booking");
    }

    const windowId = String(booking.windowId ?? "");
    if (!windowId) {
      console.error("lookup-bookings: booking is missing its window", { ref });
      return serverError(event);
    }

    // One query over the window's partition, filtering to the slots this family
    // holds. The alternative - a query on the student's partition - would
    // return CLAIM# and TIME# guard items and still need the slot rows for the
    // teacher names, so this is one call instead of two.
    const { Items } = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :slot)",
        // bookedBy is not a key, so this is a filter rather than a condition -
        // it reads the window's slots and returns only this family's. A few
        // dozen small items; the cost is the read, not the filter.
        FilterExpression: "bookedBy = :student",
        ExpressionAttributeValues: {
          ":pk": windowPk(windowId),
          ":slot": SLOT_PREFIX,
          ":student": student,
        },
        ConsistentRead: true,
      }),
    );

    const bookings: FamilyBooking[] = (Items ?? [])
      .map((item) => ({
        bookingRef: String(item.bookingRef ?? ""),
        slotId: String(item.SK ?? ""),
        teacherName: String(item.teacherName ?? ""),
        startsAt: String(item.startsAt ?? parseSlotSk(String(item.SK ?? ""))?.startsAt ?? ""),
      }))
      // A slot whose bookingRef went missing cannot be cancelled from here, and
      // offering it as a button that fails is worse than omitting it.
      .filter((one) => one.bookingRef)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    return ok(event, { windowId, studentNumber: student, bookings });
  } catch (error) {
    console.error("lookup-bookings failed", error);
    return serverError(event);
  }
};
