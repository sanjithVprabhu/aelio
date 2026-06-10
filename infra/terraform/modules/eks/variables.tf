variable "cluster_name" {
  description = "EKS cluster name (e.g. aelio-prod-us-east-1)."
  type        = string
}

variable "kubernetes_version" {
  description = "EKS control-plane Kubernetes version."
  type        = string
  default     = "1.30"
}

variable "app_subnet_ids" {
  description = "Private app subnet ids for node groups."
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Public subnet ids (for control-plane ENIs / ALB)."
  type        = list(string)
}

variable "public_access_cidrs" {
  description = "CIDRs allowed to reach the public API server endpoint."
  type        = list(string)
  default     = ["0.0.0.0/0"] # tighten in prod (office/VPN egress)
}

variable "kms_key_arn" {
  description = "Regional KMS key ARN used to envelope-encrypt K8s secrets."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
