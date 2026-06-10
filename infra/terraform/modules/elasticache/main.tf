# modules/elasticache — Redis 7, cluster mode, 3 shards x 2 replicas (§12.1).
# Used for sessions, BullMQ, working memory, rate limits.

locals {
  tags = merge(var.tags, { Module = "elasticache" })
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name}-redis"
  subnet_ids = var.data_subnet_ids
  tags       = local.tags
}

resource "aws_security_group" "redis" {
  name        = "${var.name}-redis"
  description = "Redis access from EKS app subnets only."
  vpc_id      = var.vpc_id

  ingress {
    description = "Redis from app subnets"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = var.app_subnet_cidrs
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

resource "aws_elasticache_parameter_group" "this" {
  name   = "${var.name}-redis7"
  family = "redis7"
  # BullMQ relies on keyspace; noeviction avoids silently dropping job data.
  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
  tags = local.tags
}

# Cluster-mode-enabled replication group: 3 shards (node groups) x (1 primary +
# 1 replica) each.
resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "${var.name}-redis"
  description          = "Aelio Redis 7 (sessions, BullMQ, memory, rate limits)"

  engine         = "redis"
  engine_version = var.engine_version # "7.x"
  node_type      = var.node_type
  port           = 6379

  # Cluster mode enabled.
  num_node_groups         = var.num_shards         # 3 shards
  replicas_per_node_group = var.replicas_per_shard # 2 replicas each

  automatic_failover_enabled = true
  multi_az_enabled           = true

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.redis.id]
  parameter_group_name = aws_elasticache_parameter_group.this.name

  # Encryption (§13.2): at rest via KMS, in transit TLS.
  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_arn
  transit_encryption_enabled = true

  snapshot_retention_limit = 7
  snapshot_window          = "02:00-03:00"
  maintenance_window       = "mon:03:00-mon:04:00"

  tags = local.tags
}
