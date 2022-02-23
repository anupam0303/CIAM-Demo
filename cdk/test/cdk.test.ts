import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {CdkStack} from '../lib/cdk-stack';

// example test. To run these tests, uncomment this file along with the
// example resource in lib/cdk-stack.ts
test('Check if User Pool is Created', () => {

    const stack = new cdk.Stack();
    // WHEN
    new CdkStack(stack, 'MyStack');
    // THEN
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Cognito::UserPool', {
        UserPoolName: 'MyUserPool',
        Policies: {
            PasswordPolicy: {
                MinimumLength: 8,
                RequireLowercase: true,
                RequireUppercase: true,
                RequireNumbers: true,
                RequireSymbols: true,
            }
        }
});
});
