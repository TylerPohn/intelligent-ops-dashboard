/**
 * Generate Training Data and Upload to S3
 *
 * This script:
 * 1. Generates synthetic training data locally
 * 2. Uploads to S3 in the structure SageMaker expects
 * 3. Cleans up local files (optional)
 */

import { S3Client, PutObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

// Import the data generator (we'll use the same logic)
// For now, let's define the S3 structure

const CONFIG = {
  BUCKET_NAME: 'iops-dashboard-ml-data', // Change this to your bucket name
  REGION: 'us-east-1',
  PREFIX: 'marketplace-health-model',

  // S3 structure
  PATHS: {
    TRAIN: 'train/',
    VALIDATION: 'validation/',
    TEST: 'test/',
    MODELS: 'models/',
    TRAINING_JOBS: 'training-jobs/',
  }
};

const s3Client = new S3Client({ region: CONFIG.REGION });

/**
 * Check if S3 bucket exists, create if not
 */
async function ensureBucketExists(bucketName: string): Promise<void> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`✅ Bucket ${bucketName} exists`);
  } catch (error: any) {
    if (error.name === 'NotFound') {
      console.log(`Creating bucket ${bucketName}...`);
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`✅ Created bucket ${bucketName}`);
    } else {
      throw error;
    }
  }
}

/**
 * Upload file to S3
 */
async function uploadToS3(
  bucketName: string,
  key: string,
  filePath: string
): Promise<void> {
  const fileContent = fs.readFileSync(filePath);

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: fileContent,
    ContentType: key.endsWith('.jsonl') ? 'application/jsonl' :
                 key.endsWith('.csv') ? 'text/csv' : 'application/octet-stream',
  });

  await s3Client.send(command);
  console.log(`✅ Uploaded: s3://${bucketName}/${key}`);
}

/**
 * Upload training data to S3
 */
async function uploadTrainingData(localDataDir: string): Promise<void> {
  const files = [
    { local: 'train.jsonl', s3Key: `${CONFIG.PREFIX}/${CONFIG.PATHS.TRAIN}train.jsonl` },
    { local: 'validation.jsonl', s3Key: `${CONFIG.PREFIX}/${CONFIG.PATHS.VALIDATION}validation.jsonl` },
    { local: 'test.jsonl', s3Key: `${CONFIG.PREFIX}/${CONFIG.PATHS.TEST}test.jsonl` },
    { local: 'train.csv', s3Key: `${CONFIG.PREFIX}/${CONFIG.PATHS.TRAIN}train.csv` },
  ];

  for (const file of files) {
    const localPath = path.join(localDataDir, file.local);

    if (!fs.existsSync(localPath)) {
      console.log(`⚠️  File not found: ${localPath}, skipping...`);
      continue;
    }

    await uploadToS3(CONFIG.BUCKET_NAME, file.s3Key, localPath);
  }
}

/**
 * Print S3 paths for reference
 */
function printS3Paths(): void {
  console.log('\n=== S3 Paths ===\n');
  console.log('Training data:');
  console.log(`  s3://${CONFIG.BUCKET_NAME}/${CONFIG.PREFIX}/${CONFIG.PATHS.TRAIN}`);
  console.log('\nValidation data:');
  console.log(`  s3://${CONFIG.BUCKET_NAME}/${CONFIG.PREFIX}/${CONFIG.PATHS.VALIDATION}`);
  console.log('\nTest data:');
  console.log(`  s3://${CONFIG.BUCKET_NAME}/${CONFIG.PREFIX}/${CONFIG.PATHS.TEST}`);
  console.log('\nModels (output):');
  console.log(`  s3://${CONFIG.BUCKET_NAME}/${CONFIG.PREFIX}/${CONFIG.PATHS.MODELS}`);
  console.log('\nTraining jobs:');
  console.log(`  s3://${CONFIG.BUCKET_NAME}/${CONFIG.PREFIX}/${CONFIG.PATHS.TRAINING_JOBS}`);
}

/**
 * Main execution
 */
async function main() {
  console.log('=== Upload Training Data to S3 ===\n');

  // Ensure bucket exists
  await ensureBucketExists(CONFIG.BUCKET_NAME);

  // Upload training data
  const localDataDir = path.join(__dirname, '..', 'data');

  if (!fs.existsSync(localDataDir)) {
    console.error(`❌ Data directory not found: ${localDataDir}`);
    console.error('Run generate-training-data.ts first!');
    process.exit(1);
  }

  console.log('\nUploading training data...');
  await uploadTrainingData(localDataDir);

  // Print paths
  printS3Paths();

  console.log('\n✅ Upload complete!');
  console.log('\nNext steps:');
  console.log('1. Run: npm run train:sagemaker');
  console.log('2. Or manually: python scripts/train-on-sagemaker.py');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
