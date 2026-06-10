variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "data_subnet_ids" {
  type = list(string)
}

variable "app_subnet_cidrs" {
  description = "App-subnet CIDRs allowed to reach Redis on 6379."
  type        = list(string)
}

variable "kms_key_arn" {
  description = "KMS key for Redis at-rest encryption."
  type        = string
}

variable "engine_version" {
  type    = string
  default = "7.1"
}

variable "node_type" {
  type    = string
  default = "cache.r6g.large"
}

variable "num_shards" {
  description = "Cluster-mode shard (node group) count."
  type        = number
  default     = 3
}

variable "replicas_per_shard" {
  type    = number
  default = 2
}

variable "tags" {
  type    = map(string)
  default = {}
}
