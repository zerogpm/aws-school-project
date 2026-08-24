// The office opens an evening for booking.
//
// Office staff only - not merely signed-in staff. isOffice reads cognito:groups
// out of the already-verified token, which is the split decided in 02: the
// coarse role question is free and answered by the claim, and the table is read
// only for per-record ownership. This is the first route to use it.
//
// The request describes the evening; the server builds the grid. A three-hour
// window at twenty minutes for sixty teachers is 540 items from a request small
// enough to type, and generateSlots is a pure function so the arithmetic is
// tested without a database.
import { BatchWriteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { TABLE_NAME, docClient } from "../../db.js";
import { WINDOW_META_SK, windowPk } from "../../booking/keys.js";
import { generateSlots, type Teacher } from "../../booking/slots.js";
import { isOffice } from "../auth.js";
import type { ApiEvent, ApiResult } from "../http.js";
import { badRequest, conflict, created, forbidden, parseBody, serverError } from "../http.js";

type CreateWindowRequest = {
  id?: unknown;
  label?: unknown;
  opensAt?: unknown;
  closesAt?: unknown;
  slotMinutes?: unknown;
  teachers?: unknown;
  published?: unknown;
};

/** DynamoDB's hard limit on one BatchWriteItem call. Not a tuning knob. */
const BATCH_SIZE = 25;

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export const handler = async (event: ApiEvent): Promise<ApiResult> => {
  try {
    if (!isOffice(event)) return forbidden(event, "Office staff only");

    const body = parseBody<CreateWindowRequest>(event);
    if (!body) return badRequest(event, "A JSON body is required");

    const id = asString(body.id);
    const label = asString(body.label);
    const opensAt = asString(body.opensAt);
    const closesAt = asString(body.closesAt);

    if (!id) return badRequest(event, "id is required");
    if (!/^[a-z0-9-]+$/.test(id)) {
      // The id goes straight into a partition key and a URL. Restricting it
      // here means no escaping anywhere else.
      return badRequest(event, "id may contain only lowercase letters, digits and hyphens");
    }
    if (!label) return badRequest(event, "label is required");

    const teachers = parseTeachers(body.teachers);
    if (!teachers) {
      return badRequest(event, "teachers must be a list of { id, name }");
    }

    const slotMinutes = body.slotMinutes;
    if (typeof slotMinutes !== "number") return badRequest(event, "slotMinutes must be a number");

    // generateSlots throws on anything a member of staff can get wrong - the
    // times, the step, a duplicated teacher - with a message worth showing.
    let slots;
    try {
      slots = generateSlots({ opensAt, closesAt, slotMinutes, teachers });
    } catch (error) {
      return badRequest(event, error instanceof Error ? error.message : "Invalid window");
    }

    // The window item first, conditionally. This is the guard against opening
    // the same window twice and silently resetting every booking in it.
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: windowPk(id),
            SK: WINDOW_META_SK,

            // The index that answers "every window", which no primary key
            // layout can do without a scan. An ISO-8601 string, because it
            // sorts correctly lexicographically and a number would be absent
            // from the index with no error to say so.
            GSI1PK: "WINDOWS",
            GSI1SK: opensAt,

            label,
            opensAt,
            closesAt,
            slotMinutes,
            // Unpublished by default. Staff build the evening, check the
            // roster, then announce it - so opening a window must not put it
            // in front of parents the same second.
            published: body.published === true,
            createdAt: new Date().toISOString(),
          },
          ConditionExpression: "attribute_not_exists(PK)",
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return conflict(event, `An interview window called ${id} already exists`);
      }
      throw error;
    }

    await writeSlots(id, slots);

    return created(event, {
      windowId: id,
      label,
      opensAt,
      closesAt,
      slotMinutes,
      published: body.published === true,
      teachers: teachers.length,
      slots: slots.length,
    });
  } catch (error) {
    console.error("create-window failed", error);
    return serverError(event);
  }
};

function parseTeachers(value: unknown): Teacher[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const teachers: Teacher[] = [];

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return undefined;

    const id = asString((entry as Teacher).id);
    const name = asString((entry as Teacher).name);
    if (!id || !name) return undefined;

    teachers.push({ id, name });
  }

  return teachers;
}

/**
 * Writes the grid in batches of 25, retrying whatever DynamoDB hands back.
 *
 * BatchWriteItem is not a transaction and takes no conditions - which is fine
 * here, because the conditional Put above already established this window did
 * not exist, so nothing else is writing these keys. What it does do is return
 * UnprocessedItems under load rather than failing, and dropping those on the
 * floor is how a window quietly ends up missing a teacher's five o'clock.
 */
async function writeSlots(
  windowId: string,
  slots: ReturnType<typeof generateSlots>,
): Promise<void> {
  for (let start = 0; start < slots.length; start += BATCH_SIZE) {
    const batch = slots.slice(start, start + BATCH_SIZE);

    let requests = batch.map((slot) => ({
      PutRequest: {
        Item: {
          PK: windowPk(windowId),
          SK: slot.sk,
          teacherId: slot.teacherId,
          teacherName: slot.teacherName,
          startsAt: slot.startsAt,
          // No bookedBy. Its absence is what "free" means, and what the
          // booking transaction asserts with attribute_not_exists.
        },
      },
    }));

    // Bounded, so a persistently throttled table fails loudly instead of
    // spinning until the Lambda times out with nothing in the log.
    for (let attempt = 0; attempt < 5 && requests.length > 0; attempt++) {
      const response = await docClient.send(
        new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: requests } }),
      );

      const unprocessed = response.UnprocessedItems?.[TABLE_NAME] ?? [];
      requests = unprocessed as typeof requests;
    }

    if (requests.length > 0) {
      throw new Error(`${requests.length} slots could not be written after 5 attempts`);
    }
  }
}
