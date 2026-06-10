# shared/route53 — Global DNS (§12.1).
#
# Lives in a single, shared (global) state — not per-region — because Route53 is
# a global service. Hosts the apex/public zone, latency- or geo-routed records
# pointing at each region's ALB, and the per-tenant verification subdomain
# delegation used by the Enterprise feature (V1.5).
#
# Region ALB DNS names + zone ids are read from each environment's remote state.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  # Route53 is global; us-east-1 is conventional for the management provider.
  region = "us-east-1"
}

variable "domain_name" {
  description = "Public apex domain, e.g. example.com."
  type        = string
}

variable "region_albs" {
  description = <<-EOT
    Map of region key -> { dns_name, zone_id } for each region's ALB. Populate
    from environment remote-state outputs (alb_dns_name / alb_zone_id).
  EOT
  type = map(object({
    dns_name = string
    zone_id  = string
  }))
  default = {}
}

# Public hosted zone for the apex domain.
resource "aws_route53_zone" "public" {
  name = var.domain_name
  tags = { ManagedBy = "terraform", Scope = "shared" }
}

# Latency-based routing: api.<domain> resolves to the closest healthy region.
resource "aws_route53_record" "api" {
  for_each       = var.region_albs
  zone_id        = aws_route53_zone.public.zone_id
  name           = "api.${var.domain_name}"
  type           = "A"
  set_identifier = each.key

  latency_routing_policy {
    region = each.key
  }

  alias {
    name                   = each.value.dns_name
    zone_id                = each.value.zone_id
    evaluate_target_health = true
  }
}

# admin.<domain> -> CloudFront/ALB (one example record; mirror per region/CDN).
resource "aws_route53_record" "admin" {
  for_each       = var.region_albs
  zone_id        = aws_route53_zone.public.zone_id
  name           = "admin.${var.domain_name}"
  type           = "A"
  set_identifier = "admin-${each.key}"

  latency_routing_policy {
    region = each.key
  }

  alias {
    name                   = each.value.dns_name
    zone_id                = each.value.zone_id
    evaluate_target_health = true
  }
}

# verify.<domain> — magic-link verification page host (§ M3 / Part 5).
# Single primary region is fine; shown pointed at us-east-1 if present.
resource "aws_route53_record" "verify" {
  count   = contains(keys(var.region_albs), "us-east-1") ? 1 : 0
  zone_id = aws_route53_zone.public.zone_id
  name    = "verify.${var.domain_name}"
  type    = "A"
  alias {
    name                   = var.region_albs["us-east-1"].dns_name
    zone_id                = var.region_albs["us-east-1"].zone_id
    evaluate_target_health = true
  }
}

output "zone_id" {
  value = aws_route53_zone.public.zone_id
}

output "name_servers" {
  value = aws_route53_zone.public.name_servers
}
