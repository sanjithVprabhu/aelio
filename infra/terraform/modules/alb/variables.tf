variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener."
  type        = string
}

variable "waf_web_acl_arn" {
  description = "Regional WAFv2 web ACL ARN to associate (null to skip)."
  type        = string
  default     = null
}

variable "access_logs_bucket" {
  description = "S3 bucket for ALB access logs (null to disable)."
  type        = string
  default     = null
}

variable "enable_deletion_protection" {
  type    = bool
  default = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
