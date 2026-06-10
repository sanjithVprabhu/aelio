variable "name" {
  description = "Name prefix (e.g. aelio-prod-us-east-1)."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "data_subnet_ids" {
  description = "Private data subnet ids for the DB subnet group."
  type        = list(string)
}

variable "app_subnet_cidrs" {
  description = "App-subnet CIDRs allowed to reach Postgres on 5432."
  type        = list(string)
}

variable "kms_key_arn" {
  description = "KMS key for storage encryption at rest."
  type        = string
}

variable "engine_version" {
  type    = string
  default = "16.4"
}

variable "instance_class" {
  type    = string
  default = "db.r6g.xlarge"
}

variable "replica_instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "read_replica_count" {
  type    = number
  default = 2
}

variable "allocated_storage" {
  type    = number
  default = 100
}

variable "max_allocated_storage" {
  type    = number
  default = 1000
}

variable "max_connections" {
  description = "Postgres max_connections (pair with app pool sizing; see db-pool-exhausted runbook)."
  type        = number
  default = 500
}

variable "db_name" {
  type    = string
  default = "aelio"
}

variable "master_username" {
  type    = string
  default = "aelio_admin"
}

variable "tags" {
  type    = map(string)
  default = {}
}
