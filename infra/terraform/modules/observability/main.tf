# modules/observability — Telemetry plumbing (§13.1).
#
# App telemetry lands in Datadog (APM traces, logs via Fluent Bit, metrics via
# the Datadog agent) and Langfuse (LLM traces in packages/llm). This module
# provisions the AWS-side glue: CloudWatch log group for the EKS control plane,
# an SNS topic + CloudWatch alarms that bridge into PagerDuty/Slack per §13.1,
# and the Datadog API-key secret reference. Agents/operators themselves are
# installed in-cluster via Helm (out of scope here).

locals {
  tags = merge(var.tags, { Module = "observability" })
}

# Control-plane / app log group (Fluent Bit also ships app logs to Datadog).
resource "aws_cloudwatch_log_group" "cluster" {
  name              = "/aelio/${var.name}/cluster"
  retention_in_days = 30
  kms_key_id        = var.kms_key_arn
  tags              = local.tags
}

# --- Alert routing ---------------------------------------------------------
# PagerDuty-bound topic (high-severity: latency, error rate, webhook 200-rate,
# LLM provider errors, voice first-audio latency).
resource "aws_sns_topic" "pagerduty" {
  name              = "${var.name}-alerts-pagerduty"
  kms_master_key_id = var.kms_key_arn
  tags              = local.tags
}

# Slack-bound topic (warnings: DB pool > 80%, BullMQ queue depth > 10000).
resource "aws_sns_topic" "slack" {
  name              = "${var.name}-alerts-slack"
  kms_master_key_id = var.kms_key_arn
  tags              = local.tags
}

resource "aws_sns_topic_subscription" "pagerduty" {
  count                  = var.pagerduty_endpoint == null ? 0 : 1
  topic_arn              = aws_sns_topic.pagerduty.arn
  protocol               = "https"
  endpoint               = var.pagerduty_endpoint
  endpoint_auto_confirms = true
}

resource "aws_sns_topic_subscription" "slack" {
  count                  = var.slack_endpoint == null ? 0 : 1
  topic_arn              = aws_sns_topic.slack.arn
  protocol               = "https"
  endpoint               = var.slack_endpoint
  endpoint_auto_confirms = true
}

# --- Example CloudWatch alarms (most SLOs are evaluated in Datadog; these are
#     the AWS-native safety nets) -----------------------------------------
# RDS connection pool proxy: DatabaseConnections > 80% of max_connections.
resource "aws_cloudwatch_metric_alarm" "db_connections" {
  alarm_name          = "${var.name}-rds-connections-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  period              = 60
  threshold           = var.db_connection_alarm_threshold # ~80% of max_connections
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Average"
  alarm_description   = "DB connection pool >80% utilized (§13.1 -> Slack; see db-pool-exhausted runbook)."
  alarm_actions       = [aws_sns_topic.slack.arn]
  ok_actions          = [aws_sns_topic.slack.arn]
  dimensions          = { DBInstanceIdentifier = var.rds_primary_identifier }
  tags                = local.tags
}

# Datadog API key stored in Secrets Manager and injected into the in-cluster agent.
resource "aws_secretsmanager_secret" "datadog" {
  name        = "aelio/${var.name}/datadog-api-key"
  description = "Datadog API key for the in-cluster agent."
  kms_key_id  = var.kms_key_arn
  tags        = local.tags
}
