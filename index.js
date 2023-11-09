"use strict";
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const config=  new pulumi.Config("app");
let publicSubnet = [];
let privateSubnet = [];
const ip = config.get("VPCCidrBlock");
const nodePort = config.get("nodePort");
const instanceType = config.get("instanceType");
const ownerId = config.get("ownerId");
const keyPairName = config.get("keyPairName");
const allocatedStorage = config.get("allocatedstorage");
const databaseName = config.get("databasename");
const databaseUsername = config.get("databaseusername");
const engine = config.get("engine");
const port = config.get("port");
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
const ipsplit = ip.split('/');
const networkPart = ipsplit[0].split('.');
const subnetMask = ipsplit[1];


async function main() {

    
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
        const cidrBlock = `${networkPart[0]}.${networkPart[1]}.${parseInt(networkPart[2]) + counter}.${networkPart[3]}/24`
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
        const cidrBlock = `${networkPart[0]}.${networkPart[1]}.${parseInt(networkPart[2]) + counter+1}.${networkPart[3]}/24`
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

    

    const ec2SecurityGroup = new aws.ec2.SecurityGroup("security-group", {
        vpcId: vpc.id,
        ingress: [
            {
                cidrBlocks: [destinationCidrBlock],
                protocol: "TCP",
                fromPort: 22,
                toPort: 22,
            },
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
            {
                cidrBlocks: [destinationCidrBlock],
                protocol: "TCP",
                fromPort: nodePort, 
                toPort: nodePort, 
            },
        ],
        egress: [
            {
                cidrBlocks: [destinationCidrBlock],
                protocol: "TCP",
                fromPort: port,
                toPort: port,
            },
            {
                cidrBlocks: [destinationCidrBlock],
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
            },
        ],
    });

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
    });
    
/*     const customPolicy = new aws.iam.Policy("customPolicy", {
        name: "CustomPolicyName", 
        description: "Custom policy description",
        policyArn: aws.iam.ManagedPolicy.IAMReadOnlyAccess,
    },{ dependsOn: [testRole] }); */
    

    const rolePolicyAttachment = new aws.iam.RolePolicyAttachment("policyAttachment", {
        role: cloudWatchIamRole.name,
        policyArn: rolePolicy,
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

    const ec2Instance = new aws.ec2.Instance("instance", {
        dependsOn: [rdsInstance],
        ami: ami.id,
        vpcId: vpc.id,
        instanceType: instanceType,
        subnetId: publicSubnet[0],
        associatePublicIpAddress: true,
        iamInstanceProfile: ec2InstanceProfile.name,
        vpcSecurityGroupIds: [
            ec2SecurityGroup.id,
        ],
        tags: {
            Name: `Ec2Instance`,
            Type: "public",
          },
        keyName: keyPairName, 
        userData: pulumi.interpolate
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
        `/* ) */,
    }
    ,{ dependsOn: [rdsInstance,ec2InstanceProfile] }
    );



/*     echo "DB_DIALECT=${engine}" | sudo tee -a /home/admin/webapp-main/.env
    echo "DB_HOST=${rdsEndpoint}" | sudo tee -a /home/admin/webapp-main/.env
    echo "DB_PORT=${port}" | sudo tee -a /home/admin/webapp-main/.env
    echo "DB_USERNAME=${databaseUsername}" | sudo tee -a /home/admin/webapp-main/.env
    echo "DB_PASSWORD=${dataPassword}" | sudo tee -a /home/admin/webapp-main/.env
    echo "DB_NAME_CREATED=${databaseName}" | sudo tee -a /home/admin/webapp-main/.env
    echo "DB_NAME_DEFAULT=${databaseName}" | sudo tee -a /home/admin/webapp-main/.env
    echo "DB_LOGGING=false" | sudo tee -a /home/admin/webapp-main/.env
    echo "CSV_LOCATION=${databaseName}" | sudo tee -a /home/admin/webapp-main/.env
    echo "SERVER_PORT=${nodePort}" | sudo tee -a /home/admin/webapp-main/.env */

/*         const zonePromise = aws.route53.getZone({ name: "dev.nihiljosephpellissery.me" }, { async: true });

        zonePromise.then(zone => {

        const record = new aws.route53.Record("myRecord", {
        zoneId: zone.zoneId,
        name: "dev.nihiljosephpellissery.me",
        type: "A",
        ttl: 60,
        records: [ec2Instance.publicIp],
    }, { dependsOn: [ec2Instance] });  
    }); */


    const selected = aws.route53.getZone({
        name: domainName,
        privateZone: false,
    });
    const createRecord = new aws.route53.Record("createRecord", {
        zoneId: selected.then(selected => selected.zoneId),
        name: domainName,
        type: "A",
        ttl: 60,
        records: [ec2Instance.publicIp],
        tags: {
            Name: `Route53`,
            Type: "public",
          },
    }, { dependsOn: [ec2Instance] });


    return {
        vpcId: vpc.id,
        internetGatewayId: internetGateway.id,        
        rdsInstanceId: rdsInstance.id,
        ec2InstanceId: ec2Instance.id,
        createdRecord: createRecord.zoneId,
        instancePublicIp : ec2Instance.publicIp,
    };
}

module.exports = main();
