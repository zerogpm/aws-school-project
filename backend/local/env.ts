// The local runtime environment, in one place.
//
// Import this FIRST, before anything that reaches a handler. src/schema.ts
// resolves TABLE_NAME at module-load time, src/db.ts builds its client at
// module-load time, and an ES module's imports are evaluated in source order
// before any statement in the importing file runs. So the brief's "assign
// process.env, then import" trick does not work here - this repo is ESM
// ("type": "module", module: nodenext) and the assignments would run after the
// handler had already frozen its values. A side-effect import placed first is
// the version of that trick that actually works.
//
// Deployed Lambdas never load this file. Every value below is supplied there by
// modules/booking/lambda.tf instead, which is the whole point: nothing local
// leaks a default into production.

// ||=, not ??=: an explicitly empty value means "not configured" and should
// fall back, matching how src/db.ts already treats an empty DYNAMODB_ENDPOINT.

// 127.0.0.1, never localhost. On Windows localhost resolves to ::1 first and
// the container listens on IPv4 only, so the connection is refused with an
// error that says nothing about IPv6.
process.env.DYNAMODB_ENDPOINT ||= "http://127.0.0.1:8000";

// Prefixed, so a client that somehow reached real AWS with this name finds
// nothing rather than something.
process.env.TABLE_NAME ||= "local-school";

// Both loopback spellings and both vite ports: 5173 is the dev server, 4173 is
// the preview build the Playwright suite runs against. One list, read by the
// cors middleware and by the handlers' own CORS headers, so local cannot drift
// from what modules/booking/api.tf allows.
// The real bucket, because there is no local S3 and no seam for one - see
// src/media.ts. Overridden by whatever a deployed stage is called; this default
// is only useful once a stage has been applied.
process.env.MEDIA_BUCKET ||= "school-media-local";

// Where a browser fetches a published document. Deployed this is the
// CloudFront distribution, which serves the site and the media bucket from one
// origin; locally the vite dev server is not that distribution and has no
// docs/ to serve, so a link built from this default will 404. That is the
// honest local behaviour - there is no local S3 and no local CDN - and pointing
// it at a deployed stage is what makes the links work from a laptop.
process.env.MEDIA_BASE_URL ||= "http://127.0.0.1:5173";

process.env.ALLOWED_ORIGINS ||=
  "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173";

// Read by src/mail.ts. Nothing local sends mail - there is no local SES and no
// seam for one, and no local event source mapping to invoke the consumer in the
// first place - so these exist to keep an import of the handler from throwing,
// not to make sending work.
//
// A .test address on purpose. If something ever did reach SES with this, it
// should fail rather than arrive somewhere real.
process.env.SES_FROM_ADDRESS ||= "interviews@school.test";

// The site the confirmation links back to. Locally that is the vite dev server.
process.env.SITE_BASE_URL ||= "http://127.0.0.1:5173";

process.env.PORT ||= "3000";
