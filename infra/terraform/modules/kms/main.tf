# modules/kms — Regional master key for envelope encryption (§12.1, §1.8).
#
# One master key per region. Tenant data keys are derived per record and cached
# briefly in app memory. This key also backs RDS / ElastiCache / S3 / EKS-secret
# encryption when passed into those modules.

locals {
  tags = merge(var.tags, { Module = "kms" })
}

resource "aws_kms_key" "master" {
  description             = "Aelio ${var.region} master key (tenant envelope encryption)."
  deletion_window_in_days = 30
  enable_key_rotation     = true # annual AWS-managed rotation of backing key
  multi_region            = false # per-region isolation (§12.1)

  # Key policy: account admin + allow the app role to GenerateDataKey/Decrypt.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "RootAccountAdmin"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "AppEnvelopeUse"
        Effect    = "Allow"
        Principal = { AWS = var.app_role_arns }
        Action = [
          "kms:GenerateDataKey",
          "kms:Decrypt",
          "kms:DescribeKey",
        ]
        Resource = "*"
        # Tenant-scoped encryption context is asserted by the app at call time.
      },
    ]
  })

  tags = local.tags
}

resource "aws_kms_alias" "master" {
  name          = "alias/aelio-${var.region}-master"
  target_key_id = aws_kms_key.master.key_id
}
