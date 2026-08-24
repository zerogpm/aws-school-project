// Layer 1 for the consumer: a pure function, no stream, no Lambda, no SES.
//
// Two seams are mocked, and only two - db.js the way every booking handler test
// mocks it, and mail.js, which exists as a module largely so this line can
// exist. Everything else runs for real: the key builders, the filtering, the
// message text.
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted, because vi.mock is lifted above the imports and a plain const
// declared here would be in its temporal dead zone inside the factory.
const { send, sesSend } = vi.hoisted(() => ({ send: vi.fn(), sesSend: vi.fn() }));

vi.mock("../db.js", () => ({ docClient: { send }, TABLE_NAME: "local-school" }));
vi.mock("../mail.js", () => ({
  ses: { send: sesSend },
  FROM_ADDRESS: "interviews@school.test",
  SITE_BASE_URL: "https://school.test",
}));

const { handler } = await import("./booking-email.js");
const { bookingWriteBatch, streamEvent } = await import("./stream-event.js");

const BOOKING = {
  bookingRef: "test-ref",
  windowId: "autumn-2026",
  teacherId: "okafor",
  startsAt: "2026-10-14T21:00:00.000Z",
  studentNumber: "S00481",
  parentName: "Sarah Okonkwo",
};

/**
 * The profile lookup answers with an address unless a test says otherwise.
 *
 * `string | null`, not `string | undefined`: passing undefined to a parameter
 * with a default *triggers* the default, so withProfile(undefined) would seed
 * an address while reading as though it removed one - and the "no address
 * anywhere" test would pass for the wrong reason, or fail confusingly.
 */
const withProfile = (parentEmail: string | null = "parent@school.test") => {
  send.mockImplementation(async (command: { constructor: { name: string } }) => {
    if (command.constructor.name === "GetCommand") {
      return { Item: parentEmail ? { parentEmail } : {} };
    }
    return {};
  });
};

const conditionalFailure = () =>
  Object.assign(new Error("The conditional request failed"), {
    name: "ConditionalCheckFailedException",
  });

/** The SES call the handler made, or undefined if it made none. */
const sentInput = () => sesSend.mock.calls[0]?.[0]?.input;

/** The first command of this type the handler sent to DynamoDB. Fails if none. */
const commandOfType = (name: string) => {
  const call = send.mock.calls.find((entry) => entry[0].constructor.name === name);
  expect(call, `expected the handler to send a ${name}`).toBeDefined();
  return call![0];
};

// Block bodies, not `() => send.mockReset()`. mockReset returns the mock, and
// vitest treats a function returned from beforeEach as that hook's teardown -
// so the concise form makes vitest call the mock itself after every test.
beforeEach(() => {
  send.mockReset();
  sesSend.mockReset();
  sesSend.mockResolvedValue({});
  withProfile();
});

describe("which records it acts on", () => {
  it("sends exactly one email for the four records one booking writes", async () => {
    // The whole reason the handler filters as well as the event source mapping.
    // A booking transaction writes the slot, two guards and the booking itself.
    await handler(bookingWriteBatch(BOOKING));

    expect(sesSend).toHaveBeenCalledTimes(1);
    expect(sentInput().Destination.ToAddresses).toEqual(["parent@school.test"]);
  });

  it("ignores records that are not the booking item", async () => {
    await handler(
      streamEvent([
        { pk: "WINDOW#autumn-2026", sk: "META", newImage: { published: true } },
        { pk: "STUDENT#S00481", sk: "PROFILE", newImage: { name: "Amara" } },
        // A window's META item has the same sort key as a booking's, so the
        // partition prefix is what distinguishes them, not the SK alone.
        { pk: "WINDOW#spring-2027", sk: "META", newImage: {} },
      ]),
    );

    expect(sesSend).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores a MODIFY on the booking, having no message for it", async () => {
    await handler(
      streamEvent([
        { eventName: "MODIFY", pk: "BOOKING#test-ref", sk: "META", newImage: BOOKING },
      ]),
    );

    expect(sesSend).not.toHaveBeenCalled();
  });
});

describe("the two messages", () => {
  it("confirms an INSERT from the new image, with the reference to cancel by", async () => {
    await handler(
      streamEvent([{ eventName: "INSERT", pk: "BOOKING#test-ref", sk: "META", newImage: BOOKING }]),
    );

    const input = sentInput();
    expect(input.FromEmailAddress).toBe("interviews@school.test");
    expect(input.Content.Simple.Subject.Data).toMatch(/booked/i);

    const body = input.Content.Simple.Body.Text.Data;
    expect(body).toContain("Sarah Okonkwo");
    expect(body).toContain("test-ref");
    expect(body).toContain("https://school.test/interviews");
  });

  it("reads a cancellation out of the OLD image, because the item is gone", async () => {
    // The reason the table is NEW_AND_OLD_IMAGES. cancel-booking deletes the
    // booking outright, so under NEW_IMAGE this record would be bare keys and
    // there would be nobody to tell.
    await handler(
      streamEvent([{ eventName: "REMOVE", pk: "BOOKING#test-ref", sk: "META", oldImage: BOOKING }]),
    );

    expect(sesSend).toHaveBeenCalledTimes(1);
    expect(sentInput().Content.Simple.Subject.Data).toMatch(/cancelled/i);
  });

  it("greets a parent whose name was never captured without saying 'undefined'", async () => {
    const { parentName, ...anonymous } = BOOKING;
    void parentName;

    await handler(
      streamEvent([
        { eventName: "INSERT", pk: "BOOKING#test-ref", sk: "META", newImage: anonymous },
      ]),
    );

    expect(sentInput().Content.Simple.Body.Text.Data).not.toMatch(/undefined/);
  });
});

describe("finding the recipient", () => {
  it("prefers an address the parent typed over the office's record", async () => {
    await handler(
      streamEvent([
        {
          eventName: "INSERT",
          pk: "BOOKING#test-ref",
          sk: "META",
          newImage: { ...BOOKING, parentEmail: "typed@school.test" },
        },
      ]),
    );

    expect(sentInput().Destination.ToAddresses).toEqual(["typed@school.test"]);
    // No profile read at all when the booking already carried one.
    expect(send.mock.calls.some((call) => call[0].constructor.name === "GetCommand")).toBe(false);
  });

  it("reads the student profile consistently, not eventually", async () => {
    // A stream record can arrive before an eventually consistent read would see
    // the write that produced it.
    await handler(
      streamEvent([{ eventName: "INSERT", pk: "BOOKING#test-ref", sk: "META", newImage: BOOKING }]),
    );

    const get = commandOfType("GetCommand");
    expect(get.input.Key).toEqual({ PK: "STUDENT#S00481", SK: "PROFILE" });
    expect(get.input.ConsistentRead).toBe(true);
  });

  it("sends nothing and throws nothing when there is no address anywhere", async () => {
    // parentEmail is optional by design. Throwing would retry this record until
    // the stream gave up, over a booking that can never succeed.
    withProfile(null);

    const result = await handler(
      streamEvent([{ eventName: "INSERT", pk: "BOOKING#test-ref", sk: "META", newImage: BOOKING }]),
    );

    expect(sesSend).not.toHaveBeenCalled();
    expect(result.batchItemFailures).toEqual([]);
  });
});

describe("sending exactly once", () => {
  it("claims the send before making it", async () => {
    await handler(
      streamEvent([{ eventName: "INSERT", pk: "BOOKING#test-ref", sk: "META", newImage: BOOKING }]),
    );

    const put = commandOfType("PutCommand");
    expect(put.input.Item).toMatchObject({ PK: "EMAIL#test-ref", SK: "SENT#confirmation" });
    expect(put.input.ConditionExpression).toContain("attribute_not_exists(PK)");
  });

  it("does not send twice when the batch is replayed", async () => {
    // At-least-once delivery of a record has to become exactly-once delivery of
    // a message, and the marker is where that happens.
    send.mockImplementation(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === "GetCommand") return { Item: { parentEmail: "p@school.test" } };
      if (command.constructor.name === "PutCommand") throw conditionalFailure();
      return {};
    });

    const result = await handler(
      streamEvent([{ eventName: "INSERT", pk: "BOOKING#test-ref", sk: "META", newImage: BOOKING }]),
    );

    expect(sesSend).not.toHaveBeenCalled();
    expect(result.batchItemFailures).toEqual([]);
  });

  it("keeps a cancellation separate from its own confirmation", async () => {
    await handler(
      streamEvent([{ eventName: "REMOVE", pk: "BOOKING#test-ref", sk: "META", oldImage: BOOKING }]),
    );

    const put = commandOfType("PutCommand");
    expect(put.input.Item.SK).toBe("SENT#cancellation");
  });

  it("gives the claim back when the send fails, so a retry can try again", async () => {
    sesSend.mockRejectedValue(new Error("SES said no"));

    const result = await handler(
      streamEvent([{ eventName: "INSERT", pk: "BOOKING#test-ref", sk: "META", newImage: BOOKING }]),
    );

    const deletes = send.mock.calls.filter((call) => call[0].constructor.name === "DeleteCommand");
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0].input.Key).toEqual({ PK: "EMAIL#test-ref", SK: "SENT#confirmation" });

    // And the record is reported, so Lambda redelivers only this one.
    expect(result.batchItemFailures).toHaveLength(1);
  });
});

describe("partial batch failure", () => {
  it("reports the failed record and everything after it, then stops", async () => {
    // Lambda checkpoints a stream source at the LOWEST sequence number reported,
    // so record two is redelivered whether it is listed or not. Sending it now
    // would be work that is about to be redone, so the handler stops - and says
    // so, rather than leaving it implicit.
    sesSend.mockRejectedValueOnce(new Error("SES said no")).mockResolvedValue({});

    const result = await handler(
      streamEvent([
        {
          eventName: "INSERT",
          pk: "BOOKING#one",
          sk: "META",
          newImage: { ...BOOKING, bookingRef: "one" },
          sequenceNumber: "seq-one",
        },
        {
          eventName: "INSERT",
          pk: "BOOKING#two",
          sk: "META",
          newImage: { ...BOOKING, bookingRef: "two" },
          sequenceNumber: "seq-two",
        },
      ]),
    );

    expect(sesSend).toHaveBeenCalledTimes(1);
    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: "seq-one" },
      { itemIdentifier: "seq-two" },
    ]);
  });

  it("keeps a booking and its cancellation in the order the stream delivered them", async () => {
    // One partition, one shard, so the stream guarantees the order. Promise.all
    // over the batch would give that up and mail a parent their cancellation
    // before their confirmation.
    await handler(
      streamEvent([
        { eventName: "INSERT", pk: "BOOKING#test-ref", sk: "META", newImage: BOOKING },
        { eventName: "REMOVE", pk: "BOOKING#test-ref", sk: "META", oldImage: BOOKING },
      ]),
    );

    const subjects = sesSend.mock.calls.map(
      (call) => call[0].input.Content.Simple.Subject.Data,
    );
    expect(subjects).toHaveLength(2);
    expect(subjects[0]).toMatch(/booked/i);
    expect(subjects[1]).toMatch(/cancelled/i);
  });

  it("returns an empty failure list when everything worked", async () => {
    const result = await handler(bookingWriteBatch(BOOKING));
    expect(result.batchItemFailures).toEqual([]);
  });
});
