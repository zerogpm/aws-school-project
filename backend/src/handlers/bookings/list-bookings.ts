// Who is coming, and at what time. The roster the office prints.
//
// Staff only, and the mirror image of list-slots: same partition, same query,
// same order - a different mapper. That is the whole difference between the two
// audiences, which is why the mappers live in one file with a test pinning the
// public one's keys.
//
// Unpublished windows are visible here. Staff draft an evening before
// announcing it, and the roster is how they check it before it goes out.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, docClient } from "../../db.js";
import { WINDOW_META_SK, windowPk } from "../../booking/keys.js";
import { toStaffSlot } from "../../booking/mappers.js";
import { SLOT_PREFIX } from "../../booking/slots.js";
import { isStaff } from "../auth.js";
import type { ApiEvent, ApiResult } from "../http.js";
import { forbidden, notFound, ok, serverError } from "../http.js";

export const handler = async (event: ApiEvent): Promise<ApiResult> => {
  try {
    // Belt to the authorizer's braces. Deployed, an unauthenticated request
    // never reaches this line; locally there is no authorizer, so without this
    // the roster would be open in the runtime where it is easiest to forget.
    if (!isStaff(event)) return forbidden(event, "Staff sign-in required");

    const windowId = event.pathParameters?.id;
    if (!windowId) return notFound(event, "No such interview window");

    const { Items } = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": windowPk(windowId) },

        // The office is reading this to decide who to expect in ten minutes.
        // A stale read here shows a parent who cancelled as still coming.
        ConsistentRead: true,
      }),
    );

    const items = Items ?? [];
    const meta = items.find((item) => item.SK === WINDOW_META_SK);
    if (!meta) return notFound(event, "No such interview window");

    const slots = items
      .filter((item) => String(item.SK).startsWith(SLOT_PREFIX))
      .map(toStaffSlot);

    const booked = slots.filter((slot) => !slot.available);

    return ok(event, {
      windowId,
      label: String(meta.label ?? ""),
      published: meta.published === true,
      // Counts, because the office wants "41 of 54" at a glance and computing
      // it here costs nothing on items already in memory.
      total: slots.length,
      booked: booked.length,
      slots,
    });
  } catch (error) {
    console.error("list-bookings failed", error);
    return serverError(event);
  }
};
