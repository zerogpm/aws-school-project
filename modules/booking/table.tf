# ---------------------------------------------------------------------------
# The single table.
#
# backend/src/schema.ts is a hand-written mirror of this. Nothing keeps the two
# in sync, so they change in the same commit or local passes while deployed
# breaks - which is the failure this comment exists to make expensive to cause.
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "school" {
  name = "${var.name_prefix}-school"

  # Two busy evenings a year and near-dead traffic the rest of it is precisely
  # the shape provisioned capacity is worst at: you pay all year for the peak,
  # or you throttle parents on the one night that matters.
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "PK"
  range_key = "SK"

  # Only key attributes are declared. DynamoDB is schemaless for everything
  # else, and declaring an attribute no key or index uses is rejected outright.
  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name = "GSI1"

    # key_schema blocks rather than hash_key/range_key: the provider deprecated
    # the flat form on indexes in 6.x, and it mirrors the CreateTable API and
    # backend/src/schema.ts, which both spell it this way.
    key_schema {
      attribute_name = "GSI1PK"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "GSI1SK"
      key_type       = "RANGE"
    }

    # Sort keys are strings, timestamps included. An ISO-8601 string sorts
    # correctly lexicographically; a timestamp written as a number against a key
    # declared S is silently absent from the index - no error, just an empty
    # query, which reads like data loss rather than a mistake.
    projection_type = "ALL"
  }

  # The stream episode 05 reads. NEW_AND_OLD_IMAGES is not a preference: a
  # cancellation DELETEs the BOOKING#<ref>/META item, so the parent's address
  # exists only in the old image. Under NEW_IMAGE a cancellation arrives as keys
  # and nothing else, and there is nobody left to email.
  #
  # Turning it on costs nothing by itself - a stream is billed on reads, and
  # only the consumer in consumers.tf reads it.
  stream_enabled   = var.stream_enabled
  stream_view_type = var.stream_enabled ? "NEW_AND_OLD_IMAGES" : null

  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }

  # The entire backup story, and deliberately so. A booking cannot be lost;
  # analytics can. There is no dashboard, no paging alarm and no second region.
  lifecycle {
    prevent_destroy = false
  }
}
