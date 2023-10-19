"use strict";
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const config=  new pulumi.Config("app");
let publicSubnet = [];
const ip = config.get("VPCCidrBlock");
const nodePort = config.get("nodePort");
const instanceType = config.get("instanceType");
const ownerId = config.get("ownerId");
const keyPairName = config.get("keyPairName");

const ipsplit = ip.split('/');
const networkPart = ipsplit[0].split('.');
const subnetMask = ipsplit[1];


async function main() {
    // Create a new VPC

    const keyPair = new aws.ec2.KeyPair("instance-keypair", {
        publicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDHTQsVbcyHz7bYNS7Vytvy41lInyP8/jJIkLhSn6POc/wwmySloLkXzP7b5RKQmO7gZXaBV1gEaX/k5j9K0Nw6s32IMJmmpOlNUnEXPjChMWe7V1HI5jZIgKYL7mOoadbfB2A04aOZZNnK3dDGU65QJkcd7gfIDUBIyuJNpoeXvm/mfqHW1ViKbo79I42Ma9KkSgQ9NoIG9/cNmqfJbCO1G/K19cnjl6QbQeuuz4DhAk4LrZdLgYuSg+j4KWE69BmX3iaCSX/EoZ8v4+qCPmEbwYxn/Mf3F46bfN+iomYNed8TNtu5v315IvqbaurWlbJIuat4P1PgwhGCDcmF/+RJT/4yZt1n7A7XfprEDQrS0Xp5Vn5mUrS6CD000xTdDtg8XDO0NkExovi6MrGOlMejNgnk/JDt26LPkAnOuo423Rvyt0NCninEklaaug1+xzZPWxG28JVrpt9I8QxNRWvOw4UVhINH90mth93owBmMYBVVxmZ7cCqiSxSENxv9DK0= nihil@Nihil"
    });

    
    const vpc = new aws.ec2.Vpc("webappVPC", {
        cidrBlock:config.get("VPCCidrBlock") // Define the IP address range for this VPC.
    });

    // Create an internet gateway and attach it to the VPC
    const internetGateway = new aws.ec2.InternetGateway("webappInternetGateway", {
        vpcId: vpc.id, // Attach this internet gateway to the previously created VPC.
        tags: {
            Name: `InternetGateway`,
            Type: "public",
          },
    });

    // Create public Route Table
    const publicRouteTable = new aws.ec2.RouteTable("publicRouteTable", {
        vpcId: vpc.id,
        tags: {
            Name: `privateRouteTable`,
            Type: "public",
          },
    });

    // Create private Route Table
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

        return publicSubnet.id;
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
    }

    const azs = await aws.getAvailabilityZones({ state: "available" });

    if (azs.names.length < 2) {
        throw new Error("Expected at least 2 Availability Zones, but found a different number.");
    }
    
    let counter = 1;
    console.log(azs.names.length);
    for (let i = 0; i < azs.names.length && i < 3 ; i++) {
        // Create public and private subnets for each AZ
        const az = azs.names[i];
    
        publicSubnet = await publicSubnetFunction(i,counter,az);
    
        const privateSubnet = await privateSubnetFunction(i,counter,az);
    
        counter += 2; // Increment the counter to create the next CIDR block for subnets
    }

    

    const securityGroup = new aws.ec2.SecurityGroup("security-group", {
        vpcId: vpc.id,
        ingress: [
            {
                cidrBlocks: ["0.0.0.0/0"],
                protocol: "tcp",
                fromPort: 22, // SSH
                toPort: 22,
            },
            {
                cidrBlocks: ["0.0.0.0/0"],
                protocol: "tcp",
                fromPort: 80, // HTTP
                toPort: 80,
            },
            {
                cidrBlocks: ["0.0.0.0/0"],
                protocol: "tcp",
                fromPort: 443, // HTTPS
                toPort: 443,
            },
            {
                cidrBlocks: ["0.0.0.0/0"],
                protocol: "tcp",
                fromPort: nodePort, // Your application port
                toPort: nodePort, // Your application port
            },
        ],
    });


    const ami = pulumi.output(aws.ec2.getAmi({
        owners: [ ownerId ],
        mostRecent: true,
    }));

    const instance = new aws.ec2.Instance("instance", {
        ami: ami.id,
        instanceType: instanceType,
        subnetId: publicSubnet,
        associatePublicIpAddress: true,
        vpcSecurityGroupIds: [
            securityGroup.id,
        ],
        tags: {
            Name: `instanceName`,
            Type: "public",
          },
        keyName: keyPairName, 
        userData: `
            #!/bin/bash
            amazon-linux-extras install nginx1
            amazon-linux-extras enable nginx
            systemctl enable nginx
            systemctl start nginx
        `,
    });




    return {
        vpcId: vpc.id,
        internetGatewayId: internetGateway.id,
        instancePublicIp : instance.publicIp
    };
}

module.exports = main();
