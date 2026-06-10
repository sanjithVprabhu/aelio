# modules/s3-tenant-data — Per-region tenant data buckets (§12.1).
#
#   uploads-{region}     KB source files, eval scenarios
#   exports-{region}     DSAR exports, audit log exports
#   recordings-{region}  Voice call recordings (opt-in per tenant)
#
# All buckets: SSE with the regional KMS key + tenant-specific encryption
# context (asserted by the app on PutObject), versioning on, public access
# fully blocked. exports- and recordings- get cross-region replication (DR §12.5).

locals {
  tags = merge(var.tags, { Module = "s3-tenant-data" })

  buckets = {
    uploads    = { replicate = false }
    exports    = { replicate = true }
    recordings = { replicate = true }
  }
}

resource "aws_s3_bucket" "this" {
  for_each = local.buckets
  bucket   = "aelio-${each.key}-${var.region}"
  tags     = merge(local.tags, { DataClass = each.key })
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Server-side encryption with the regional KMS key (§13.2).
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

# Versioning (DR + S3-versioning RPO support, §12.5).
resource "aws_s3_bucket_versioning" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Lifecycle: expire old noncurrent versions to control cost.
resource "aws_s3_bucket_lifecycle_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    id     = "expire-noncurrent"
    status = "Enabled"
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# --- Cross-region replication for exports- and recordings- (DR) ------------
# Replication role (stub; bucket policies/grants elaborated in real impl).
resource "aws_iam_role" "replication" {
  count = var.replication_destination_region == null ? 0 : 1
  name  = "aelio-s3-replication-${var.region}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_s3_bucket_replication_configuration" "this" {
  # Only for buckets flagged replicate=true and when a destination is set.
  for_each = var.replication_destination_region == null ? {} : {
    for k, v in local.buckets : k => v if v.replicate
  }

  role   = aws_iam_role.replication[0].arn
  bucket = aws_s3_bucket.this[each.key].id

  rule {
    id     = "dr-replication"
    status = "Enabled"
    filter {}
    delete_marker_replication {
      status = "Enabled"
    }
    destination {
      # Destination bucket lives in the DR region (created by that region's
      # stack); ARN is passed in.
      bucket        = "arn:aws:s3:::aelio-${each.key}-${var.replication_destination_region}"
      storage_class = "STANDARD"
      encryption_configuration {
        replica_kms_key_id = var.replication_destination_kms_key_arn
      }
    }
    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
    }
  }

  depends_on = [aws_s3_bucket_versioning.this]
}
