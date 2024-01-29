import * as dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: `.env.local`, override: true });

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as appscaling from "aws-cdk-lib/aws-applicationautoscaling";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ssm from "aws-cdk-lib/aws-ssm";

export class EcsGpuDemoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const name = "ecs-gpu-demo";
    const instanceType = "g5.xlarge";
    // const instanceType = "g5.12xlarge";
    const keyName = process.env.KEY_NAME;
    const region = cdk.Stack.of(this).region;

    const repository = new ecr.Repository(this, "Repository", {
      repositoryName: "gpu-service",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: name,
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      natGateways: 1,
    });

    const cluster = new ecs.Cluster(this, "Cluster", {
      clusterName: name,
      vpc,
      containerInsights: true,
    });
    new cdk.CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
    });

    // ECS Capacity Provider
    const asg = new autoscaling.AutoScalingGroup(this, "Asg", {
      autoScalingGroupName: `${name}`,
      vpc,
      instanceType: new ec2.InstanceType(instanceType),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.GPU),
      desiredCapacity: 1,
      minCapacity: 1,
      maxCapacity: 3,
    });
    asg.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );
    asg.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy")
    );
    const cp = new ecs.AsgCapacityProvider(this, "Cp", {
      capacityProviderName: "default",
      autoScalingGroup: asg,
      enableManagedTerminationProtection: false,
      canContainersAccessInstanceRole: true,
    });
    cp.autoScalingGroup.addUserData(
      "echo ECS_ENABLE_GPU_SUPPORT=true >> /etc/ecs/ecs.config"
    );
    cluster.addAsgCapacityProvider(cp);

    const securityGroup = new ec2.SecurityGroup(this, "Sg", {
      vpc,
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.allTraffic()
    );
    cp.autoScalingGroup.addSecurityGroup(securityGroup);
    cluster.addAsgCapacityProvider(cp);

    cluster.addDefaultCapacityProviderStrategy([
      { capacityProvider: cp.capacityProviderName, weight: 1 },
    ]);

    // ECS GPU Task
    const gpuTaskExecutionRole = new iam.Role(this, "GpuTaskExecutionRole", {
      roleName: `${name}-gpu-task-execution-role`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    gpuTaskExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy"
      )
    );

    const gptTaskDef = new ecs.Ec2TaskDefinition(this, "GpuTaskDef", {
      executionRole: gpuTaskExecutionRole,
      networkMode: ecs.NetworkMode.AWS_VPC,
    });
    gptTaskDef.addContainer("Gpu", {
      containerName: "gpu",
      image: ecs.ContainerImage.fromRegistry(repository.repositoryUri),
      portMappings: [
        {
          name: "http-metrics",
          containerPort: 9400,
          protocol: ecs.Protocol.TCP,
        },
      ],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "gpu" }),
      cpu: 2048,
      memoryReservationMiB: 4096,
      gpuCount: 1,
    });

    const gpuService = new ecs.Ec2Service(this, "GpuService", {
      cluster,
      serviceName: "gpu-service",
      taskDefinition: gptTaskDef,
      enableExecuteCommand: true,
      desiredCount: 1,
      capacityProviderStrategies: [
        { capacityProvider: cp.capacityProviderName, weight: 1 },
      ],
      securityGroups: [securityGroup],
    });

    // ECS ADOT Task
    new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/aws/ecs/containerinsights/${name}/prometheus`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const adotParameter = new ssm.StringParameter(this, "AdotParameter", {
      parameterName: `${name}-adot-config`,
      stringValue: `
      extensions:
        ecs_observer:
          cluster_name: "${name}"
          cluster_region: "${region}"
          result_file: "/etc/ecs_sd_targets.yaml"
          refresh_interval: 60s
          job_label_name: prometheus_job
          services:
            - name_pattern: "^.*gpu-service$"
              metrics_ports:
                - 9400
              job_name: gpu-prometheus-exporter
      receivers:
        prometheus:
          config:
            scrape_configs:
              - job_name: "ecssd"
                file_sd_configs:
                  - files:
                      - "/etc/ecs_sd_targets.yaml"
                relabel_configs:
                  - source_labels: [__meta_ecs_cluster_name]
                    action: replace
                    target_label: ClusterName
                  - source_labels: [__meta_ecs_service_name]
                    action: replace
                    target_label: ServiceName
                  - source_labels: [__meta_ecs_task_definition_family]
                    action: replace
                    target_label: TaskDefinitionFamily
                  - source_labels: [__meta_ecs_task_launch_type]
                    action: replace
                    target_label: LaunchType
                  - source_labels: [__meta_ecs_container_name]
                    action: replace
                    target_label: container_name
                  - action: labelmap
                    regex: ^__meta_ecs_container_labels_(.+)$
                    replacement: "$$1"
      processors:
        resource:
          attributes:
            - key: receiver
              value: "prometheus"
              action: insert
        metricstransform:
          transforms:
            - include: ".*"
              match_type: regexp
              action: update
              operations:
                - label: prometheus_job
                  new_label: job
                  action: update_label

      exporters:
        awsemf:
          namespace: ECS/ContainerInsights/Prometheus
          log_group_name: "/aws/ecs/containerinsights/${name}/prometheus"
          dimension_rollup_option: NoDimensionRollup
          metric_declarations:
            - dimensions: [[ClusterName, ServiceName]]
              label_matchers:
                - label_names:
                    - ServiceName
                  regex: "^.*gpu-service$"
              metric_name_selectors:
                - "DCGM_FI_DEV_GPU_UTIL"
                - "DCGM_FI_DEV_GPU_TEMP"
      service:
        extensions: [ecs_observer]
        pipelines:
          metrics:
            receivers: [prometheus]
            processors: [resource, metricstransform]
            exporters: [awsemf]
            `,
    });

    const adotTaskDef = new ecs.Ec2TaskDefinition(this, "AdotTaskDef", {
      networkMode: ecs.NetworkMode.AWS_VPC,
    });
    adotTaskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: [
          "ec2:DescribeInstances",
          "ecs:ListTasks",
          "ecs:ListServices",
          "ecs:DescribeContainerInstances",
          "ecs:DescribeServices",
          "ecs:DescribeTasks",
          "ecs:DescribeTaskDefinition",
        ],
      })
    );
    adotTaskDef.addContainer("Adot", {
      containerName: "adot",
      // https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/5373
      image: ecs.ContainerImage.fromRegistry(
        "amazon/aws-otel-collector:v0.11.0"
      ),
      secrets: {
        AOT_CONFIG_CONTENT: ecs.Secret.fromSsmParameter(adotParameter),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "adot" }),
      cpu: 256,
      memoryReservationMiB: 512,
    });
    new ecs.Ec2Service(this, "AdotService", {
      cluster,
      serviceName: "adot",
      taskDefinition: adotTaskDef,
      enableExecuteCommand: true,
      desiredCount: 1,
      capacityProviderStrategies: [
        { capacityProvider: cp.capacityProviderName, weight: 1 },
      ],
    });

    // App Scalling
    const target = new appscaling.ScalableTarget(this, "ScalableTarget", {
      serviceNamespace: appscaling.ServiceNamespace.ECS,
      scalableDimension: "ecs:service:DesiredCount",
      resourceId: `service/${cluster.clusterName}/${gpuService.serviceName}`,
      minCapacity: 1,
      maxCapacity: 3,
    });

    new appscaling.TargetTrackingScalingPolicy(this, "ScalingPolicy", {
      scalingTarget: target,
      policyName: name,
      targetValue: 75,
      scaleOutCooldown: cdk.Duration.minutes(1),
      scaleInCooldown: cdk.Duration.minutes(1),
      customMetric: new cloudwatch.Metric({
        namespace: "ECS/ContainerInsights/Prometheus",
        metricName: "DCGM_FI_DEV_GPU_UTIL",
        dimensionsMap: {
          ClusterName: name,
          ServiceName: "gpu-service",
        },
        statistic: cloudwatch.Stats.AVERAGE,
        period: cdk.Duration.minutes(1),
      }),
      disableScaleIn: false,
    });

    // // Dev VM
    // const vmRole = new iam.Role(this, "VmRole", {
    //   assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    // });

    // vmRole.addManagedPolicy(
    //   iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    // );

    // const instance = new ec2.Instance(this, "Instance", {
    //   instanceName: name,
    //   vpc,
    //   vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    //   instanceType: ec2.InstanceType.of(
    //     ec2.InstanceClass.G4DN,
    //     ec2.InstanceSize.XLARGE
    //   ),
    //   machineImage: ec2.MachineImage.genericLinux({
    //     "us-east-1": "ami-02ea7c238b7ba36af",
    //   }),
    //   role: vmRole,
    //   keyName,
    //   blockDevices: [
    //     {
    //       deviceName: "/dev/sda1",
    //       volume: ec2.BlockDeviceVolume.ebs(1000),
    //     },
    //   ],
    // });

    // new cdk.CfnOutput(this, "InstanceId", { value: instance.instanceId });
  }
}
