variable "environment" {
  type    = string
  default = "prod"
}

variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.30.0.0/16"
}

variable "availability_zones" {
  type    = list(string)
  default = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
}

variable "kubernetes_version" {
  type    = string
  default = "1.30"
}

variable "app_role_arns" {
  type    = list(string)
  default = []
}

variable "acm_certificate_arn" {
  type = string
}

variable "waf_web_acl_arn" {
  type    = string
  default = null
}

variable "dr_destination_region" {
  type    = string
  default = "us-east-1"
}

variable "dr_destination_kms_key_arn" {
  type    = string
  default = null
}

variable "pagerduty_endpoint" {
  type    = string
  default = null
}

variable "slack_endpoint" {
  type    = string
  default = null
}
