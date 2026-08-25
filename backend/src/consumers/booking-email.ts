// Mails a parent when their interview booking appears, and again when it goes.
//
// Nothing calls this over HTTP. It is the one consumer in backend/src/routes.ts,
// triggered by the table's stream, and it is the exception .claude/rules/
// handlers.md names outright: "a non-HTTP trigger - is a deliberate, commented
// exception, not a quiet one".
//
// Which item to watch was the design decision. cancel-booking.ts used to say the
// slot's REMOVE was the event to watch, and that is the wrong one: the slot
// carries a student number, not an address, so every cancellation would need a
// second read to find out who to tell. The booking item carries everything, and
// both events land on it -
//
//   INSERT  BOOKING#<ref>/META   a booking was made      -> NewImage
//   REMOVE  BOOKING#<ref>/META   a booking was cancelled -> OldImage
//
// which is also why the table is NEW_AND_OLD_IMAGES. Under NEW_IMAGE a REMOVE
// arrives as bare keys and there is nobody left to email.
//
// One booking writes four items - the slot, the CLAIM# guard, the TIME# guard
// and the booking itself - so three of every four records are noise. The event
// source mapping filters them out before they cost an invocation; the guard
// below is the same rule enforced a second time, because a filter is
// configuration and this is the thing that must not send four emails.
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type {
  AttributeValue as StreamAttributeValue,
  DynamoDBBatchResponse,
  DynamoDBRecord,
  DynamoDBStreamEvent,
} from "aws-lambda";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { docClient, TABLE_NAME } from "../db.js";
import { FROM_ADDRESS, SITE_BASE_URL, ses } from "../mail.js";
import { formatSlotTime } from "../booking/format.js";
import {
  BOOKING_META_SK,
  emailPk,
  sentSk,
  STUDENT_PROFILE_SK,
  studentPk,
} from "../booking/keys.js";

const BOOKING_PREFIX = "BOOKING#";

/** Markers are bookkeeping, not records. A fortnight outlives any retry. */
const MARKER_TTL_SECONDS = 14 * 24 * 60 * 60;

type Kind = "confirmation" | "cancellation";

type Booking = {
  bookingRef?: string;
  windowId?: string;
  teacherId?: string;
  startsAt?: string;
  studentNumber?: string;
  parentName?: string;
  parentEmail?: string;
};

/**
 * Stream images are marshalled even though the rest of this codebase uses the
 * document client - the stream is a lower-level view of the table and does not
 * know about it. The two AttributeValue types describe the same wire shape and
 * differ only in which package declares them.
 */
const toItem = (image: Record<string, StreamAttributeValue> | undefined): Booking =>
  image ? (unmarshall(image as Record<string, AttributeValue>) as Booking) : {};

/**
 * The parent's address, which lives on the student rather than the booking.
 *
 * A parent books with a student number and no account, so the office's record is
 * the only address the system reliably has. The booking's own parentEmail wins
 * when a caller supplied one; it is optional, and absent is the common case.
 */
async function recipientFor(booking: Booking): Promise<string | undefined> {
  if (booking.parentEmail) return booking.parentEmail;
  if (!booking.studentNumber) return undefined;

  const { Item } = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: studentPk(booking.studentNumber), SK: STUDENT_PROFILE_SK },

      // A parent who has just booked must not be told about the previous state
      // of their own record, and a stream record can arrive before an eventually
      // consistent read would see the write that caused it.
      ConsistentRead: true,
    }),
  );

  const email = Item?.parentEmail;
  return typeof email === "string" && email ? email : undefined;
}

/**
 * Claims the right to send exactly one message of this kind for this booking.
 *
 * Returns false when someone already has it. This is the whole idempotency
 * story: the stream guarantees at-least-once delivery of a record, and a parent
 * needs exactly-once delivery of a message.
 */
async function claimSend(ref: string, kind: Kind): Promise<boolean> {
  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: emailPk(ref),
          SK: sentSk(kind),
          sentAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + MARKER_TTL_SECONDS,
        },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      }),
    );
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw error;
  }
}

/**
 * Gives the claim back, so a retry can genuinely try again.
 *
 * The marker is written before the send rather than after, because the ordering
 * that risks a duplicate is worse than the one that risks a delay. That choice
 * is only safe if a failed send releases what it claimed.
 */
async function releaseSend(ref: string, kind: Kind): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: emailPk(ref), SK: sentSk(kind) },
    }),
  );
}

function compose(kind: Kind, booking: Booking): { subject: string; body: string } {
  // Empty rather than a placeholder phrase, because the sentences below drop
  // the clause entirely when the record carries no time. "The interview at the
  // scheduled time" told a parent nothing and read like a bug.
  const when = booking.startsAt ? formatSlotTime(booking.startsAt) : "";
  const ref = booking.bookingRef ?? "";
  const greeting = booking.parentName ? `Hello ${booking.parentName},` : "Hello,";

  if (kind === "cancellation") {
    return {
      subject: "Your parent-teacher interview has been cancelled",
      body: [
        greeting,
        "",
        when
          ? `Your interview on ${when} has been cancelled and the time is free again.`
          : "Your interview has been cancelled and the time is free again.",
        "",
        `If this was not you, book again at ${SITE_BASE_URL}/interviews`,
      ].join("\n"),
    };
  }

  return {
    subject: "Your parent-teacher interview is booked",
    body: [
      greeting,
      "",
      when ? `You are booked for ${when}.` : "Your interview is booked.",
      "",
      // The reference is the only thing that identifies the booking - there are
      // no parent accounts - so it belongs in the message a parent keeps rather
      // than only in the response body of the request that created it.
      `Your reference is ${ref}. Keep it: it is what lets you change or cancel.`,
      "",
      `Change or cancel at ${SITE_BASE_URL}/interviews`,
    ].join("\n"),
  };
}

/** Returns true when a message was sent, false when there was nothing to do. */
async function process(record: DynamoDBRecord): Promise<boolean> {
  const keys = record.dynamodb?.Keys;
  const pk = keys?.PK?.S;
  const sk = keys?.SK?.S;

  // The same rule the event source mapping's filter applies, applied again. A
  // filter is configuration and can be edited from a console; sending exactly
  // one email per booking is a property of this function.
  if (!pk?.startsWith(BOOKING_PREFIX) || sk !== BOOKING_META_SK) return false;

  const kind: Kind | undefined =
    record.eventName === "INSERT"
      ? "confirmation"
      : record.eventName === "REMOVE"
        ? "cancellation"
        : undefined;

  // MODIFY reaches here only if something starts updating bookings in place.
  // Nothing does today, and guessing which message that would deserve is worse
  // than sending none.
  if (!kind) return false;

  const booking = toItem(
    kind === "confirmation" ? record.dynamodb?.NewImage : record.dynamodb?.OldImage,
  );

  const ref = booking.bookingRef ?? pk.slice(BOOKING_PREFIX.length);
  const to = await recipientFor(booking);

  if (!to) {
    // Not an error, and deliberately not a throw. parentEmail is optional by
    // design, and a booking the office has no address for is a booking that
    // still happened. Throwing would retry the batch forever over a record that
    // can never succeed.
    console.log("booking-email: no address on file, nothing sent", { ref, kind });
    return false;
  }

  if (!(await claimSend(ref, kind))) {
    console.log("booking-email: already sent, skipping", { ref, kind });
    return false;
  }

  const { subject, body } = compose(kind, booking);

  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM_ADDRESS,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            // Text only. The front end is a prop and the message is five lines;
            // an HTML part would double what has to render correctly in every
            // client for no gain a parent would notice.
            Body: { Text: { Data: body, Charset: "UTF-8" } },
          },
        },
      }),
    );
  } catch (error) {
    await releaseSend(ref, kind);
    throw error;
  }

  console.log("booking-email: sent", { ref, kind });
  return true;
}

export const handler = async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
  const batchItemFailures: DynamoDBBatchResponse["batchItemFailures"] = [];

  // Sequential, not Promise.all, and it is not only about rate limits.
  //
  // The INSERT and the REMOVE for one booking share the partition BOOKING#<ref>,
  // so the stream delivers them to the same shard in order. Processing them in
  // order is what keeps a parent who books and cancels within a minute from
  // receiving the two messages the wrong way round. Promise.all would give that
  // guarantee up for a batch of at most ten.
  for (const [index, record] of event.Records.entries()) {
    try {
      await process(record);
    } catch (error) {
      console.error("booking-email: record failed", {
        sequenceNumber: record.dynamodb?.SequenceNumber,
        error,
      });

      // Report this record and every record after it, then stop.
      //
      // For a stream source Lambda checkpoints at the *lowest* sequence number
      // reported, so everything after a failure is redelivered whether it is
      // listed or not. Carrying on would send messages that are about to be
      // reprocessed anyway - protected from duplication only by their markers -
      // and would break the ordering guarantee above. Reporting the tail makes
      // what actually happens explicit rather than incidental.
      for (const remaining of event.Records.slice(index)) {
        if (remaining.dynamodb?.SequenceNumber) {
          batchItemFailures.push({ itemIdentifier: remaining.dynamodb.SequenceNumber });
        }
      }
      break;
    }
  }

  return { batchItemFailures };
};
