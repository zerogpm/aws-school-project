/// <reference types="vite/client" />

// Injected at build time by scripts/deploy-site.sh from the 02-auth Terraform
// outputs. Neither is a secret: the app client is public and generates no
// secret, because anything shipped inside a JavaScript bundle is readable.
interface ImportMetaEnv {
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_REGION?: string;

  // The HTTP API's base URL, from the booking module's api_url output. Absent
  // in `vite dev`, where src/api/interviews.ts falls back to the local wrapper.
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
