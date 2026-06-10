# Remote state for staging-us-east-1. The S3 bucket + DynamoDB lock table are
# created once, out-of-band (bootstrap), and shared across environments via
# distinct `key` paths. State is encrypted with SSE-KMS.
terraform {
  backend "s3" {
    bucket         = "aelio-tfstate-us-east-1"
    key            = "environments/staging-us-east-1/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "aelio-tfstate-locks"
    encrypt        = true
  }
}
