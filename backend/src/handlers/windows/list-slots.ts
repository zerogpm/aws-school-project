// The times a parent can choose from, and which are gone.
//
// Public: the interviews page is the one place a parent without an account has
// to look, so this answers without a token. That makes the projection the
// security boundary - see toPublicSlot, which returns four keys and no student
// data, whatever else the item carries.
//
// One query for the whole window. The META item sorts before every SLOT# in the
// same partition ("M" < "S"), so a query with no sort-key condition returns the
// window and its slots together, and the published check costs no second call.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, docClient } from "../../db.js";
import { WINDOW_META_SK, windowPk } from "../../booking/keys.js";
import { toPublicSlot } from "../../booking/mappers.js";
import { SLOT_PREFIX } from "../../booking/slots.js";
import type { ApiEvent, ApiResult } from "../http.js";
import { notFound, ok, serverError } from "../http.js";

export const handler = async (event: ApiEvent): Promise<ApiResult> => {
  try {
    // Absent, not {}, when the route has no parameters - so this is optional
    // chained even though this route always has one.
    const windowId = event.pathParameters?.id;
    if (!windowId) return notFound(event, "No such interview window");

    const { Items } = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": windowPk(windowId) },

        // A Query is eventually consistent by default. A parent who has just
        // booked and lands back on this list would otherwise sometimes see the
        // slot still free, and try again. Two RCU instead of one on a read of a
        // few dozen small items is not a cost worth thinking about; a parent
        // double-booking because the page lied is.
        ConsistentRead: true,
      }),
    );

    const items = Items ?? [];
    const meta = items.find((item) => item.SK === WINDOW_META_SK);

    // An unpublished window is indistinguishable from a missing one here, on
    // purpose. Staff draft next term's evening before announcing it, and the
    // public route should not confirm that a draft exists.
    if (!meta || meta.published !== true) return notFound(event, "No such interview window");

    const slots = items
      .filter((item) => String(item.SK).startsWith(SLOT_PREFIX))
      .map(toPublicSlot);

    return ok(event, {
      windowId,
      label: String(meta.label ?? ""),
      opensAt: String(meta.opensAt ?? ""),
      closesAt: String(meta.closesAt ?? ""),
      // Already chronological: the sort key starts with the timestamp, so
      // DynamoDB returned them in the order the evening runs.
      slots,
    });
  } catch (error) {
    console.error("list-slots failed", error);
    return serverError(event);
  }
};
