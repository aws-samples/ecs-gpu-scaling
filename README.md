# Amazon ECS Auto Scaling for GPU-based Machine Learning Workloads 

This repository is intended for engineers looking to horizontally scale GPU-based Machine Learning (ML) workloads on Amazon ECS. This example is for demonstrative purposes only and is not intended for production use. 

## How it works

![](/img/diagram.png)

* By default, GPU utilization metrics are **not** part of the [predefined metrics](https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html) available with [Application Autoscaling](https://docs.aws.amazon.com/autoscaling/application/userguide/what-is-application-auto-scaling.html). 

* As such, you implement auto scaling based on custom metrics. See [Autoscaling Amazon ECS services based on custom metrics with Application Auto Scaling](https://aws.amazon.com/blogs/containers/autoscaling-amazon-ecs-services-based-on-custom-metrics-with-application-auto-scaling/)

* For NVIDIA-based GPUs, you use [DCGM-Exporter](https://github.com/NVIDIA/dcgm-exporter) in your container to expose GPU metrics. You can then use metrics such as `DCGM_FI_DEV_GPU_UTIL` and `DCGM_FI_DEV_GPU_TEMP` to determine your auto scaling behavior. Learn more about [NVIDIA DGCM](https://developer.nvidia.com/dcgm).

## Setup

- Fill the proper values on the `.env` file.

- Install [AWS CDK](https://aws.amazon.com/getting-started/guides/setup-cdk/module-two/).

- Use AWS CDK to deploy the AWS infrastructure.

```
cdk deploy --require-approval never
```

- Build and push image to Amazon ECR.

```
./build_image.sh

```

- Open 2 terminal session and exec into the ECS task.

```
TASK_ARN=
aws ecs execute-command \
  --region us-east-1 \
  --cluster ecs-gpu-demo \
  --task ${TASK_ARN} \
  --container gpu \
  --command "/bin/bash" \
  --interactive
```

- On one terminal, watch the GPU utilization.

```
watch -n0.1 nvidia-smi
```

- On the other terminal, stress test the GPU.

```
python3 test.py
```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.