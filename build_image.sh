#!/bin/bash

export $(grep -v '^#' .env | xargs)
export $(grep -v '^#' .env.local | xargs)

aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

TAG=${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:latest

echo ${TAG}

docker buildx create --use

docker buildx build --platform linux/amd64 --push -t ${TAG} -f ./image/Dockerfile ./image
