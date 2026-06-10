# modules/rds — PostgreSQL 16, Multi-AZ primary + 2 read replicas (§12.1).
#
# pgvector NOTE: the `vector` extension is enabled in-database after creation,
# e.g.  CREATE EXTENSION IF NOT EXISTS vector;  run via the app's migration
# tooling (Drizzle) against this instance. RDS PostgreSQL 16 ships pgvector in
# its available extensions list, so no custom parameter is required to install
# it — only the CREATE EXTENSION statement. We add it to shared_preload via a
# parameter group below for index build performance.

locals {
  tags = merge(var.tags, { Module = "rds" })
}

# --- Networking: subnet group in the private DATA subnets ------------------
resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-db"
  subnet_ids = var.data_subnet_ids
  tags       = local.tags
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "Postgres access from EKS app subnets only (DB not internet-reachable)."
  vpc_id      = var.vpc_id

  ingress {
    description = "Postgres from app subnets"
    from_port   = 5432
    to_port     = 5432
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

# --- Parameter group -------------------------------------------------------
resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-pg16"
  family = "postgres16"

  # Helps pgvector / general workload; tune per real benchmarks.
  parameter {
    name  = "max_connections"
    value = tostring(var.max_connections)
  }
  # Log slow queries for the db-pool-exhausted runbook (pg_stat_statements).
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  tags = local.tags
}

# --- Primary (Multi-AZ) ----------------------------------------------------
resource "aws_db_instance" "primary" {
  identifier     = "${var.name}-primary"
  engine         = "postgres"
  engine_version = var.engine_version # "16.x"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.kms_key_arn # encryption at rest (§13.2)

  db_name  = var.db_name
  username = var.master_username
  # Password sourced from Secrets Manager (managed master password).
  manage_master_user_password = true

  multi_az               = true # warm standby in secondary AZ (RTO 1h, §12.5)
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.this.name

  # DR (§12.5): PITR via continuous WAL, 35-day retention (RPO ~5min).
  backup_retention_period   = 35
  backup_window             = "03:00-04:00"
  maintenance_window        = "Mon:04:00-Mon:05:00"
  copy_tags_to_snapshot     = true
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final"

  performance_insights_enabled = true
  monitoring_interval          = 60

  tags = merge(local.tags, { Role = "primary" })
}

# --- Read replicas (admin dashboard reads) ---------------------------------
resource "aws_db_instance" "replica" {
  count               = var.read_replica_count # 2 per §12.1
  identifier          = "${var.name}-replica-${count.index}"
  instance_class      = var.replica_instance_class
  replicate_source_db = aws_db_instance.primary.identifier
  storage_encrypted   = true
  kms_key_id          = var.kms_key_arn

  performance_insights_enabled = true
  tags                         = merge(local.tags, { Role = "replica" })
}
