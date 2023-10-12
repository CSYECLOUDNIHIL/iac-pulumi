"use strict";
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const config=  new pulumi.Config("app");

const ip = config.get("VPCCidrBlock");

const ipPart1 = ip.substring(0, 5);   // Extracts "Hello"
const ipPart2 = ip.substring(6,8); 

async function main() {
    // Create a new VPC
    const vpc = new aws.ec2.Vpc("webappVPC", {
        cidrBlock:config.get("VPCCidrBlock") // Define the IP address range for this VPC.
    });

    // Create an internet gateway and attach it to the VPC
    const internetGateway = new aws.ec2.InternetGateway("webappInternetGateway", {
        vpcId: vpc.id // Attach this internet gateway to the previously created VPC.
    });

    // Create public Route Table
    const publicRouteTable = new aws.ec2.RouteTable("publicRouteTable", {
        vpcId: vpc.id,
    });

    // Create private Route Table
    const privateRouteTable = new aws.ec2.RouteTable("privateRouteTable", {
        vpcId: vpc.id,
    });

    const publicSubnetFunction = async (i,counter,az) => {
        const publicSubnet = new aws.ec2.Subnet(`publicSubnet${counter}`, {
            vpcId: vpc.id,
            availabilityZone: az,
            cidrBlock: `${ipPart1}${counter}${ipPart2}/24`,
            tags: {
                Name: `webapp-publicsubnet${i}`,
                Type: "public",
              },
        }); 
        const publicSubnetAssociation = new aws.ec2.RouteTableAssociation(`publicSubnetAssociation${counter}`, {
            subnetId: publicSubnet.id,
            routeTableId: publicRouteTable.id,
        });
    }

    const privateSubnetFunction = async (i,counter,az) => {
        const privateSubnet = new aws.ec2.Subnet(`privateSubnet${counter}`, {
            vpcId: vpc.id,
            availabilityZone: az,
            cidrBlock: `${ipPart1}${counter+1}${ipPart2}/24`,
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
    
    else {
        let counter = 1;
    console.log(azs.names.length);
    for (let i = 0; i < azs.names.length && i < 3 ; i++) {
        // Create public and private subnets for each AZ
        const az = azs.names[i];
    
        const publicSubnet = await publicSubnetFunction(i,counter,az);
    
        const privateSubnet = await privateSubnetFunction(i,counter,az);
    
        counter += 2; // Increment the counter to create the next CIDR block for subnets
    }
    }
    
    

    const publicRoute = new aws.ec2.Route("webapp-publicRoute", {
        routeTableId: publicRouteTable.id,
        destinationCidrBlock: config.get("destinationCidrBlock"),
        gatewayId: internetGateway.id,
    });

    return {
        vpcId: vpc.id,
        internetGatewayId: internetGateway.id,
    };
}

module.exports = main();
