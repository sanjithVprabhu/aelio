terraform {
  backend "s3" {
    bucket         = "aelio-tfstate-ap-south-1"
    key            = "environments/prod-ap-south-1/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "aelio-tfstate-locks"
    encrypt        = true
  }
}
