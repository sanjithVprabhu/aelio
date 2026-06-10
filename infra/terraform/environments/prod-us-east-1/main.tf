# environments/prod-us-east-1 — production composition for us-east-1.
#
# Fully isolated region (§12.1). Prod sizing: Multi-AZ RDS + 2 read replicas,
# 3-shard Redis, cross-region S3 replication for exports-/recordings- (DR §12.5).
#   terraform init && terraform plan -var-file=terraform.tfvars

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.0" }
    tls = { source = "hashicorp/tls", version = ">= 4.0" }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = local.tags
  }
}

data "aws_caller_identity" "current" {}

locals {
  name = "aelio-${var.environment}-${var.region}"
  tags = {
    Project     = "aelio"
    Environment = var.environment
    Region      = var.region
    ManagedBy   = "terraform"
  }
}

module "kms" {
  source        = "../../modules/kms"
  region        = var.region
  account_id    = data.aws_caller_identity.current.account_id
  app_role_arns = var.app_role_arns
  tags          = local.tags
}

module "vpc" {
  source             = "../../modules/vpc"
  name               = local.name
  region             = var.region
  cidr_block         = var.vpc_cidr
  availability_zones = var.availability_zones
  tags               = local.tags
}

module "eks" {
  source             = "../../modules/eks"
  cluster_name       = local.name
  kubernetes_version = var.kubernetes_version
  app_subnet_ids     = module.vpc.app_subnet_ids
  public_subnet_ids  = module.vpc.public_subnet_ids
  kms_key_arn        = module.kms.key_arn
  tags               = local.tags
}

module "rds" {
  source             = "../../modules/rds"
  name               = local.name
  vpc_id             = module.vpc.vpc_id
  data_subnet_ids    = module.vpc.data_subnet_ids
  app_subnet_cidrs   = [module.vpc.vpc_cidr_block]
  kms_key_arn        = module.kms.key_arn
  instance_class     = "db.r6g.xlarge"
  read_replica_count = 2 # admin dashboard reads (§12.1)
  tags               = local.tags
}

module "elasticache" {
  source           = "../../modules/elasticache"
  name             = local.name
  vpc_id           = module.vpc.vpc_id
  data_subnet_ids  = module.vpc.data_subnet_ids
  app_subnet_cidrs = [module.vpc.vpc_cidr_block]
  kms_key_arn      = module.kms.key_arn
  num_shards       = 3 # 3 shards x 2 replicas (§12.1)
  tags             = local.tags
}

module "s3" {
  source      = "../../modules/s3-tenant-data"
  region      = var.region
  kms_key_arn = module.kms.key_arn
  # DR: replicate exports-/recordings- to the EU region (§12.5).
  replication_destination_region      = var.dr_destination_region
  replication_destination_kms_key_arn = var.dr_destination_kms_key_arn
  tags                                = local.tags
}

module "alb" {
  source            = "../../modules/alb"
  name              = local.name
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  certificate_arn   = var.acm_certificate_arn
  waf_web_acl_arn   = var.waf_web_acl_arn
  tags              = local.tags
}

module "observability" {
  source                 = "../../modules/observability"
  name                   = local.name
  kms_key_arn            = module.kms.key_arn
  rds_primary_identifier = "${local.name}-primary"
  pagerduty_endpoint     = var.pagerduty_endpoint
  slack_endpoint         = var.slack_endpoint
  tags                   = local.tags
}

output "alb_dns_name" { value = module.alb.alb_dns_name }
output "alb_zone_id" { value = module.alb.alb_zone_id }
output "eks_cluster_name" { value = module.eks.cluster_name }
output "rds_primary_endpoint" { value = module.rds.primary_endpoint }
output "redis_configuration_endpoint" { value = module.elasticache.configuration_endpoint }
output "s3_buckets" { value = module.s3.bucket_names }
output "kms_key_arn" { value = module.kms.key_arn }
