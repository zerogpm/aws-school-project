// Builds the stream events DynamoDB actually sends, for tests.
//
// The sibling of test-event.ts, and it exists for the same reason: the payoff of
// the handler contract is that logic is testable as a pure function, and that
// only holds if the synthetic event is honest about the awkward shapes.
//
// The awkward shapes here are different from an API Gateway event's. A REMOVE
// carries an OldImage and no NewImage; an INSERT the reverse. Every field on
// DynamoDBRecord is optional in the type, because the stream really does omit
// them. And a batch is a batch - one booking writes four items, so a single
// record is the case that never happens in production.
//
// No handler imports this, so it never reaches a Lambda bundle.
import { marshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue as StreamAttributeValue, DynamoDBRecord } from "aws-lambda";

export type RecordOptions = {
  eventName?: "INSERT" | "MODIFY" | "REMOVE";
  pk?: string;
  sk?: string;

  /** The item as it exists after the write. Ignored for REMOVE, as on AWS. */
  newImage?: Record<string, unknown>;

  /** The item as it existed before. Ignored for INSERT, as on AWS. */
  oldImage?: Record<string, unknown>;

  sequenceNumber?: string;
};

const image = (item: Record<string, unknown> | undefined) =>
  item ? (marshall(item, { removeUndefinedValues: true }) as Record<string, StreamAttributeValue>) : undefined;

let counter = 0;

export function streamRecord(options: RecordOptions = {}): DynamoDBRecord {
  const eventName = options.eventName ?? "INSERT";
  const pk = options.pk ?? "BOOKING#test-ref";
  const sk = options.sk ?? "META";

  // A sequence number per record, because batchItemFailures identifies a failed
  // record by it and a shared default would make two failures look like one.
  const sequenceNumber = options.sequenceNumber ?? `seq-${++counter}`;

  return {
    eventID: `event-${sequenceNumber}`,
    eventName,
    eventSource: "aws:dynamodb",
    eventVersion: "1.1",
    awsRegion: "ca-central-1",
    dynamodb: {
      ApproximateCreationDateTime: 1_787_356_800,
      Keys: image({ PK: pk, SK: sk }),
      // INSERT has no OldImage and REMOVE has no NewImage. Modelled rather than
      // assumed: a handler that reads the wrong one gets undefined here, which
      // is exactly what it would get on AWS.
      NewImage: eventName === "REMOVE" ? undefined : image(options.newImage),
      OldImage: eventName === "INSERT" ? undefined : image(options.oldImage),
      SequenceNumber: sequenceNumber,
      SizeBytes: 128,
      StreamViewType: "NEW_AND_OLD_IMAGES",
    },
    eventSourceARN:
      "arn:aws:dynamodb:ca-central-1:000000000000:table/local-school/stream/2026-08-24T00:00:00.000",
  };
}

/** A batch, because a batch is what arrives. */
export function streamEvent(records: RecordOptions[] = [{}]) {
  return { Records: records.map(streamRecord) };
}

/**
 * The four records one booking transaction really produces - the slot, both
 * guards, and the booking itself - in the order the transaction writes them.
 *
 * Only the last is the one to act on. This helper exists so that "sends exactly
 * one email" is tested against the real shape rather than against a single
 * hand-picked record.
 */
export function bookingWriteBatch(booking: Record<string, unknown>, ref = "test-ref") {
  const student = String(booking.studentNumber ?? "S00481");
  const windowId = String(booking.windowId ?? "autumn-2026");

  return streamEvent([
    {
      eventName: "MODIFY",
      pk: `WINDOW#${windowId}`,
      sk: "SLOT#2026-10-14T21:00:00.000Z#okafor",
      oldImage: { PK: `WINDOW#${windowId}`, SK: "SLOT#2026-10-14T21:00:00.000Z#okafor" },
      newImage: {
        PK: `WINDOW#${windowId}`,
        SK: "SLOT#2026-10-14T21:00:00.000Z#okafor",
        bookedBy: student,
        bookingRef: ref,
      },
    },
    {
      eventName: "INSERT",
      pk: `STUDENT#${student}`,
      sk: `CLAIM#${windowId}#okafor`,
      newImage: { PK: `STUDENT#${student}`, SK: `CLAIM#${windowId}#okafor`, bookingRef: ref },
    },
    {
      eventName: "INSERT",
      pk: `STUDENT#${student}`,
      sk: `TIME#${windowId}#2026-10-14T21:00:00.000Z`,
      newImage: {
        PK: `STUDENT#${student}`,
        SK: `TIME#${windowId}#2026-10-14T21:00:00.000Z`,
        bookingRef: ref,
      },
    },
    {
      eventName: "INSERT",
      pk: `BOOKING#${ref}`,
      sk: "META",
      newImage: { PK: `BOOKING#${ref}`, SK: "META", bookingRef: ref, ...booking },
    },
  ]);
}
