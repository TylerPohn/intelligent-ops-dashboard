#!/usr/bin/env ts-node

/**
 * DynamoDB to S3 Export Script
 * Exports IOPS data from DynamoDB to S3 for ML training
 */

import {
  DynamoDBClient,
  ScanCommand,
  BatchWriteItemCommand
} from '@aws-sdk/client-dynamodb';
import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand
} from '@aws-sdk/client-s3';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

interface ExportConfig {
  tableName: string;
  bucketName: string;
  s3Prefix: string;
  region: string;
  batchSize: number;
}

const DEFAULT_CONFIG: ExportConfig = {
  tableName: process.env.DYNAMODB_TABLE_NAME || 'iops-insights',
  bucketName: process.env.S3_BUCKET_NAME || 'iops-ml-training',
  s3Prefix: 'raw/',
  region: process.env.AWS_REGION || 'us-east-1',
  batchSize: 100
};

class DynamoDBToS3Exporter {
  private dynamoClient: DynamoDBClient;
  private s3Client: S3Client;
  private config: ExportConfig;

  constructor(config: Partial<ExportConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dynamoClient = new DynamoDBClient({ region: this.config.region });
    this.s3Client = new S3Client({ region: this.config.region });
  }

  async ensureBucketExists(): Promise<void> {
    try {
      await this.s3Client.send(new HeadBucketCommand({
        Bucket: this.config.bucketName
      }));
      console.log(`✅ S3 bucket ${this.config.bucketName} exists`);
    } catch (error) {
      if ((error as any).name === 'NotFound') {
        console.log(`📦 Creating S3 bucket ${this.config.bucketName}...`);
        await this.s3Client.send(new CreateBucketCommand({
          Bucket: this.config.bucketName
        }));
        console.log(`✅ S3 bucket created`);
      } else {
        throw error;
      }
    }
  }

  async exportData(): Promise<void> {
    console.log('🚀 Starting DynamoDB to S3 export...');
    console.log(`📊 Table: ${this.config.tableName}`);
    console.log(`📦 Bucket: s3://${this.config.bucketName}/${this.config.s3Prefix}`);

    // Ensure bucket exists
    await this.ensureBucketExists();

    let items: any[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined;
    let pageCount = 0;
    let totalItems = 0;

    // Scan DynamoDB table with pagination
    do {
      const command = new ScanCommand({
        TableName: this.config.tableName,
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: this.config.batchSize
      });

      const response = await this.dynamoClient.send(command);

      if (response.Items) {
        const unmarshalledItems = response.Items.map(item => unmarshall(item));
        items.push(...unmarshalledItems);
        totalItems += unmarshalledItems.length;
        pageCount++;

        console.log(`📄 Scanned page ${pageCount}: ${unmarshalledItems.length} items (Total: ${totalItems})`);
      }

      lastEvaluatedKey = response.LastEvaluatedKey;

      // Upload batch if reached batch size
      if (items.length >= this.config.batchSize) {
        await this.uploadBatch(items, pageCount);
        items = [];
      }

    } while (lastEvaluatedKey);

    // Upload remaining items
    if (items.length > 0) {
      await this.uploadBatch(items, pageCount + 1);
    }

    console.log(`✅ Export complete! Total items exported: ${totalItems}`);
  }

  private async uploadBatch(items: any[], batchNumber: number): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `${this.config.s3Prefix}export-batch-${batchNumber}-${timestamp}.json`;

    const command = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      Body: JSON.stringify(items, null, 2),
      ContentType: 'application/json'
    });

    await this.s3Client.send(command);
    console.log(`📤 Uploaded batch ${batchNumber} to s3://${this.config.bucketName}/${key}`);
  }

  async exportToCSV(): Promise<void> {
    console.log('🚀 Starting DynamoDB to S3 export (CSV format)...');

    await this.ensureBucketExists();

    let allItems: any[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined;
    let pageCount = 0;

    // Scan all data
    do {
      const command = new ScanCommand({
        TableName: this.config.tableName,
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: 1000
      });

      const response = await this.dynamoClient.send(command);

      if (response.Items) {
        const unmarshalledItems = response.Items.map(item => unmarshall(item));
        allItems.push(...unmarshalledItems);
        pageCount++;
        console.log(`📄 Scanned page ${pageCount}: ${unmarshalledItems.length} items`);
      }

      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    // Convert to CSV
    if (allItems.length > 0) {
      const headers = Object.keys(allItems[0]).join(',');
      const rows = allItems.map(item =>
        Object.values(item).map(v =>
          typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
        ).join(',')
      );
      const csv = [headers, ...rows].join('\n');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const key = `${this.config.s3Prefix}full-export-${timestamp}.csv`;

      const command = new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
        Body: csv,
        ContentType: 'text/csv'
      });

      await this.s3Client.send(command);
      console.log(`✅ CSV export complete! Uploaded to s3://${this.config.bucketName}/${key}`);
      console.log(`📊 Total records: ${allItems.length}`);
    }
  }

  async exportManifest(): Promise<void> {
    const manifest = {
      exportDate: new Date().toISOString(),
      tableName: this.config.tableName,
      bucketName: this.config.bucketName,
      s3Prefix: this.config.s3Prefix,
      region: this.config.region,
      format: 'json',
      description: 'IOPS ML training data export from DynamoDB'
    };

    const key = `${this.config.s3Prefix}manifest.json`;
    const command = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json'
    });

    await this.s3Client.send(command);
    console.log(`📋 Manifest uploaded to s3://${this.config.bucketName}/${key}`);
  }
}

// CLI execution
async function main() {
  const args = process.argv.slice(2);
  const format = args.includes('--csv') ? 'csv' : 'json';

  const exporter = new DynamoDBToS3Exporter({
    tableName: process.env.DYNAMODB_TABLE_NAME,
    bucketName: process.env.S3_BUCKET_NAME,
    region: process.env.AWS_REGION
  });

  try {
    if (format === 'csv') {
      await exporter.exportToCSV();
    } else {
      await exporter.exportData();
    }

    await exporter.exportManifest();

    console.log('\n✅ Export process completed successfully!');
    console.log('\n📝 AWS CLI equivalent commands:');
    console.log(`aws dynamodb scan --table-name ${DEFAULT_CONFIG.tableName} --region ${DEFAULT_CONFIG.region} > export.json`);
    console.log(`aws s3 cp export.json s3://${DEFAULT_CONFIG.bucketName}/${DEFAULT_CONFIG.s3Prefix}`);

  } catch (error) {
    console.error('❌ Export failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { DynamoDBToS3Exporter, ExportConfig };
