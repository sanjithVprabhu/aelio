variable "region" {
  type = string
}

variable "kms_key_arn" {
  description = "Regional KMS key for SSE-KMS on all buckets."
  type        = string
}

variable "replication_destination_region" {
  description = "DR region for exports-/recordings- cross-region replication (null to disable)."
  type        = string
  default     = null
}

variable "replication_destination_kms_key_arn" {
  description = "KMS key ARN in the destination region for replica encryption."
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
