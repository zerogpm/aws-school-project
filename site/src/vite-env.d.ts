/// <reference types="vite/client" />

// Injected at build time by scripts/deploy-site.sh from the 02-auth Terraform
// outputs. Neither is a secret: the app client is public and generates no
// secret, because anything shipped inside a JavaScript bundle is readable.
interface ImportMetaEnv {
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_REGION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
