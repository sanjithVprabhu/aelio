# modules/vpc — Per-region VPC (§12.1).
#
# Layout (10.x.0.0/16):
#   - Public subnets (3 AZs)        -> ALB, NAT gateways
#   - Private app subnets (3 AZs)   -> EKS nodes
#   - Private data subnets (3 AZs)  -> RDS, ElastiCache
#   - VPC endpoints for S3/KMS/ECR  -> no NAT egress for AWS services
#
# Each region is a fully isolated deployment; no cross-region runtime data flow.

locals {
  az_count = length(var.availability_zones)

  # /16 carved into /20 public, /19 app, /20 data blocks (illustrative).
  public_subnet_cidrs = [for i in range(local.az_count) : cidrsubnet(var.cidr_block, 4, i)]
  app_subnet_cidrs    = [for i in range(local.az_count) : cidrsubnet(var.cidr_block, 3, i + 4)]
  data_subnet_cidrs   = [for i in range(local.az_count) : cidrsubnet(var.cidr_block, 4, i + 12)]

  tags = merge(var.tags, {
    Module = "vpc"
    Region = var.region
  })
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(local.tags, { Name = "${var.name}-vpc" })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-igw" })
}

# --- Public subnets (ALB + NAT) -------------------------------------------
resource "aws_subnet" "public" {
  count                   = local.az_count
  vpc_id                  = aws_vpc.this.id
  availability_zone       = var.availability_zones[count.index]
  cidr_block              = local.public_subnet_cidrs[count.index]
  map_public_ip_on_launch = true
  tags = merge(local.tags, {
    Name                     = "${var.name}-public-${count.index}"
    "kubernetes.io/role/elb" = "1" # ALB target discovery
    Tier                     = "public"
  })
}

# --- Private app subnets (EKS nodes) --------------------------------------
resource "aws_subnet" "app" {
  count             = local.az_count
  vpc_id            = aws_vpc.this.id
  availability_zone = var.availability_zones[count.index]
  cidr_block        = local.app_subnet_cidrs[count.index]
  tags = merge(local.tags, {
    Name                              = "${var.name}-app-${count.index}"
    "kubernetes.io/role/internal-elb" = "1"
    Tier                              = "app"
  })
}

# --- Private data subnets (RDS + ElastiCache) -----------------------------
resource "aws_subnet" "data" {
  count             = local.az_count
  vpc_id            = aws_vpc.this.id
  availability_zone = var.availability_zones[count.index]
  cidr_block        = local.data_subnet_cidrs[count.index]
  tags              = merge(local.tags, { Name = "${var.name}-data-${count.index}", Tier = "data" })
}

# --- NAT (one per AZ for HA egress from private app subnets) ---------------
resource "aws_eip" "nat" {
  count  = local.az_count
  domain = "vpc"
  tags   = merge(local.tags, { Name = "${var.name}-nat-${count.index}" })
}

resource "aws_nat_gateway" "this" {
  count         = local.az_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = merge(local.tags, { Name = "${var.name}-nat-${count.index}" })
  depends_on    = [aws_internet_gateway.this]
}

# --- Route tables ----------------------------------------------------------
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = merge(local.tags, { Name = "${var.name}-rt-public" })
}

resource "aws_route_table_association" "public" {
  count          = local.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = local.az_count
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[count.index].id
  }
  tags = merge(local.tags, { Name = "${var.name}-rt-private-${count.index}" })
}

resource "aws_route_table_association" "app" {
  count          = local.az_count
  subnet_id      = aws_subnet.app[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

resource "aws_route_table_association" "data" {
  count          = local.az_count
  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# --- VPC endpoints (keep AWS-service traffic off NAT) ----------------------
# Gateway endpoint for S3.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat(aws_route_table.private[*].id, [aws_route_table.public.id])
  tags              = merge(local.tags, { Name = "${var.name}-vpce-s3" })
}

# Interface endpoints for KMS + ECR (api/pull paths).
resource "aws_vpc_endpoint" "interface" {
  for_each            = toset(["kms", "ecr.api", "ecr.dkr"])
  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${var.region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.app[*].id
  private_dns_enabled = true
  tags                = merge(local.tags, { Name = "${var.name}-vpce-${each.value}" })
}
