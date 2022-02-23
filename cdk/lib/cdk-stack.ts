import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';

import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as dynamo from "aws-cdk-lib/aws-dynamodb";
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import { KinesisEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sns from 'aws-cdk-lib/aws-sns';
import { LambdaSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';

export class CdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id);

    const pool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'MyUserPool',
      selfSignUpEnabled: true,
      signInAliases: {
        username: true,
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        givenName: {
          required: true,
          mutable: true,
        },
        familyName: {
          required: true,
          mutable: true,
        },
      },
      customAttributes: {
        region: new cognito.StringAttribute({ mutable: true }),
        customer: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    pool.addClient('MyClient', {
      userPoolClientName: 'MyClient',
      generateSecret: true,
      authFlows: {
        userPassword: false,
        adminUserPassword: true,
        custom: false,
        userSrp: true,
      },
      oAuth: {
        callbackUrls: [
          'https://example.com/callback'
        ],
        logoutUrls: [
          'https://example.com/logout'
        ],
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true,
          clientCredentials: false,
        },
        scopes: [
          cognito.OAuthScope.PHONE,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.COGNITO_ADMIN,
        ],
      },
    });

    pool.addDomain('MyDomain', {
      cognitoDomain: {
        domainPrefix: 'anupam-test1-0303',
      }
    });


    const createCustomerLambdaRole = new iam.Role(this, 'createCustomerLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'),
      ],
      roleName: 'createCustomerLambdaRole',
      description: 'Role for createCustomer lambda',
    });

    const listenDynamoDBStreamLambdaRole = new iam.Role(this, 'listenDynamoDBStreamLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess'),
      ],
      roleName: 'listenDynamoDBStreamLambdaRole',
      description: 'Role for listenDynamoDBStream lambda',
    });

    listenDynamoDBStreamLambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:DescribeStream',
        'dynamodb:ListStreams',
        'sns:Publish',
      ],
      resources: [
        '*',
      ],
    }));

    const provisionCustomerLambdaRole = new iam.Role(this, 'provisionCustomerLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('IAMFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoPowerUser'),
      ],
      roleName: 'provisionCustomerLambdaRole',
      description: 'Role for provisionCustomer lambda',
    });


    //Create Customer Lambda
    const createCustomerLambda = new lambda.Function(this, 'CreateCustomerLambda', {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'createCustomer.main',
      code: lambda.Code.fromAsset('resources/createCustomer'),
      role: createCustomerLambdaRole,
    });

    //Create listenDynamoDBStream Lambda
    const listenDynamoDBStream = new lambda.Function(this, 'ListenDynamoDBStream', {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'listenDynamoDBStream.main',
      code: lambda.Code.fromAsset('resources/listenDynamoDBStream'),
      role: listenDynamoDBStreamLambdaRole,
      
    });

    //Create provisionCustomer Lambda
    const provisionCustomer = new lambda.Function(this, 'ProvisionCustomer', {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'provisionCustomer.main',
      code: lambda.Code.fromAsset('resources/provisionCustomer'),
      role: provisionCustomerLambdaRole,
    });

    const stream = new kinesis.Stream(this, 'Stream');

    listenDynamoDBStream.addEventSource(new KinesisEventSource(stream, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 100,
    }));


    const userPoolRole = new iam.Role(this, 'UserPoolRole', {
      assumedBy: new iam.ArnPrincipal(`arn:aws:sts::${this.account}:assumed-role/createCustomerLambdaRole/${createCustomerLambda.functionName}`),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('IAMFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoPowerUser'),
      ],
      roleName: 'AppAdmin',
      description: 'Role for AppAdmin',
    });

    const cfnUserPoolGroup = new cognito.CfnUserPoolGroup(this, 'MyCfnUserPoolGroup', {
      userPoolId: pool.userPoolId,
      description: 'Group for App Admin',
      groupName: 'AppAdmin',
      roleArn: userPoolRole.roleArn,
    });

    createCustomerLambda.role?.attachInlinePolicy(new iam.Policy(this, 'CreateCustomerPolicy', {
      statements: [
        new iam.PolicyStatement({
          actions: [
            'sts:AssumeRole',
          ],
          resources: [
            userPoolRole.roleArn,
          ],
        }),
      ],
    }));

    // Create API Gateway
    const api = new apigateway.RestApi(this, "create-customer-api", {
      restApiName: "Create Customer Service",
      description: "This service creates customers."
    });

    const createCustomerIntegration = new apigateway.LambdaIntegration(createCustomerLambda, {
      requestTemplates: { "application/json": '{ "statusCode": "200" }' }
    });

    const auth = new apigateway.CfnAuthorizer(this, 'create-customer-auth', {
      name: 'create-customer-auth',
      restApiId: api.restApiId,
      type: 'COGNITO_USER_POOLS',
      identitySource: 'method.request.header.Authorization',
      providerArns: [pool.userPoolArn],
    });

    const method = api.root.addMethod("POST", createCustomerIntegration, {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: {
        authorizerId: auth.ref,
      },
    });

    // Create DynamoDB Table
    const customerTable = new dynamo.Table(this, 'CustomerTable', {
      tableName: 'customer-table',
      partitionKey: {
        name: 'customerName',
        type: dynamo.AttributeType.STRING,
      },
      /*sortKey: {
        name: 'customerName',
        type: dynamo.AttributeType.STRING,
      },*/
      billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      kinesisStream: stream,
    });

    const topic = new sns.Topic(this, 'Topic', {
      topicName: 'CustomerCreated',
    });

    topic.addSubscription(new LambdaSubscription(provisionCustomer));
  }
}
