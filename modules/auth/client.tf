# ---------------------------------------------------------------------------
# One app client, for the browser. Public: no client secret, because a secret
# shipped inside a JavaScript bundle is not a secret.
# ---------------------------------------------------------------------------

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.name_prefix}-web"
  user_pool_id = aws_cognito_user_pool.staff.id

  generate_secret = false

  # Authorization code flow, with PKCE supplied by the browser. Never implicit:
  # implicit puts the tokens in the URL fragment, where they land in history and
  # in any referrer that leaks.
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]

  # Cognito matches these literally. A missing trailing slash is a
  # redirect_mismatch error, not a redirect.
  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  # ALLOW_USER_PASSWORD_AUTH is here because the sign-in form is ours. The
  # argument against it was that it hands the plaintext password to whatever is
  # calling - true, and the reason the hosted UI never gets it. But our own form
  # collected that password, so it already holds the plaintext; SRP would only
  # change whether it also travels, and it travels over TLS to Cognito either
  # way.
  #
  # The real cost is that SRP is not something to hand-write. Choosing it would
  # mean adding amazon-cognito-identity-js to a front end the brief calls a prop.
  #
  # ALLOW_USER_SRP_AUTH stays enabled: it costs nothing, and it is the flow to
  # move to if this ever grows a login worth attacking.
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = var.access_token_validity_minutes
  id_token_validity      = var.id_token_validity_minutes
  refresh_token_validity = var.refresh_token_validity_days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  # Sign-out actually invalidates the refresh token. Without this, revocation
  # waits for expiry, and the expiry above is measured in weeks.
  enable_token_revocation = true

  # A wrong password and an unknown address return the same error, so the login
  # page cannot be used to enumerate which teachers work here.
  prevent_user_existence_errors = "ENABLED"
}
