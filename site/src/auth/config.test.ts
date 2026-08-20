import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { idpEndpoint, isAuthConfigured } from "./config";

// Resolved from the vitest root (site/) rather than import.meta.url: Vite
// rewrites new URL(..., import.meta.url) as an asset reference at transform
// time, which does not survive a computed path.
const repoFile = (path: string) =>
  readFileSync(resolve(process.cwd(), "..", path), "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authConfig", () => {
  it("reports an unconfigured build rather than pretending sign-in can work", () => {
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "");
    vi.stubEnv("VITE_COGNITO_REGION", "");
    expect(isAuthConfigured()).toBe(false);
  });

  it("needs both halves before it will call itself configured", () => {
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "abc123");
    vi.stubEnv("VITE_COGNITO_REGION", "");
    expect(isAuthConfigured()).toBe(false);
  });

  it("is configured with a client id and a region", () => {
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "abc123");
    vi.stubEnv("VITE_COGNITO_REGION", "ca-central-1");
    expect(isAuthConfigured()).toBe(true);
  });
});

describe("idpEndpoint", () => {
  it("is the regional cognito-idp host, not the hosted UI domain", () => {
    vi.stubEnv("VITE_COGNITO_REGION", "ca-central-1");
    expect(idpEndpoint()).toBe("https://cognito-idp.ca-central-1.amazonaws.com/");
  });

  it("stays inside the configured region - data residency is not negotiable", () => {
    vi.stubEnv("VITE_COGNITO_REGION", "ca-central-1");
    expect(idpEndpoint()).toContain("ca-central-1");
    expect(idpEndpoint()).not.toContain("us-east-1");
  });
});

// Golden rule 3: an env var the app reads has to be wired in the IaC that
// builds it, and asserted somewhere. Renaming one of these without touching
// the Terraform would otherwise ship a bundle that silently cannot sign in.
describe("build-time wiring", () => {
  const VARS = ["VITE_COGNITO_CLIENT_ID", "VITE_COGNITO_REGION"];

  it.each(VARS)("%s is passed to the build by 02-auth/site.tf", (name) => {
    expect(repoFile("02-auth/site.tf")).toContain(name);
  });

  it.each(VARS)("%s is resolved by the deploy script for a manual run", (name) => {
    expect(repoFile("scripts/deploy-site.sh")).toContain(name);
  });

  it("takes the region from the stage variable, not from the caller environment", () => {
    expect(repoFile("02-auth/site.tf")).toContain("VITE_COGNITO_REGION    = var.aws_region");
  });

  it("no longer ships the hosted UI domain, which nothing reads", () => {
    expect(repoFile("02-auth/site.tf")).not.toContain("VITE_COGNITO_DOMAIN");
  });

  it("rebuilds the bundle when the app client is replaced", () => {
    // The client id is compiled in, so it has to be a replace trigger or the
    // deployed site keeps pointing at a pool that no longer exists.
    expect(repoFile("02-auth/site.tf")).toContain(
      "client_id = module.auth.user_pool_client_id",
    );
  });
});
