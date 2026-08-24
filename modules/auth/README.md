# Module: auth

A Cognito user pool for staff, with the classic hosted UI and no
self-registration. Roughly sixty accounts, all created by the office.

## Creates

- User pool signing in by email address, `allow_admin_create_user_only = true`
- Password policy, optional TOTP MFA, email-only account recovery
- User groups (`office`, `teacher` by default) for the `cognito:groups` claim
- Hosted UI domain on `*.amazoncognito.com`
- A public app client: no secret, authorization code flow, token revocation on

## Inputs

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `name_prefix` | string | — | Prefix for resource names |
| `domain_suffix` | string | — | Makes the hosted UI domain globally unique; the account ID works |
| `callback_urls` | list(string) | — | Exact post-sign-in redirect URLs |
| `logout_urls` | list(string) | `[]` | Exact post-sign-out redirect URLs |
| `user_pool_tier` | string | `LITE` | `LITE`, `ESSENTIALS` or `PLUS` |
| `deletion_protection` | string | `INACTIVE` | `ACTIVE` blocks `terraform destroy` |
| `mfa_configuration` | string | `OPTIONAL` | `OFF`, `ON` or `OPTIONAL`; TOTP only |
| `password_minimum_length` | number | `12` | Cognito's own floor is 8 |
| `temporary_password_validity_days` | number | `14` | Invite expiry |
| `access_token_validity_minutes` | number | `60` | |
| `id_token_validity_minutes` | number | `60` | |
| `refresh_token_validity_days` | number | `30` | How long before signing in again |
| `groups` | map(object) | office, teacher | Group name → description and precedence |
| `ses_source_arn` | string | `""` | Verified SES identity; empty uses Cognito's sender |
| `ses_from_email_address` | string | `""` | Only meaningful with `ses_source_arn` |

`domain_suffix` is validated at plan time against the words Cognito rejects in a
domain prefix (`aws`, `amazon`, `cognito`), because otherwise the failure lands
partway through an apply.

## Outputs

`user_pool_id`, `user_pool_arn`, `user_pool_client_id`, `user_pool_endpoint`,
`issuer_url`, `hosted_ui_domain`, `hosted_ui_login_url`, `group_names`

## Notes

- **`user_pool_tier` is set to `LITE` on purpose.** A new pool defaults to
  `ESSENTIALS`. Sixty staff are free on any plan, so this is not about the bill
  today — it is about not sitting on a higher per-MAU rate nobody chose. `LITE`
  also fixes the sign-in page at the classic hosted UI, because the newer
  managed login branding needs `ESSENTIALS` or above. That pairing is why
  `managed_login_version = 1` is written out rather than left to a default.
- **`username_attributes` and `schema` are ForceNew.** Changing either replaces
  the pool and deletes every account in it. Settle them before the first real
  invite.
- **Cognito's built-in email sender is capped at 50 messages a day**, under the
  sixty invites a full staff onboarding needs. `ses_source_arn` is the way out;
  SES itself arrives in `05-email`, which creates the identity and can pass it
  here - gated, because sending through a sandboxed SES reaches fewer people
  than Cognito's own sender, not more.
- **No SMS anywhere** — not for MFA, not for recovery. It needs an SNS caller
  role, bills per message, and would mean holding staff phone numbers.
- The app client has no secret. It is a browser app, and a secret in a JS bundle
  is not a secret; the authorization code flow with PKCE is what replaces it.
- The invite email cannot name the hosted UI URL: the domain resource depends on
  the pool, so referencing it inside the pool would be a dependency cycle.
