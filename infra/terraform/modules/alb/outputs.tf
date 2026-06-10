output "alb_arn" {
  value = aws_lb.this.arn
}

output "alb_dns_name" {
  description = "ALB DNS name (Route53 alias target)."
  value       = aws_lb.this.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone id (for Route53 alias records)."
  value       = aws_lb.this.zone_id
}

output "https_listener_arn" {
  value = aws_lb_listener.https.arn
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}
