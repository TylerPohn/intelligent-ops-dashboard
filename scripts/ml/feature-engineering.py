#!/usr/bin/env python3

"""
Feature Engineering Pipeline for IOPS ML Models
Extracts 25 features from raw insight data for training
"""

import json
import pandas as pd
import numpy as np
from datetime import datetime
from typing import Dict, List, Tuple
import boto3
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split

# AWS Configuration
S3_BUCKET = 'iops-ml-training'
S3_RAW_PREFIX = 'raw/'
S3_PROCESSED_PREFIX = 'processed/'

s3_client = boto3.client('s3')


class FeatureEngineer:
    """
    Extracts 25 features from IOPS insight data:

    IOPS Metrics (4):
      - read_iops, write_iops, total_iops, iops_variance

    Latency (4):
      - avg_latency, p95_latency, p99_latency, latency_spike_count

    Throughput (2):
      - bandwidth_mbps, throughput_variance

    Error Rates (2):
      - error_rate, error_trend

    Time-based (3):
      - hour_of_day, day_of_week, time_since_last_alert

    Pattern (2):
      - sequential_access_ratio, random_access_ratio

    Device (3):
      - queue_depth, io_size_avg, io_size_variance

    Derived (5):
      - iops_per_latency, anomaly_score, trend_score, load_factor, efficiency_ratio
    """

    def __init__(self):
        self.scaler = StandardScaler()
        self.label_encoder = LabelEncoder()

    def load_data_from_s3(self, file_key: str) -> pd.DataFrame:
        """Load raw data from S3"""
        print(f"📥 Loading data from s3://{S3_BUCKET}/{file_key}")

        response = s3_client.get_object(Bucket=S3_BUCKET, Key=file_key)
        data = json.loads(response['Body'].read())

        # Combine labeled and unlabeled data
        all_records = data['labeled_data'] + data['unlabeled_data']

        print(f"   ✓ Loaded {len(all_records)} records")
        print(f"   ✓ Labeled: {len(data['labeled_data'])}")
        print(f"   ✓ Unlabeled: {len(data['unlabeled_data'])}")

        return pd.DataFrame(all_records)

    def extract_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Extract all 25 features from raw data"""
        print("\n🔧 Extracting 25 features...")

        features_df = pd.DataFrame()

        # ========== IOPS Metrics (4 features) ==========
        features_df['read_iops'] = df['metadata'].apply(lambda x: x['read_iops'])
        features_df['write_iops'] = df['metadata'].apply(lambda x: x['write_iops'])
        features_df['total_iops'] = df['metadata'].apply(lambda x: x['total_iops'])

        # IOPS variance (rolling std over device history)
        features_df['iops_variance'] = df.groupby('deviceId')['value'].transform(
            lambda x: x.rolling(window=10, min_periods=1).std()
        )

        print("   ✓ IOPS metrics (4)")

        # ========== Latency (4 features) ==========
        features_df['avg_latency'] = df['metadata'].apply(lambda x: x['avg_latency'])
        features_df['p95_latency'] = df['metadata'].apply(lambda x: x['p95_latency'])
        features_df['p99_latency'] = df['metadata'].apply(lambda x: x['p99_latency'])

        # Latency spike count (p99 > 2x avg)
        features_df['latency_spike_count'] = (
            features_df['p99_latency'] > (2 * features_df['avg_latency'])
        ).astype(int)

        print("   ✓ Latency metrics (4)")

        # ========== Throughput (2 features) ==========
        features_df['bandwidth_mbps'] = df['metadata'].apply(lambda x: x['bandwidth_mbps'])

        # Throughput variance
        features_df['throughput_variance'] = df.groupby('deviceId')['metadata'].transform(
            lambda x: x.apply(lambda m: m['bandwidth_mbps']).rolling(window=10, min_periods=1).std()
        )

        print("   ✓ Throughput metrics (2)")

        # ========== Error Rates (2 features) ==========
        features_df['error_rate'] = df['metadata'].apply(lambda x: x['error_rate'])

        # Error trend (increasing = 1, stable = 0, decreasing = -1)
        features_df['error_trend'] = df.groupby('deviceId')['metadata'].transform(
            lambda x: x.apply(lambda m: m['error_rate']).diff().fillna(0).apply(
                lambda d: 1 if d > 0.001 else (-1 if d < -0.001 else 0)
            )
        )

        print("   ✓ Error rate metrics (2)")

        # ========== Time-based (3 features) ==========
        df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
        features_df['hour_of_day'] = df['datetime'].dt.hour
        features_df['day_of_week'] = df['datetime'].dt.dayofweek

        # Time since last alert (simulated - hours since last high risk)
        features_df['time_since_last_alert'] = 24.0  # Default 24 hours

        print("   ✓ Time-based features (3)")

        # ========== Pattern (2 features) ==========
        features_df['sequential_access_ratio'] = df['metadata'].apply(
            lambda x: 1.0 if x['access_pattern'] == 'sequential' else 0.0
        )
        features_df['random_access_ratio'] = 1.0 - features_df['sequential_access_ratio']

        print("   ✓ Access pattern features (2)")

        # ========== Device (3 features) ==========
        features_df['queue_depth'] = df['metadata'].apply(lambda x: x['queue_depth'])
        features_df['io_size_avg'] = df['metadata'].apply(lambda x: x['io_size_kb'])

        # IO size variance
        features_df['io_size_variance'] = df.groupby('deviceId')['metadata'].transform(
            lambda x: x.apply(lambda m: m['io_size_kb']).rolling(window=10, min_periods=1).std()
        )

        print("   ✓ Device metrics (3)")

        # ========== Derived (5 features) ==========
        # IOPS per latency (efficiency)
        features_df['iops_per_latency'] = features_df['total_iops'] / (features_df['avg_latency'] + 1)

        # Anomaly score (normalized deviation from device mean)
        device_means = df.groupby('deviceId')['value'].transform('mean')
        device_stds = df.groupby('deviceId')['value'].transform('std')
        features_df['anomaly_score'] = np.abs(df['value'] - device_means) / (device_stds + 1)

        # Trend score (rate of change)
        features_df['trend_score'] = df.groupby('deviceId')['value'].transform(
            lambda x: x.diff().fillna(0)
        )

        # Load factor (0-1 scale based on max theoretical IOPS)
        features_df['load_factor'] = features_df['total_iops'] / 15000.0

        # Efficiency ratio (throughput per IOPS)
        features_df['efficiency_ratio'] = features_df['bandwidth_mbps'] / (features_df['total_iops'] + 1)

        print("   ✓ Derived features (5)")

        # Add labels if available
        if 'riskLevel' in df.columns:
            features_df['risk_level'] = df['riskLevel'].fillna('unknown')
        else:
            features_df['risk_level'] = 'unknown'

        if 'performanceScore' in df.columns:
            features_df['performance_score'] = df['performanceScore'].fillna(-1)
        else:
            features_df['performance_score'] = -1

        # Add identifiers
        features_df['insight_id'] = df['insightId']
        features_df['device_id'] = df['deviceId']
        features_df['timestamp'] = df['timestamp']

        print(f"\n✅ Extracted {len(features_df.columns)} total columns (25 features + 5 metadata)")

        return features_df

    def split_data(self, df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """Split into train/val/test (70/15/15)"""
        print("\n✂️  Splitting data (70/15/15)...")

        # Separate labeled and unlabeled
        labeled_df = df[df['risk_level'] != 'unknown'].copy()
        unlabeled_df = df[df['risk_level'] == 'unknown'].copy()

        print(f"   • Labeled records: {len(labeled_df)}")
        print(f"   • Unlabeled records: {len(unlabeled_df)}")

        # Split labeled data
        train_df, temp_df = train_test_split(labeled_df, test_size=0.30, random_state=42, stratify=labeled_df['risk_level'])
        val_df, test_df = train_test_split(temp_df, test_size=0.50, random_state=42, stratify=temp_df['risk_level'])

        print(f"   ✓ Train: {len(train_df)} ({len(train_df)/len(labeled_df)*100:.1f}%)")
        print(f"   ✓ Validation: {len(val_df)} ({len(val_df)/len(labeled_df)*100:.1f}%)")
        print(f"   ✓ Test: {len(test_df)} ({len(test_df)/len(labeled_df)*100:.1f}%)")

        return train_df, val_df, test_df

    def normalize_features(self, train_df: pd.DataFrame, val_df: pd.DataFrame, test_df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """Normalize numerical features using StandardScaler"""
        print("\n📊 Normalizing features...")

        # Feature columns (exclude metadata)
        feature_cols = [col for col in train_df.columns if col not in
                       ['insight_id', 'device_id', 'timestamp', 'risk_level', 'performance_score']]

        # Fit scaler on training data
        train_df[feature_cols] = self.scaler.fit_transform(train_df[feature_cols])
        val_df[feature_cols] = self.scaler.transform(val_df[feature_cols])
        test_df[feature_cols] = self.scaler.transform(test_df[feature_cols])

        print(f"   ✓ Normalized {len(feature_cols)} features")

        return train_df, val_df, test_df

    def save_to_s3(self, train_df: pd.DataFrame, val_df: pd.DataFrame, test_df: pd.DataFrame) -> None:
        """Save processed datasets to S3"""
        print("\n☁️  Saving processed data to S3...")

        timestamp = datetime.now().strftime('%Y-%m-%d')

        datasets = {
            'train': train_df,
            'validation': val_df,
            'test': test_df
        }

        for name, df in datasets.items():
            # Save as CSV
            csv_key = f"{S3_PROCESSED_PREFIX}{name}-{timestamp}.csv"
            csv_buffer = df.to_csv(index=False)
            s3_client.put_object(Bucket=S3_BUCKET, Key=csv_key, Body=csv_buffer)
            print(f"   ✓ Saved s3://{S3_BUCKET}/{csv_key}")

            # Save as JSON for SageMaker
            json_key = f"{S3_PROCESSED_PREFIX}{name}-{timestamp}.json"
            json_buffer = df.to_json(orient='records')
            s3_client.put_object(Bucket=S3_BUCKET, Key=json_key, Body=json_buffer)
            print(f"   ✓ Saved s3://{S3_BUCKET}/{json_key}")

        # Save feature metadata
        feature_metadata = {
            'feature_count': 25,
            'features': {
                'iops_metrics': ['read_iops', 'write_iops', 'total_iops', 'iops_variance'],
                'latency': ['avg_latency', 'p95_latency', 'p99_latency', 'latency_spike_count'],
                'throughput': ['bandwidth_mbps', 'throughput_variance'],
                'error_rates': ['error_rate', 'error_trend'],
                'time_based': ['hour_of_day', 'day_of_week', 'time_since_last_alert'],
                'pattern': ['sequential_access_ratio', 'random_access_ratio'],
                'device': ['queue_depth', 'io_size_avg', 'io_size_variance'],
                'derived': ['iops_per_latency', 'anomaly_score', 'trend_score', 'load_factor', 'efficiency_ratio']
            },
            'scaler_params': {
                'mean': self.scaler.mean_.tolist() if hasattr(self.scaler, 'mean_') else [],
                'scale': self.scaler.scale_.tolist() if hasattr(self.scaler, 'scale_') else []
            },
            'dataset_sizes': {
                'train': len(train_df),
                'validation': len(val_df),
                'test': len(test_df)
            },
            'created_at': timestamp
        }

        metadata_key = f"{S3_PROCESSED_PREFIX}feature-metadata-{timestamp}.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=metadata_key,
            Body=json.dumps(feature_metadata, indent=2)
        )
        print(f"   ✓ Saved s3://{S3_BUCKET}/{metadata_key}")

        print("\n✅ All datasets saved to S3")


def main():
    """Main execution"""
    print("🚀 Starting Feature Engineering Pipeline\n")

    # Initialize feature engineer
    engineer = FeatureEngineer()

    # Find latest raw data file in S3
    print("🔍 Finding latest raw data file...")
    response = s3_client.list_objects_v2(Bucket=S3_BUCKET, Prefix=S3_RAW_PREFIX)
    if 'Contents' not in response or len(response['Contents']) == 0:
        print("❌ No raw data files found in S3")
        print(f"   Please run generate-training-data.ts first to create data")
        return

    latest_file = sorted(response['Contents'], key=lambda x: x['LastModified'])[-1]
    file_key = latest_file['Key']
    print(f"   ✓ Found: s3://{S3_BUCKET}/{file_key}\n")

    # Load raw data
    raw_df = engineer.load_data_from_s3(file_key)

    # Extract features
    features_df = engineer.extract_features(raw_df)

    # Split data
    train_df, val_df, test_df = engineer.split_data(features_df)

    # Normalize features
    train_df, val_df, test_df = engineer.normalize_features(train_df, val_df, test_df)

    # Save to S3
    engineer.save_to_s3(train_df, val_df, test_df)

    print("\n🎉 Feature Engineering Complete!")
    print("\n📊 Summary:")
    print(f"   • Features extracted: 25")
    print(f"   • Training samples: {len(train_df)}")
    print(f"   • Validation samples: {len(val_df)}")
    print(f"   • Test samples: {len(test_df)}")
    print(f"   • Total processed: {len(train_df) + len(val_df) + len(test_df)}")


if __name__ == '__main__':
    main()
