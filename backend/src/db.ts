import { DynamoDBClient, type DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// One switch, one file. DYNAMODB_ENDPOINT is set only for local development;
// deployed Lambdas never see it and get the same code path against real AWS.
// No isLocal branch belongs anywhere else in the codebase.
export function clientConfig(env: NodeJS.ProcessEnv = process.env): DynamoDBClientConfig {
  if (!env.DYNAMODB_ENDPOINT) {
    // Deployed: region and credentials come from the Lambda execution
    // environment, so naming either here would only be a way to get it wrong.
    return {};
  }

  return {
    endpoint: env.DYNAMODB_ENDPOINT,

    // ca-central-1 rather than the usual us-east-1 placeholder. DynamoDB Local
    // ignores the value under -sharedDb, but every other region reference in
    // this repo is Canadian and a stray us-east-1 in a log is a confusing thing
    // to have to explain.
    region: env.AWS_REGION ?? "ca-central-1",

    // Dummy values, and still required. DynamoDB Local does not check them, but
    // the SDK refuses to sign a request with an empty credential chain, and the
    // resulting error names the credential provider rather than this.
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  };
}

export const isLocal = Boolean(process.env.DYNAMODB_ENDPOINT);

export const docClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig()), {
  marshallOptions: {
    // An attribute set to undefined is dropped rather than rejected, which is
    // what lets a handler build one item shape with optional fields.
    removeUndefinedValues: true,
  },
});

export { TABLE_NAME } from "./schema.js";
