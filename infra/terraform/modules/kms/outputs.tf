output "key_arn" {
  description = "Master KMS key ARN (passed to rds/elasticache/s3/eks modules)."
  value       = aws_kms_key.master.arn
}

output "key_id" {
  value = aws_kms_key.master.key_id
}

output "alias_name" {
  value = aws_kms_alias.master.name
}
