# Aelio Terraform

Infrastructure-as-code for the Aelio platform, matching the topology in
**BUILD_MANUAL Part 12** (and §11.6). This is a **documented skeleton** — review,
fill in account-specific values, and `plan` before any `apply`.

> Each AWS region is a **fully isolated deployment**. There is no cross-region
> data flow at runtime — only async backups / DR replication (§12.1, §12.5).

## Layout

```
infra/terraform/
├── modules/                  # Reusable building blocks (no provider/backend)
│   ├── vpc/                  # VPC: public / private-app / private-data subnets,
│   │                         #   NAT per AZ, S3+KMS+ECR VPC endpoints
│   ├── eks/                  # EKS control plane + general & voice node groups
│   │                         #   (voice tainted), IRSA OIDC provider
│   ├── rds/                  # Postgres 16 Multi-AZ + read replicas, pgvector note
│   ├── elasticache/          # Redis 7 cluster-mode (3 shards x 2 replicas)
│   ├── s3-tenant-data/       # uploads/exports/recordings buckets, SSE-KMS,
│   │                         #   versioning, cross-region replication (DR)
│   ├── kms/                  # Regional master key (tenant envelope encryption)
│   ├── alb/                  # Public ALB, TLS 1.3 listener, WAF association
│   └── observability/        # Log groups, SNS (PagerDuty/Slack), CW alarms
├── environments/             # One Terraform ROOT (state) per region
│   ├── staging-us-east-1/    #   smaller sizing, no DR replication
│   ├── prod-us-east-1/
│   ├── prod-eu-west-1/       #   EU data residency; DR target for us-east-1
│   └── prod-ap-south-1/      #   APAC data residency
└── shared/                   # Global / cross-region resources
    ├── route53/              # Public zone, latency-routed records to ALBs
    └── waf/                  # WAFv2 web ACL: OWASP CRS + webhook rate limiting
```

Each environment directory contains:

- `main.tf` — composition root: wires the `../../modules/*` together.
- `variables.tf` — input variables with per-region defaults.
- `backend.tf` — S3 remote state + DynamoDB lock table for that region.
- `terraform.tfvars.example` — copy to `terraform.tfvars` and fill in.

## Prerequisites (bootstrap, once per region)

The S3 backend buckets and the DynamoDB lock table referenced in each
`backend.tf` must exist **before** `terraform init`. Create them out-of-band
(a small bootstrap stack or the AWS CLI):

- S3 bucket `aelio-tfstate-<region>` (versioned, SSE-KMS, public access blocked)
- DynamoDB table `aelio-tfstate-locks` (partition key `LockID`, string)

You also need, per region:

- An **ACM certificate** in the region for the ALB HTTPS listener.
- A **WAF web ACL** (apply `shared/waf` per region; pass its `web_acl_arn`).

## Usage — per environment

```bash
# From the chosen environment directory, e.g.:
cd infra/terraform/environments/prod-us-east-1

# 1. Provide variables (never commit the real file).
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars

# 2. Initialize the backend + download providers/modules.
terraform init

# 3. Review the plan.
terraform plan -var-file=terraform.tfvars

# 4. Apply (Terraform's graph orders KMS -> data stores -> EKS -> ALB).
terraform apply -var-file=terraform.tfvars
```

Repeat for each environment directory. Region rollout order for prod mirrors
the CI/CD promotion path (§12.4): **us-east-1 → eu-west-1 → ap-south-1**.

## Shared resources

`shared/waf` is **regional** (WAFv2 attached to an ALB must be regional). Apply
it once per region and feed the resulting `web_acl_arn` into that region's
`acm_certificate_arn`/`waf_web_acl_arn` tfvars.

`shared/route53` is **global** (single state). After the regional ALBs exist,
apply it with a `region_albs` map of each region's `alb_dns_name` / `alb_zone_id`
(read from the environment outputs / remote state) to publish latency-routed
`api.`, `admin.`, and `verify.` records.

```bash
cd infra/terraform/shared/waf   && terraform init && terraform apply -var region=us-east-1
cd infra/terraform/shared/route53 && terraform init && terraform apply -var domain_name=example.com
```

## Notes & caveats

- **pgvector**: RDS Postgres 16 ships the `vector` extension in its available
  list; enable it in-database via the app's migrations
  (`CREATE EXTENSION IF NOT EXISTS vector;`). See `modules/rds/main.tf`.
- **Secrets**: no application secrets live here. They are stored in AWS Secrets
  Manager and synced into Kubernetes via External Secrets (see `infra/k8s/`).
- **DR (§12.5)**: RPO 5 min (continuous WAL + S3 versioning), RTO 1 hr (warm
  Multi-AZ standby). Cross-region failover is a manual V2 cutover — see
  `infra/runbooks/dr.md`.
- This skeleton has **not** been `terraform apply`-ed; treat resource sizing,
  CIDRs, and IAM scoping as starting points to harden before production use.
```
