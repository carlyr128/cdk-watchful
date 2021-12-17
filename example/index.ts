import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';

import { App, Duration, Stack, StackProps } from 'aws-cdk-lib';

import { Construct } from 'constructs';
import { Watchful } from '../src';

class TestStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const table1 = new dynamodb.Table(this, 'DynamoTable1', {
      writeCapacity: 10,
      partitionKey: {
        name: 'ID',
        type: dynamodb.AttributeType.STRING,
      },
    });

    const writeTraffic = new TrafficDriver(this, 'WriteTraffic', {
      table: table1,
      write: true,
    });

    const readTraffic = new TrafficDriver(this, 'WriteReadTraffic', {
      table: table1,
      write: true,
      read: true,
    });

    const alarmSqs = sqs.Queue.fromQueueArn(this, 'AlarmQueue', 'arn:aws:sqs:us-east-1:444455556666:alarm-queue');
    const alarmSns = sns.Topic.fromTopicArn(this, 'AlarmTopic', 'arn:aws:sns:us-east-2:444455556666:MyTopic');

    const watchful = new Watchful(this, 'watchful', {
      alarmEmail: 'benisrae@amazon.com',
      alarmSqs,
      alarmSns,
    });

    watchful.watchDynamoTable('My Cute Little Table', table1);

    watchful.watchScope(writeTraffic);
    watchful.watchScope(readTraffic);
  }
}

interface TrafficDriverProps {
  table: dynamodb.Table;
  read?: boolean;
  write?: boolean;
}

class TrafficDriver extends Construct {
  private readonly fn: lambda.Function;

  constructor(scope: Construct, id: string, props: TrafficDriverProps) {
    super(scope, id);

    if (!props.read && !props.write) {
      throw new Error('At least "read" or "write" must be set');
    }

    this.fn = new lambda.Function(this, 'LambdaFunction', {
      code: lambda.Code.asset(path.join(__dirname, 'lambda')),
      runtime: lambda.Runtime.NODEJS_10_X,
      handler: 'index.handler',
      environment: {
        TABLE_NAME: props.table.tableName,
        READ: props.read ? 'TRUE' : '',
        WRITE: props.write ? 'TRUE' : '',
      },
    });

    if (props.write) {
      props.table.grantWriteData(this.fn);
    }

    if (props.read) {
      props.table.grantReadData(this.fn);
    }

    new events.Rule(this, 'Tick', {
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new events_targets.LambdaFunction(this.fn)],
    });
  }
}

class TestApp extends App {
  constructor() {
    super();

    new TestStack(this, 'watchful-example');
  }
}

new TestApp().synth();
