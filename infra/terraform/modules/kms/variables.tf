variable "region" {
  type = string
}

variable "account_id" {
  description = "AWS account id for the key policy root principal."
  type        = string
}

variable "app_role_arns" {
  description = "IAM role ARNs (IRSA) permitted to GenerateDataKey/Decrypt."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
