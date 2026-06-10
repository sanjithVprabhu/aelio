variable "environment" {
  type    = string
  default = "staging"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.10.0.0/16"
}

variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "kubernetes_version" {
  type    = string
  default = "1.30"
}

variable "app_role_arns" {
  description = "IRSA role ARNs allowed to use the KMS key for envelope encryption."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "ACM cert for the ALB HTTPS listener."
  type        = string
}

variable "waf_web_acl_arn" {
  description = "Regional WAF web ACL ARN (from shared/waf for this region)."
  type        = string
  default     = null
}

variable "pagerduty_endpoint" {
  type    = string
  default = null
}

variable "slack_endpoint" {
  type    = string
  default = null
}
