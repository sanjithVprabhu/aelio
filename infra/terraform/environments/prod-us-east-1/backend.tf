terraform {
  backend "s3" {
    bucket         = "aelio-tfstate-us-east-1"
    key            = "environments/prod-us-east-1/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "aelio-tfstate-locks"
    encrypt        = true
  }
}
