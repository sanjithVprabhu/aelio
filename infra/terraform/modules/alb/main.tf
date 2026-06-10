# modules/alb — Application Load Balancer fronting the EKS workloads (§11.6).
#
# Internet -> WAF (shared/waf) -> ALB -> {admin, api, voice-worker}. In practice
# the AWS Load Balancer Controller in EKS provisions target groups from Ingress
# objects; this module creates the shared ALB + HTTPS listener + a default
# target group so DNS/WAF/ACM wiring has a stable resource to attach to.

locals {
  tags = merge(var.tags, { Module = "alb" })
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public ingress 443 (TLS 1.3) to ALB; 80 redirects to 443."
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTP (redirect only)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.tags
}

resource "aws_lb" "this" {
  name                       = "${var.name}-alb"
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = var.public_subnet_ids
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = var.enable_deletion_protection

  access_logs {
    bucket  = var.access_logs_bucket
    prefix  = "alb/${var.name}"
    enabled = var.access_logs_bucket != null
  }

  tags = local.tags
}

# Default target group (api). App-specific groups are bound by the EKS LB
# controller via TargetGroupBinding; this is the catch-all/default action.
resource "aws_lb_target_group" "default" {
  name        = "${var.name}-api"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  tags = local.tags
}

# HTTP -> HTTPS redirect.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# HTTPS listener — TLS 1.3 policy (§13.2 "TLS 1.3 only").
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.default.arn
  }
}

# Associate the WAF web ACL (created in shared/waf) with this ALB.
resource "aws_wafv2_web_acl_association" "this" {
  count        = var.waf_web_acl_arn == null ? 0 : 1
  resource_arn = aws_lb.this.arn
  web_acl_arn  = var.waf_web_acl_arn
}
