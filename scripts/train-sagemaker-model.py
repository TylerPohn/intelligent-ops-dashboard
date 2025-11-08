"""
SageMaker Multi-Task Model Training Script

Trains a single neural network to predict marketplace health metrics.
This version is compatible with SageMaker's training environment.
"""

import json
import numpy as np
import pandas as pd
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
import argparse
import os
from typing import Dict, Tuple

# Feature columns
FEATURE_COLUMNS = [
    'session_count_7d', 'session_count_14d', 'session_count_30d',
    'session_frequency_7d', 'session_frequency_14d', 'session_frequency_30d',
    'avg_rating_7d', 'avg_rating_14d', 'avg_rating_30d',
    'cancellation_rate_7d', 'cancellation_rate_14d', 'cancellation_rate_30d',
    'ib_call_count_7d', 'ib_call_count_14d', 'ib_call_count_30d',
    'negative_calls_7d', 'negative_calls_14d', 'negative_calls_30d',
    'days_since_last_session', 'days_since_last_login',
    'days_since_last_payment', 'days_since_last_ib_call',
    'customer_tenure_days', 'total_sessions_lifetime', 'total_spend_lifetime',
    'subscription_tier', 'acquisition_channel', 'grade_level',
    'login_count_7d', 'login_count_14d', 'login_count_30d',
    'message_count_7d', 'message_count_14d', 'message_count_30d',
    'payment_success_rate_7d', 'payment_success_rate_14d', 'payment_success_rate_30d',
    'tutor_consistency_score', 'primary_tutor_rating',
    'tutor_switch_count_30d', 'avg_tutor_response_time_hours',
    'first_session_was_success',
    'session_velocity_change', 'rating_trend', 'engagement_trend',
    'primary_subject',
]

TARGET_COLUMNS = [
    'label_first_session_success',
    'label_session_velocity',
    'label_churn_risk_14d',
    'label_churn_risk_30d',
    'label_health_score',
]


def load_data(data_dir: str) -> pd.DataFrame:
    """Load JSONL data from SageMaker input directory."""
    print(f"Loading data from {data_dir}...")

    # SageMaker puts data in /opt/ml/input/data/<channel_name>/
    data_files = []
    for root, dirs, files in os.walk(data_dir):
        for file in files:
            if file.endswith('.jsonl'):
                data_files.append(os.path.join(root, file))

    if not data_files:
        raise ValueError(f"No .jsonl files found in {data_dir}")

    print(f"Found data files: {data_files}")

    data = []
    for file_path in data_files:
        with open(file_path, 'r') as f:
            for line in f:
                data.append(json.loads(line))

    df = pd.DataFrame(data)
    print(f"Loaded {len(df)} records")

    return df


def prepare_features(df: pd.DataFrame, save_norm_params: bool = False) -> Tuple[np.ndarray, Dict]:
    """Extract and normalize features."""

    X = df[FEATURE_COLUMNS].values

    # Normalize
    X_mean = X.mean(axis=0)
    X_std = X.std(axis=0) + 1e-7
    X_normalized = (X - X_mean) / X_std

    if save_norm_params:
        norm_params = {
            'mean': X_mean.tolist(),
            'std': X_std.tolist(),
            'feature_names': FEATURE_COLUMNS
        }
        # Save to model directory
        model_dir = os.environ.get('SM_MODEL_DIR', '/opt/ml/model')
        with open(os.path.join(model_dir, 'normalization_params.json'), 'w') as f:
            json.dump(norm_params, f, indent=2)
        print(f"Saved normalization params to {model_dir}")

    # Labels
    y = {
        'first_session_success': df['label_first_session_success'].values.astype(np.float32),
        'session_velocity': df['label_session_velocity'].values.astype(np.float32),
        'churn_risk_14d': df['label_churn_risk_14d'].values.astype(np.float32),
        'churn_risk_30d': df['label_churn_risk_30d'].values.astype(np.float32),
        'health_score': df['label_health_score'].values.astype(np.float32) / 100.0,
    }

    return X_normalized, y


class MarketplaceHealthModel(keras.Model):
    """Multi-task learning model."""

    def __init__(self, input_dim: int = 59):
        super().__init__()

        self.shared_layers = keras.Sequential([
            layers.Dense(128, activation='relu'),
            layers.BatchNormalization(),
            layers.Dropout(0.3),
            layers.Dense(64, activation='relu'),
            layers.BatchNormalization(),
            layers.Dropout(0.2),
            layers.Dense(32, activation='relu'),
        ])

        self.first_session_head = keras.Sequential([
            layers.Dense(16, activation='relu'),
            layers.Dense(1, activation='sigmoid')
        ])

        self.session_velocity_head = keras.Sequential([
            layers.Dense(16, activation='relu'),
            layers.Dense(1, activation='linear')
        ])

        self.churn_14d_head = keras.Sequential([
            layers.Dense(16, activation='relu'),
            layers.Dense(1, activation='sigmoid')
        ])

        self.churn_30d_head = keras.Sequential([
            layers.Dense(16, activation='relu'),
            layers.Dense(1, activation='sigmoid')
        ])

        self.health_score_head = keras.Sequential([
            layers.Dense(16, activation='relu'),
            layers.Dense(1, activation='sigmoid')
        ])

    def call(self, inputs):
        shared = self.shared_layers(inputs)

        return {
            'first_session_success': self.first_session_head(shared),
            'session_velocity': self.session_velocity_head(shared),
            'churn_risk_14d': self.churn_14d_head(shared),
            'churn_risk_30d': self.churn_30d_head(shared),
            'health_score': self.health_score_head(shared),
        }


def main():
    parser = argparse.ArgumentParser()

    # SageMaker parameters (ignored, we use env vars instead)
    parser.add_argument('--model_dir', type=str, default='/opt/ml/model')
    parser.add_argument('--train', type=str, default='/opt/ml/input/data/train')
    parser.add_argument('--validation', type=str, default='/opt/ml/input/data/validation')

    # Hyperparameters
    parser.add_argument('--epochs', type=int, default=50)
    parser.add_argument('--batch-size', type=int, default=64)
    parser.add_argument('--learning-rate', type=float, default=0.001)

    args = parser.parse_args()

    # CRITICAL: Always use local paths, never S3 paths
    # SageMaker uploads from /opt/ml/model to S3 automatically
    args.model_dir = os.environ.get('SM_MODEL_DIR', '/opt/ml/model')
    args.train = os.environ.get('SM_CHANNEL_TRAIN', '/opt/ml/input/data/train')
    args.validation = os.environ.get('SM_CHANNEL_VALIDATION', '/opt/ml/input/data/validation')

    print("=" * 60)
    print("SageMaker Training Starting")
    print("=" * 60)
    print(f"Model dir: {args.model_dir}")
    print(f"Train dir: {args.train}")
    print(f"Validation dir: {args.validation}")
    print(f"Epochs: {args.epochs}")
    print(f"Batch size: {args.batch_size}")
    print(f"Learning rate: {args.learning_rate}")
    print("=" * 60)

    # Load data
    train_df = load_data(args.train)
    val_df = load_data(args.validation)

    # Prepare features
    X_train, y_train = prepare_features(train_df, save_norm_params=True)
    X_val, y_val = prepare_features(val_df)

    print(f"\nFeature shape: {X_train.shape}")
    print(f"Training samples: {len(X_train)}")
    print(f"Validation samples: {len(X_val)}")

    # Build model
    print("\nBuilding model...")
    model = MarketplaceHealthModel(input_dim=len(FEATURE_COLUMNS))

    # Compile
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=args.learning_rate),
        loss={
            'first_session_success': 'binary_crossentropy',
            'session_velocity': 'mse',
            'churn_risk_14d': 'binary_crossentropy',
            'churn_risk_30d': 'binary_crossentropy',
            'health_score': 'mse',
        },
        loss_weights={
            'first_session_success': 1.0,
            'session_velocity': 0.5,
            'churn_risk_14d': 2.0,
            'churn_risk_30d': 2.0,
            'health_score': 1.5,
        },
        metrics={
            'first_session_success': ['accuracy', keras.metrics.AUC(name='auc')],
            'session_velocity': ['mae'],
            'churn_risk_14d': ['accuracy', keras.metrics.AUC(name='auc')],
            'churn_risk_30d': ['accuracy', keras.metrics.AUC(name='auc')],
            'health_score': ['mae'],
        }
    )

    # Callbacks
    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor='val_loss',
            patience=10,
            restore_best_weights=True,
            verbose=1
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor='val_loss',
            factor=0.5,
            patience=5,
            verbose=1,
            min_lr=1e-6
        ),
    ]

    # Train
    print("\nTraining model...")
    print("=" * 60)

    history = model.fit(
        X_train,
        y_train,
        validation_data=(X_val, y_val),
        epochs=args.epochs,
        batch_size=args.batch_size,
        callbacks=callbacks,
        verbose=2
    )

    print("\n" + "=" * 60)
    print("Training Complete!")
    print("=" * 60)

    # Save model (use SavedModel format for custom models)
    # SageMaker will automatically upload everything from model_dir to S3
    model_path = os.path.join(args.model_dir, '1')  # Versioned model directory
    os.makedirs(model_path, exist_ok=True)
    model.save(model_path, save_format='tf')
    print(f"Model saved locally to: {model_path}")
    print("SageMaker will upload model to S3 automatically")

    # Save training history
    history_path = os.path.join(args.model_dir, 'training_history.json')
    history_dict = {}
    for key, values in history.history.items():
        history_dict[key] = [float(v) for v in values]

    with open(history_path, 'w') as f:
        json.dump(history_dict, f, indent=2)
    print(f"Training history saved to: {history_path}")

    # Print final metrics
    print("\nFinal Validation Metrics:")
    val_results = model.evaluate(X_val, y_val, verbose=0)
    print(f"Validation loss: {val_results[0]:.4f}")

    print("\n" + "=" * 60)
    print("SUCCESS!")
    print("=" * 60)


if __name__ == '__main__':
    main()
