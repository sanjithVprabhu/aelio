variable "name" {
  description = "Name prefix for VPC resources (e.g. aelio-prod-us-east-1)."
  type        = string
}

variable "region" {
  description = "AWS region for this isolated deployment."
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR block (10.x.0.0/16 per region; §12.1)."
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "AZs to span (3 for prod HA)."
  type        = list(string)
}

variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
  default     = {}
}
