output "pagerduty_topic_arn" {
  value = aws_sns_topic.pagerduty.arn
}

output "slack_topic_arn" {
  value = aws_sns_topic.slack.arn
}

output "cluster_log_group_name" {
  value = aws_cloudwatch_log_group.cluster.name
}

output "datadog_secret_arn" {
  value = aws_secretsmanager_secret.datadog.arn
}
