import { describe, expect, it } from "vitest";
import { clientConfig } from "./db.js";
import { tables } from "./schema.js";

describe("clientConfig", () => {
  it("is empty when deployed, so the Lambda environment supplies everything", () => {
    // Naming a region or credentials here would only be a way to get them
    // wrong. An empty config is what makes local and deployed the same code.
    expect(clientConfig({})).toEqual({});
  });

  it("points at the local container when DYNAMODB_ENDPOINT is set", () => {
    const config = clientConfig({ DYNAMODB_ENDPOINT: "http://127.0.0.1:8000" });
    expect(config.endpoint).toBe("http://127.0.0.1:8000");
  });

  it("supplies dummy credentials, which the SDK insists on even locally", () => {
    // DynamoDB Local ignores the values, but the SDK refuses to sign with an
    // empty credential chain and the error names the credential provider
    // rather than anything to do with the endpoint.
    const config = clientConfig({ DYNAMODB_ENDPOINT: "http://127.0.0.1:8000" });
    expect(config.credentials).toEqual({ accessKeyId: "local", secretAccessKey: "local" });
  });

  it("stays Canadian locally too, rather than the usual us-east-1 placeholder", () => {
    const config = clientConfig({ DYNAMODB_ENDPOINT: "http://127.0.0.1:8000" });
    expect(config.region).toBe("ca-central-1");
  });

  it("lets AWS_REGION override the local default", () => {
    const config = clientConfig({
      DYNAMODB_ENDPOINT: "http://127.0.0.1:8000",
      AWS_REGION: "ca-west-1",
    });
    expect(config.region).toBe("ca-west-1");
  });

  it("treats an empty endpoint as not set, not as a local endpoint", () => {
    expect(clientConfig({ DYNAMODB_ENDPOINT: "" })).toEqual({});
  });
});

describe("schema", () => {
  it("uses on-demand billing, matching the deployed table", () => {
    for (const table of tables) {
      expect(table.BillingMode).toBe("PAY_PER_REQUEST");
    }
  });

  it("prefixes local table names, so a misdirected client is obvious", () => {
    for (const table of tables) {
      expect(table.TableName).toMatch(/^local-/);
    }
  });

  it("declares every key attribute it uses, and no others", () => {
    for (const table of tables) {
      const declared = new Set(
        (table.AttributeDefinitions ?? []).map((a) => a.AttributeName),
      );
      const used = new Set([
        ...(table.KeySchema ?? []).map((k) => k.AttributeName),
        ...(table.GlobalSecondaryIndexes ?? []).flatMap((index) =>
          (index.KeySchema ?? []).map((k) => k.AttributeName),
        ),
      ]);

      // DynamoDB rejects a table declaring an attribute no key or index uses,
      // and rejects a key referring to one that was never declared.
      expect([...declared].sort()).toEqual([...used].sort());
    }
  });

  it("keys on strings, because a sort key written as a number vanishes", () => {
    // A timestamp written as {N} against a key declared {S} makes the row
    // silently absent from the index - no error, just an empty query.
    for (const table of tables) {
      for (const attribute of table.AttributeDefinitions ?? []) {
        expect(attribute.AttributeType).toBe("S");
      }
    }
  });
});
