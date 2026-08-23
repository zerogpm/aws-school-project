// Interview windows, newest first, for the staff who run them.
//
// The primary key layout answers "everything about window X". It cannot answer
// "every window", because that would need a scan - so the META item of each
// window carries GSI1PK = "WINDOWS" and GSI1SK = its opening time, and this
// query reads the index instead. One partition, a handful of items a year.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME, docClient } from "../../db.js";
import type { ApiEvent, ApiResult } from "../http.js";
import { forbidden, ok, serverError } from "../http.js";
import { isStaff } from "../auth.js";

export type InterviewWindow = {
  id: string;
  label: string;
  opensAt: string;
  closesAt: string;
  published: boolean;
};

export const handler = async (event: ApiEvent): Promise<ApiResult> => {
  try {
    // Belt to the authorizer's braces. Deployed, an unauthenticated request
    // never reaches this line - API Gateway rejects it with a 401 of its own.
    // Locally there is no authorizer, so without this check the route would be
    // open in the runtime where it is easiest to forget that it matters.
    if (!isStaff(event)) return forbidden(event, "Staff sign-in required");

    const { Items } = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": "WINDOWS" },
        // Newest first. GSI1SK is an ISO-8601 string, which sorts correctly
        // lexicographically - written as a number it would be absent from the
        // index entirely, with no error to say so.
        ScanIndexForward: false,
      }),
    );

    const windows: InterviewWindow[] = (Items ?? []).map((item) => ({
      id: String(item.PK).replace(/^WINDOW#/, ""),
      label: String(item.label ?? ""),
      opensAt: String(item.opensAt ?? ""),
      closesAt: String(item.closesAt ?? ""),
      published: Boolean(item.published),
    }));

    return ok(event, { windows });
  } catch (error) {
    // console.error is the logging API: CloudWatch deployed, stdout locally. A
    // logger that assumes a long-lived process has nowhere to flush to before
    // Lambda freezes the execution context.
    console.error("list-windows failed", error);
    return serverError(event);
  }
};
