// Is the API answering?
//
// Public, because the Route53 health check that calls it has no token to
// present - and deliberately touches no datastore, so a DynamoDB outage does
// not make this report the API as down when the API is fine. It answers one
// question, and 06-cost wires an SNS email to the answer.
import type { ApiEvent, ApiResult } from "./http.js";
import { ok, serverError } from "./http.js";

export const handler = async (event: ApiEvent): Promise<ApiResult> => {
  try {
    return ok(event, { status: "ok" });
  } catch (error) {
    // Unreachable today, and kept anyway: the shape of every handler is the
    // same, and a handler that throws instead of returning surfaces as an API
    // Gateway 502 with nothing useful in it.
    console.error("health failed", error);
    return serverError(event);
  }
};
