output "vpc_id" {
  description = "VPC id."
  value       = aws_vpc.this.id
}

output "vpc_cidr_block" {
  description = "VPC CIDR block."
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnet ids (ALB, NAT)."
  value       = aws_subnet.public[*].id
}

output "app_subnet_ids" {
  description = "Private app subnet ids (EKS nodes)."
  value       = aws_subnet.app[*].id
}

output "data_subnet_ids" {
  description = "Private data subnet ids (RDS, ElastiCache)."
  value       = aws_subnet.data[*].id
}
