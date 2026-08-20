// Where the hosted UI lives and which app client to present. Both come from
// Terraform outputs at build time - see 02-auth/site.tf.
export function authConfig() {
  return {
    clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? "",
    region: import.meta.env.VITE_COGNITO_REGION ?? "",
  };
}

// Where the sign-in form posts. The regional cognito-idp endpoint, not the
// hosted UI domain - this is the service API, and it needs no domain at all.
export function idpEndpoint() {
  return `https://cognito-idp.${authConfig().region}.amazonaws.com/`;
}

// A build that was never given the Terraform outputs still has to render. The
// Staff page uses this to explain itself instead of redirecting to a broken URL.
export function isAuthConfigured() {
  const { clientId, region } = authConfig();
  return clientId !== "" && region !== "";
}

// Derived from the current origin rather than configured, so the same bundle
// works from CloudFront and from a local preview. The module registers both -
// see var.dev_origins in modules/auth. Cognito matches this literally, so the
// path must agree with callback_urls exactly, trailing slash included.
export function redirectUri() {
  return `${window.location.origin}/staff`;
}
