output "primary_endpoint" {
  description = "Writer endpoint (host:port)."
  value       = aws_db_instance.primary.endpoint
}

output "primary_address" {
  value = aws_db_instance.primary.address
}

output "replica_endpoints" {
  description = "Read-replica endpoints (admin dashboard reads)."
  value       = aws_db_instance.replica[*].endpoint
}

output "db_security_group_id" {
  value = aws_security_group.db.id
}

output "master_user_secret_arn" {
  description = "Secrets Manager ARN of the managed master password."
  value       = aws_db_instance.primary.master_user_secret[0].secret_arn
}
