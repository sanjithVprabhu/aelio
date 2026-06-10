# modules/eks — EKS cluster with two managed node groups (§12.1).
#
#   - general: m6i.xlarge, 3–20 nodes (api, admin, channel-worker, eval-runner)
#   - voice:   c6i.2xlarge, 2–10 nodes, TAINTED for voice-worker
#   - Karpenter handles spot fallback on the general pool (installed separately
#     via Helm/addon; IAM + provisioner CRDs out of scope for this stub).

locals {
  tags = merge(var.tags, { Module = "eks" })
}

# --- Cluster IAM role ------------------------------------------------------
resource "aws_iam_role" "cluster" {
  name = "${var.cluster_name}-cluster"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "eks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "cluster" {
  for_each   = toset(["AmazonEKSClusterPolicy", "AmazonEKSVPCResourceController"])
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/${each.value}"
}

# --- Control plane ---------------------------------------------------------
resource "aws_eks_cluster" "this" {
  name     = var.cluster_name
  role_arn = aws_iam_role.cluster.arn
  version  = var.kubernetes_version

  vpc_config {
    subnet_ids              = concat(var.app_subnet_ids, var.public_subnet_ids)
    endpoint_private_access = true
    endpoint_public_access  = true # restrict via public_access_cidrs in prod
    public_access_cidrs     = var.public_access_cidrs
  }

  # Envelope-encrypt Kubernetes secrets with the regional KMS key (§13.2).
  encryption_config {
    resources = ["secrets"]
    provider {
      key_arn = var.kms_key_arn
    }
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]

  tags       = local.tags
  depends_on = [aws_iam_role_policy_attachment.cluster]
}

# --- Node IAM role ---------------------------------------------------------
resource "aws_iam_role" "node" {
  name = "${var.cluster_name}-node"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "node" {
  for_each = toset([
    "AmazonEKSWorkerNodePolicy",
    "AmazonEKS_CNI_Policy",
    "AmazonEC2ContainerRegistryReadOnly",
  ])
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/${each.value}"
}

# --- General node group (m6i.xlarge, 3–20) ---------------------------------
resource "aws_eks_node_group" "general" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "general"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = var.app_subnet_ids
  instance_types  = ["m6i.xlarge"]
  capacity_type   = "ON_DEMAND" # Karpenter provisions spot fallback separately

  scaling_config {
    desired_size = 3
    min_size     = 3
    max_size     = 20
  }

  update_config {
    max_unavailable = 1
  }

  labels = { "aelio.dev/node-pool" = "general" }
  tags   = merge(local.tags, { "NodePool" = "general" })

  depends_on = [aws_iam_role_policy_attachment.node]
}

# --- Voice node group (c6i.2xlarge, 2–10, tainted) -------------------------
resource "aws_eks_node_group" "voice" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "voice"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = var.app_subnet_ids
  instance_types  = ["c6i.2xlarge"]
  capacity_type   = "ON_DEMAND" # voice cannot tolerate spot interruption mid-call

  scaling_config {
    desired_size = 2
    min_size     = 2
    max_size     = 10
  }

  # Taint so only voice-worker (with matching toleration) schedules here.
  taint {
    key    = "aelio.dev/voice"
    value  = "true"
    effect = "NO_SCHEDULE"
  }

  labels = { "aelio.dev/node-pool" = "voice" }
  tags   = merge(local.tags, { "NodePool" = "voice" })

  depends_on = [aws_iam_role_policy_attachment.node]
}

# --- OIDC provider for IRSA (External Secrets, ALB controller, etc.) -------
data "tls_certificate" "oidc" {
  url = aws_eks_cluster.this.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "this" {
  url             = aws_eks_cluster.this.identity[0].oidc[0].issuer
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.oidc.certificates[0].sha1_fingerprint]
  tags            = local.tags
}
