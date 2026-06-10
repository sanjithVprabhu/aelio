variable "name" {
  type = string
}

variable "kms_key_arn" {
  description = "KMS key for log-group + SNS + secret encryption."
  type        = string
}

variable "rds_primary_identifier" {
  description = "RDS primary instance identifier for the connection alarm."
  type        = string
}

variable "db_connection_alarm_threshold" {
  description = "Absolute DatabaseConnections threshold (~80% of max_connections)."
  type        = number
  default     = 400
}

variable "pagerduty_endpoint" {
  description = "PagerDuty events HTTPS endpoint for the high-severity SNS topic."
  type        = string
  default     = null
}

variable "slack_endpoint" {
  description = "Slack (chatbot/Lambda) HTTPS endpoint for the warning SNS topic."
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
