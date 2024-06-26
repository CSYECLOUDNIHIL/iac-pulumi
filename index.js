"use strict";
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const gcp = require("@pulumi/gcp");
const config=  new pulumi.Config("app");
let publicSubnet = [];
let privateSubnet = [];
const ip = config.get("VPCCidrBlock");
const mailGunApiKey = config.get("mailGunApiKey");
const nodePort = config.get("nodePort");
const instanceType = config.get("instanceType");
const ownerId = config.get("ownerId");
const keyPairName = config.get("keyPairName");
const gcpBucketName = config.get("gcpBucketName");
const gcpRegion = config.get("gcpRegion");
const gcpBucketRole = config.get("gcpBucketRole");
const allocatedStorage = config.get("allocatedstorage");
const databaseName = config.get("databasename");
const lambdaFunctionHandlerName = config.get("lambdaFunctionHandlerName");
const databaseUsername = config.get("databaseusername");
const engine = config.get("engine");
const port = config.get("port");
const project = config.get("project");
const mailGunDomainName = config.get("mailGunDomainName");
const lambdaFunctionPath = config.get("lambdaFunctionPath");
const engineVersion = config.get("engineversion");
const instancetype = config.get("instanceType");
const instanceClass = config.get("instanceclass");
const storageType = config.get("storagetype");
const postgrefamily = config.get("family");
const destinationCidrBlock = config.get("destinationCidrBlock");
const csvLocation = config.get("csvLocation");
const domainName = config.get("domainName");
const secretConfig = new pulumi.Config("iac_pulumi");
const dataPassword = secretConfig.getSecret("dataPassword");
const awsregion = config.get("region");
const statsDPort = config.get("statsDPort");
const rolePolicy = config.get("rolePolicy");
const subnetMaskVar = config.get("subnetMaskVar");
const mailgunGomainName = config.get("mailgunGomainName");
const certificateArn = config.get("certificateArn");


const ipsplit = ip.split('/');
const networkPart = ipsplit[0].split('.');
const subnetMask = ipsplit[1];


async function main() {


    
    
    const snsTopic =  new aws.sns.Topic("snsTopic");



    
    const vpc = new aws.ec2.Vpc("webappVPC", {
        cidrBlock:config.get("VPCCidrBlock") 
    });


    const internetGateway = new aws.ec2.InternetGateway("webappInternetGateway", {
        vpcId: vpc.id, 
        tags: {
            Name: `InternetGateway`,
            Type: "public",
          },
    });


    const publicRouteTable = new aws.ec2.RouteTable("publicRouteTable", {
        vpcId: vpc.id,
        tags: {
            Name: `privateRouteTable`,
            Type: "public",
          },
    });

    const privateRouteTable = new aws.ec2.RouteTable("privateRouteTable", {
        vpcId: vpc.id,
        tags: {
            Name: `privateRouteTable`,
            Type: "public",
          },
    });


    const publicRoute = new aws.ec2.Route("webapp-publicRoute", {
        routeTableId: publicRouteTable.id,
        destinationCidrBlock: config.get("destinationCidrBlock"),
        gatewayId: internetGateway.id,
        tags: {
            Name: `publicRouteGateWay`,
            Type: "public",
          },
        
    });

    
    const publicSubnetFunction = async (i,counter,az) => {
        const cidrBlock = `${networkPart[0]}.${networkPart[1]}.${parseInt(networkPart[2]) + counter}.${networkPart[3]}/${subnetMaskVar}`
        const publicSubnet = new aws.ec2.Subnet(`publicSubnet${counter}`, {
            vpcId: vpc.id,
            availabilityZone: az,
            cidrBlock: cidrBlock,
            tags: {
                Name: `webapp-publicsubnet${i}`,
                Type: "public",
              },
        }); 
        const publicSubnetAssociation = new aws.ec2.RouteTableAssociation(`publicSubnetAssociation${counter}`, {
            subnetId: publicSubnet.id,
            routeTableId: publicRouteTable.id,
        });

        return publicSubnet;
    }

    const privateSubnetFunction = async (i,counter,az) => {
        const cidrBlock = `${networkPart[0]}.${networkPart[1]}.${parseInt(networkPart[2]) + counter+1}.${networkPart[3]}/${subnetMaskVar}`
        const privateSubnet = new aws.ec2.Subnet(`privateSubnet${counter}`, {
            vpcId: vpc.id,
            availabilityZone: az,
            cidrBlock: cidrBlock,
            tags: {
                Name: `webapp-privatesubnet${i}`,
                Type: "private",
              },
        });
        const privateSubnetAssociation = new aws.ec2.RouteTableAssociation(`privateSubnetAssociation${counter}`, {
            subnetId: privateSubnet.id,
            routeTableId: privateRouteTable.id,
        });
        return privateSubnet;
    }

    const azs = await aws.getAvailabilityZones({ state: "available" });

    if (azs.names.length < 2) {
        throw new Error("Expected at least 2 Availability Zones, but found a different number.");
    }
    
    let counter = 1;

    
    for (let i = 0; i < azs.names.length && i < 3 ; i++) {

        const az = azs.names[i];
    
        let publicSubnetId = await publicSubnetFunction(i,counter,az);
        publicSubnet.push(publicSubnetId);
        let privateSubnetId = await privateSubnetFunction(i,counter,az);
        privateSubnet.push(privateSubnetId);
        counter += 2; 
    }

    const loadSecurityGroup = new aws.ec2.SecurityGroup("loadSecurityGroup", {
        vpcId: vpc.id,
        ingress: [
            {
                cidrBlocks: [destinationCidrBlock],
                protocol: "TCP",
                fromPort: 80, 
                toPort: 80,
            },
            {
                
                cidrBlocks: [destinationCidrBlock],
                protocol: "TCP",
                fromPort: 443, 
                toPort: 443,
            },
        ],
        egress: [
            {
                cidrBlocks: [destinationCidrBlock],
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
            }
        ],
        tags: {
            Name: `loadBalancerSecurityGroup`,
            Type: "public",
          },
    });

    const ec2SecurityGroup = new aws.ec2.SecurityGroup("security-group", {
        vpcId: vpc.id,
        ingress: [
            {
                securityGroups: [loadSecurityGroup.id],
                protocol: "TCP",
                fromPort: 22,
                toPort: 22,
            },
/*             {
                cidrBlocks: [destinationCidrBlock],
                protocol: "TCP",
                fromPort: 80, 
                toPort: 80,
            },
            {
                cidrBlocks: [destinationCidrBlock],
                protocol: "TCP",
                fromPort: 443, 
                toPort: 443,
            }, */
            {
                securityGroups: [loadSecurityGroup.id],
                  protocol: "TCP",
                fromPort: nodePort, 
                toPort: nodePort, 
            },
        ],
        egress: [
            {
                cidrBlocks: [destinationCidrBlock],
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
            },
        ],
        tags: {
            Name: `ec2SecurityGroup`,
            Type: "public",
          },
    },{ dependsOn: loadSecurityGroup});

    


    const databaseSecurityGroup = new aws.ec2.SecurityGroup("rds-security-group", {
        vpcId: vpc.id,
        ingress: [
            {
                protocol: "TCP",
                fromPort: port,
                toPort: port,
                securityGroups: [ec2SecurityGroup.id],
                
            }
        ],
        egress: [
            {
                cidrBlocks: [destinationCidrBlock],
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
            },
        ],
        tags: {
            Name: `rdsSecurityGroup`,
            Type: "public",
          },
    },{ dependsOn: ec2SecurityGroup});


    const rdsParameterGroup = new aws.rds.ParameterGroup("rds-parameter-group", {
        family: postgrefamily,
            parameters: [
                {
                    name: 'max_connections',
                    value: '100',
                    applyMethod: "pending-reboot",
                },
        ],
    });

    const dbSubnetGroup = new aws.rds.SubnetGroup("dbsubnetgroup", {
        subnetIds: privateSubnet, 
    });

    const ami = pulumi.output(aws.ec2.getAmi({
        owners: [ ownerId ],
        mostRecent: true,
    }));

    const lambdaIamRole = new aws.iam.Role("lambdaIamRole", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Sid: "AssumeRolePolicy", 
                Principal: {
                    Service: "lambda.amazonaws.com",
                },
            }],
        }),
        tags: {
            Name: `lambdaamRole`,
            Type: "public",
          },
    });
    

    const cloudWatchIamRole = new aws.iam.Role("CWIamRole", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Sid: "AssumeRolePolicy", 
                Principal: {
                    Service: "ec2.amazonaws.com",
                },
            }],
        }),
        tags: {
            Name: `CWIamRole`,
            Type: "public",
          },
    },{ dependsOn: [lambdaIamRole] });
    

    const rolePolicyAttachment = new aws.iam.RolePolicyAttachment("policyAttachment", {
        role: cloudWatchIamRole.name,
        policyArn: rolePolicy,
        tags: {
            Name: `CWpolicyAttachment`,
            Type: "public",
          },
    },{ dependsOn: [cloudWatchIamRole] });

    const SNSPolicy = new aws.iam.Policy("SNSPolicy", {
        policy: {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                     "sns:Publish",
                ],
                "Resource": "*"
            }
        ]
        },
    });

    const SNSec2PolicyAttachment = new aws.iam.RolePolicyAttachment("SNSec2PolicyAttachment", {
        role: cloudWatchIamRole.name,
        policyArn: SNSPolicy.arn,
        tags: {
            Name: `CWpolicyAttachment`,
            Type: "public",
          },
    },{ dependsOn: [cloudWatchIamRole] });
    

    const ec2InstanceProfile = new aws.iam.InstanceProfile("ec2InstanceProfile", {
        name: "ec2InstanceProfile",
        role: cloudWatchIamRole.name, 
        tags: {
            Name: `CWec2InstanceProfile`,
            Type: "public",
          },
    },{ dependsOn: [rolePolicyAttachment] });

     const rdsInstance = new aws.rds.Instance("rds-instance", {
        vpcId: vpc.id,
        engine: engine, 
        engineVersion: engineVersion, 
        instanceClass: instanceClass, 
        allocatedStorage: allocatedStorage,
        storageType: storageType,
        identifier: databaseUsername,
        dbName: databaseName,
        username:databaseUsername,
        password: dataPassword, 
        publiclyAccessible: false,
        skipFinalSnapshot: true, 
        vpcSecurityGroupIds: [databaseSecurityGroup.id], 
        dbSubnetGroupName: dbSubnetGroup.name, 
        parameterGroupName: rdsParameterGroup.name, 
        multiAz: false
    },{ dependsOn: [dbSubnetGroup, databaseSecurityGroup, rdsParameterGroup] });

    const userDataScript = pulumi.interpolate  
    `#!/bin/bash
    cd /opt/csye6225/
    sudo touch .env
    sudo chown csye6225:csye6225 .env
    sudo chmod 750 .env
    echo "DB_DIALECT=${engine}" | sudo tee -a .env
    echo "DB_NAME_PORT=${port}" | sudo tee -a .env
    echo "DB_HOST=${rdsInstance.address}" | sudo tee -a .env
    echo "DB_USERNAME=${databaseUsername}" | sudo tee -a .env
    echo "DB_PASSWORD=${dataPassword}" | sudo tee -a .env
    echo "DB_NAME_CREATED=${databaseName}" | sudo tee -a .env
    echo "DB_NAME_DEFAULT=${databaseName}" | sudo tee -a .env
    echo "DB_LOGGING=false" | sudo tee -a .env
    echo "CSV_LOCATION=${csvLocation}" | sudo tee -a .env
    echo "SERVER_PORT=${nodePort}" | sudo tee -a .env
    echo "STATSD_PORT=${statsDPort}" | sudo tee -a .env
    echo "AWS_SNS_TOPIC=${snsTopic.arn}" | sudo tee -a .env
    echo "AWS_REGION=${awsregion}" | sudo tee -a .env
    sudo systemctl daemon-reload
    sudo systemctl enable healthz-systemd
    sudo systemctl start healthz-systemd
    
    sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -c file:/opt/csye6225/packer/cloudwatch-config.json \
    -s
    sudo systemctl enable amazon-cloudwatch-agent
    sudo systemctl start amazon-cloudwatch-agent
    `
    const ec2InstanceLaunchTemplate = new aws.ec2.LaunchTemplate("ec2InstanceLaunchTemplate", {
        name: "ec2InstanceLaunchTemplate",
        imageId: ami.id,
        instanceType: instanceType,
        networkInterfaces: [{
            associatePublicIpAddress: "true",
            securityGroups: [ec2SecurityGroup.id],
            deleteOnTermination: true
        }],
        iamInstanceProfile: { name: ec2InstanceProfile.name },
/*         vpcSecurityGroupIds: [
            ec2SecurityGroup.id,
        ], */
        tagSpecifications: [{
            resourceType: "instance",
            tags: {
                Name: "Ec2Instance",
            },
        }],
        keyName: keyPairName, 
        userData: userDataScript.apply(script => Buffer.from(script).toString("base64")),
    },{ dependsOn: [ec2InstanceProfile,rdsInstance] });

    const loadBalancerTargetGroup = new aws.lb.TargetGroup("loadBalancerTargetGroup", {
        port: nodePort,
        protocol: "HTTP",
        vpcId: vpc.id,
        targetType: "instance",
        associatePublicIpAddress: true,
        healthCheck: {
            path: "/healthz", 
            port: nodePort,
            protocol: "HTTP",
            timeout: 10,
            unhealthyThreshold: 2,
            healthyThreshold: 2,

        },
    },{dependsOn:ec2InstanceLaunchTemplate});

    const ec2LoadBalancer = new aws.lb.LoadBalancer("ec2LoadBalancer", {
        internal: false,
        loadBalancerType: "application",
        securityGroups: [loadSecurityGroup.id],
        sslPolicy: "ELBSecurityPolicy-2016-08",
        enableHttp2: true,
        subnets: publicSubnet.map(subnet => (subnet.id)),
        enableDeletionProtection: false,
    },{dependsOn:loadBalancerTargetGroup,rdsInstance});



    


    const loadBalancerListener = new aws.lb.Listener("loadBalancerListener", {
        loadBalancerArn: ec2LoadBalancer.arn,
        port: 443,
        protocol: "HTTPS",
        certificateArn: certificateArn,
        defaultActions: [
            {
                type: "forward",
                targetGroupArn: loadBalancerTargetGroup.arn,
            },
        ],
    },{dependsOn:[loadBalancerTargetGroup,ec2LoadBalancer]});
    


    const autoScalingGroup = new aws.autoscaling.Group("autoScalingGroup", {
        //availabilityZones: azs.names,
        name: "autoScalingGroup",
        desiredCapacity: 1,
        maxSize: 3,
        minSize: 1,
        healthCheckType: "EC2",
        healthCheckGracePeriod: 300,
        vpcZoneIdentifiers: publicSubnet.map(subnet => subnet.id),
        forceDelete: true,
        associatePublicIpAddress: true,
        launchTemplate: {
            id: ec2InstanceLaunchTemplate.id,
            version: ec2InstanceLaunchTemplate.latestVersion,
            
        }
        ,targetGroupArns: [loadBalancerTargetGroup.arn],
        vpcId: vpc.id,
    },{dependsOn:[loadBalancerListener]});


    const autoScalingUp = new aws.autoscaling.Policy("autoScalingUp", {
        scalingAdjustment: 1,
        adjustmentType: "ChangeInCapacity",
        cooldown: 60,
        autoscalingGroupName: autoScalingGroup.name,
        name: "scaleupPolicy",
    },{dependsOn:autoScalingGroup});

    const scalingUpcloudWatchMetricAlarm = new aws.cloudwatch.MetricAlarm("scalingUpcloudWatchMetricAlarm", {
        comparisonOperator: "GreaterThanOrEqualToThreshold",
        evaluationPeriods: 1,
        metricName: "CPUUtilization",
        namespace: "AWS/EC2",
        period: 60,
        statistic: "Average",
        threshold: 5,
        //treatMissingData: notBreaching,
        dimensions: {
            AutoScalingGroupName: autoScalingGroup.name,
        },
        alarmDescription: "ec2 cpu utilization",
        alarmActions: [autoScalingUp.arn],
    },{dependsOn:autoScalingUp});


    const autoScalingDown = new aws.autoscaling.Policy("autoScalingDown", {
        scalingAdjustment: -1,
        adjustmentType: "ChangeInCapacity",
        cooldown: 60,
        autoscalingGroupName: autoScalingGroup.name,
        name: "scaleDownPolicy",
    },{dependsOn:autoScalingGroup});

    const scalingDowncloudWatchMetricAlarm = new aws.cloudwatch.MetricAlarm("scalingDowncloudWatchMetricAlarm", {
        comparisonOperator: "LessThanOrEqualToThreshold",
        evaluationPeriods: 1,
        metricName: "CPUUtilization",
        namespace: "AWS/EC2",
        period: 60,
        statistic: "Average",
        threshold: 3,
        //treatMissingData: notBreaching,
        dimensions: {
            AutoScalingGroupName: autoScalingGroup.name,
        },
        alarmDescription: "ec2 cpu utilization",
        alarmActions: [autoScalingDown.arn],
    },{dependsOn:autoScalingDown});


    const selected = aws.route53.getZone({
        name: domainName,
        privateZone: false,
    });
    
    const createRecord = new aws.route53.Record("createRecord", {
        zoneId: selected.then(selected => selected.zoneId),
        name: domainName,
        type: "A",
        aliases: [
            {
                name: ec2LoadBalancer.dnsName,
                zoneId: ec2LoadBalancer.zoneId,
                evaluateTargetHealth: true,
            },
        ],
        tags: {
            Name: `Route53`,
            Type: "public",
        },
    }, { dependsOn: [autoScalingGroup] });
    
    const gcpserviceAccount = new gcp.serviceaccount.Account("gcpserviceAccount", {
        accountId: "service-account-id",
        displayName: "Service Account",
        project: project
    });

    const gcpserviceAccountkey = new gcp.serviceaccount.Key("gcpserviceAccountkey", {
        serviceAccountId: gcpserviceAccount.accountId,
        publicKeyType: "TYPE_X509_PEM_FILE",
    });


/*     const secretGcpserviceAccountkey = new aws.secretsmanager.Secret("secretGcpserviceAccountkey", {
        name: "GcpserviceAccountkeysecret",
        secretString: JSON.stringify({
            key: gcpserviceAccountkey.privateKeyData,
        }),
    },{ dependsOn: [gcpserviceAccountkey] }); */


    const iamBinding = new gcp.projects.IAMBinding("iamBinding", {
        project: gcpserviceAccount.project,
        role: gcpBucketRole,
        members: [pulumi.interpolate`serviceAccount:${gcpserviceAccount.email}`],
    });

    const gcpBucket = new gcp.storage.Bucket("gcpBucket", {
        name: gcpBucketName,
        location: gcpRegion, 
        forceDestroy:true,
        storageClass: "STANDARD",
        uniformBucketLevelAccess:true,
    },{dependsOn : iamBinding});

/*     const lambdaIamRole = new aws.iam.Role("lambdaIamRole", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Sid: "AssumeRolePolicy", 
                Principal: {
                    Service: "lambda.amazonaws.com",
                },
            }],
        }),
        tags: {
            Name: `lambdaamRole`,
            Type: "public",
          },
    });
     */

    
    const lambdaPolicy = new aws.iam.Policy("lambdaPolicy", {
        policy: {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                    "lambda:InvokeFunction",
                ],
                "Resource": "*"
            }
        ]
        },
    });

/*     const SNSPolicy = new aws.iam.Policy("SNSPolicy", {
        policy: {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                     "sns:Publish",
                ],
                "Resource": "*"
            }
        ]
        },
    }); */

    const dynamodbPolicy = new aws.iam.Policy("dynamodbPolicy", {
        policy: {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Action": [
                        "dynamodb:GetItem",
                        "dynamodb:PutItem",
                        "dynamodb:UpdateItem",
                        "dynamodb:BatchWriteItem",
                        "dynamodb:Query",
                        "dynamodb:Scan",
                        "dynamodb:DeleteItem"
                    ],
                    "Resource": "*"
                }
            ]
        },
    });


    const lambdaRolePolicyAttachment = new aws.iam.RolePolicyAttachment("lambdaRolePolicyAttachment", {
        policyArn: lambdaPolicy.arn,
        role: lambdaIamRole.name,
        tags: {
            Name: `lambdaRolePolicyAttachment`,
            Type: "public",
          },
    });

    const SNSPolicyAttachment = new aws.iam.RolePolicyAttachment("SNSPolicyAttachment", {
        role: lambdaIamRole.name,
        policyArn: SNSPolicy.arn,
        tags: {
            Name: `SNSPolicyAttachment`,
            Type: "public",
          },
    },{ dependsOn: [lambdaIamRole] });


    const dynamodbPolicyAttachment = new aws.iam.RolePolicyAttachment("dynamodbPolicyAttachment", {
        policyArn: dynamodbPolicy.arn,
        role: lambdaIamRole.name,
        tags: {
            Name: `dynamodbPolicyAttachment`,
            Type: "public",
          },
    });

    const dynamoDbTable = new aws.dynamodb.Table("dynamoDbTable",{
    attributes: [
        {
            name: "emailId",
            type: "S",
        },
        {
            name: "status",
            type: "S",
        },
        {
            name: "timestamp",
            type: "S",
        }
    ],
    hashKey: "emailId",
    billingMode: "PAY_PER_REQUEST",
    globalSecondaryIndexes: [
        {
            name: "status",
            hashKey: "status",
            projectionType: "ALL",
            readCapacity: 1,
            writeCapacity: 1,
        },
        {
            name: "timestamp",
            hashKey: "timestamp",
            projectionType: "ALL",
            readCapacity: 1,
            writeCapacity: 1,
        }
    ],
    })
    const awslambdaFunction = new aws.lambda.Function("awslambdaFunction", {
        code: new pulumi.asset.AssetArchive({
            ".": new pulumi.asset.FileArchive(lambdaFunctionPath),
        }),
        role: lambdaIamRole.arn,
        handler: lambdaFunctionHandlerName,
        runtime: "nodejs14.x", 
        environment: {
            variables: {
                GCP_BUCKET: gcpBucket.name,  
                GCP_SERVICE_ACCOUNT_KEY: gcpserviceAccountkey.privateKey,
                AWS_DYNAMODB_TABLE: dynamoDbTable.name,
                REGION: awsregion,
                MAIL_GUN_API_KEY:mailGunApiKey,
                MAIL_GUN_DOMOAIN: mailGunDomainName,
            },
        },
        timeout: 60,
    },{ dependsOn: [gcpserviceAccountkey] });

    
    const awslambdaSubscription = new aws.sns.TopicSubscription("awslambdaSubscription", {
        protocol: "lambda",
        endpoint: awslambdaFunction.arn,
        topic: snsTopic.arn,
    });

    const permissiontoTrigger = new aws.lambda.Permission("permissiontoTrigger", {
        action: "lambda:InvokeFunction",
        function: awslambdaFunction.id,
        principal: "sns.amazonaws.com",
        sourceArn: snsTopic.arn
    }); 


    return {
        vpcId: vpc.id,
        internetGatewayId: internetGateway.id,        
        rdsInstanceId: rdsInstance.id,
        //ec2InstanceId: ec2Instance.id,
        createdRecord: createRecord.zoneId,
        //instancePublicIp : ec2Instance.publicIp,
    };
}

module.exports = main();