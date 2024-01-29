#!/usr/bin/env node
import * as dotenv from "dotenv";
dotenv.config({ path: `.env`, override: true });
dotenv.config({ path: `.env.local`, override: true });

import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { EcsGpuDemoStack } from "../lib/ecs-gpu-demo-stack";

const app = new cdk.App();
new EcsGpuDemoStack(app, "EcsGpuDemoStack", {
  env: {
    account: process.env.AWS_ACCOUNT_ID,
    region: process.env.AWS_REGION || "ap-southeast-1",
  },
});
