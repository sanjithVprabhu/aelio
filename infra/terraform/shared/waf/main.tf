# shared/waf — AWS WAFv2 web ACL definitions (§13.2).
#
# OWASP Core Rule Set + custom rules for webhook abuse (rate limit by source IP
# per tenant slug). WAFv2 web ACLs are REGIONAL when attached to an ALB, so in
# practice this config is instantiated per region (the providers below define
# one example region; replicate the aws.<region> provider + resource per region
# the platform runs in). The resulting web_acl ARN is passed to each region's
# alb module via var.waf_web_acl_arn.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "region" {
  description = "Region this regional web ACL is scoped to."
  type        = string
  default     = "us-east-1"
}

variable "webhook_rate_limit" {
  description = "Max requests per 5-min window per source IP on /webhooks/* before block."
  type        = number
  default     = 2000
}

provider "aws" {
  region = var.region
}

resource "aws_wafv2_web_acl" "alb" {
  name        = "aelio-${var.region}-alb"
  description = "Aelio ALB protection: OWASP CRS + webhook abuse rate limiting."
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # --- AWS Managed: OWASP Core Rule Set ------------------------------------
  rule {
    name     = "aws-common-owasp-crs"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "owasp-crs"
      sampled_requests_enabled   = true
    }
  }

  # --- AWS Managed: Known bad inputs ---------------------------------------
  rule {
    name     = "aws-known-bad-inputs"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # --- Custom: webhook abuse rate limit by source IP -----------------------
  # Scoped to /webhooks/* paths (per-tenant slug is in the path; IP-based
  # rate limiting bounds abuse against any single tenant's webhook endpoint).
  rule {
    name     = "webhook-rate-limit"
    priority = 10
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.webhook_rate_limit
        aggregate_key_type = "IP"
        scope_down_statement {
          byte_match_statement {
            positional_constraint = "STARTS_WITH"
            search_string         = "/webhooks/"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "webhook-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "aelio-alb-waf"
    sampled_requests_enabled   = true
  }

  tags = { ManagedBy = "terraform", Scope = "shared-regional" }
}

output "web_acl_arn" {
  description = "Pass to each region's alb module (var.waf_web_acl_arn)."
  value       = aws_wafv2_web_acl.alb.arn
}
