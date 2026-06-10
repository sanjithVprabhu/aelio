output "configuration_endpoint" {
  description = "Cluster-mode configuration endpoint (host:port) for the Redis client."
  value       = aws_elasticache_replication_group.this.configuration_endpoint_address
}

output "redis_security_group_id" {
  value = aws_security_group.redis.id
}
