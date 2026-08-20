# ---------------------------------------------------------------------------
# Hosted UI appearance.
#
# The default is a grey box that looks nothing like the school. This is the
# cheap fix: Cognito accepts a restricted stylesheet and a logo, applied to the
# classic hosted UI, and it works on the LITE tier.
#
# What it cannot do is change the layout. Cognito only honours a fixed set of
# *-customizable classes with a restricted property list per class, so this
# stays a centered card - it just becomes the school's centered card. Anything
# beyond that needs managed login, which is an ESSENTIALS feature and a per-MAU
# rate this project deliberately did not choose.
#
# Sixty staff see this page a few times a term. Branding is proportionate; a
# rewrite is not.
# ---------------------------------------------------------------------------

resource "aws_cognito_user_pool_ui_customization" "this" {
  count = var.hosted_ui_css == "" ? 0 : 1

  user_pool_id = aws_cognito_user_pool.staff.id
  client_id    = aws_cognito_user_pool_client.web.id
  css          = var.hosted_ui_css

  # The domain has to exist before customization can be attached to it.
  depends_on = [aws_cognito_user_pool_domain.this]
}
