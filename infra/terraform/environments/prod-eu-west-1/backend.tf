terraform {
  backend "s3" {
    bucket         = "aelio-tfstate-eu-west-1"
    key            = "environments/prod-eu-west-1/terraform.tfstate"
    region         = "eu-west-1"
    dynamodb_table = "aelio-tfstate-locks"
    encrypt        = true
  }
}
