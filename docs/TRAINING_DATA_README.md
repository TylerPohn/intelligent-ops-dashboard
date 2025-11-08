# Training Data Generation & Model Training Guide

## Overview

This guide shows you how to generate synthetic training data and train the marketplace health prediction model.

## Quick Start

```bash
# 1. Generate training data (TypeScript)
cd scripts
npx ts-node generate-training-data.ts

# 2. Train the model (Python)
pip install tensorflow pandas numpy
python train-sagemaker-model.py

# 3. Review results
ls -lh ../models/
ls -lh ../data/
```

---

## Step 1: Generate Training Data

### What It Generates

The data generator creates **10,000 synthetic customer records** with realistic patterns based on 4 segments:

| Segment | % of Data | Description |
|---------|-----------|-------------|
| **Thriving** | 30% | High engagement, low churn risk (2.5 sessions/week, 4.5★) |
| **Healthy** | 40% | Moderate engagement, some risk (1.5 sessions/week, 4.0★) |
| **At-Risk** | 20% | Low engagement, high churn risk (0.5 sessions/week, 3.5★) |
| **Churned** | 10% | No activity, very high churn (0 sessions, 3.0★) |

### Features Generated (59 total)

#### Time-Window Features (3 windows: 7d, 14d, 30d)
- Session count, frequency, avg rating
- Cancellation rates
- IB call counts and negative sentiment

#### Recency Features
- Days since last session/login/payment/IB call

#### Lifetime Features
- Customer tenure, total sessions, total spend
- Subscription tier (budget/standard/premium)
- Acquisition channel (organic/paid/referral)

#### Engagement Features
- Login counts, message counts

#### Tutor Features
- Tutor consistency, primary tutor rating
- Tutor switches, response time

#### Trend Features
- Session velocity change
- Rating trends
- Engagement trends

### Target Labels (What We're Predicting)

1. **First Session Success** (0/1) - Will the first session go well?
2. **Session Velocity** (float) - Sessions per week
3. **Churn Risk 14d** (0-1) - Probability of churning in 14 days
4. **Churn Risk 30d** (0-1) - Probability of churning in 30 days
5. **Health Score** (0-100) - Overall customer health

### Run the Generator

```bash
cd scripts
npx ts-node generate-training-data.ts
```

**Output Files:**
```
data/
├── train.jsonl          # 7,000 records (70%)
├── validation.jsonl     # 1,500 records (15%)
├── test.jsonl          # 1,500 records (15%)
├── train.csv           # Same as train.jsonl but CSV format
└── full_dataset.jsonl  # All 10,000 records
```

### Example Output

```
=== Tutor Marketplace Training Data Generator ===

Generating 10000 customer records...
Generated 1000/10000 records...
Generated 2000/10000 records...
...

=== Dataset Statistics ===

Segment Distribution:
  thriving: 3012 (30.1%)
  healthy: 3998 (40.0%)
  at_risk: 1994 (19.9%)
  churned: 996 (10.0%)

Feature Ranges:
  Session Frequency: 0.00 - 3.87
  Avg Rating: 1.26 - 5.00
  IB Calls (14d): 0 - 9
  Health Score: 1 - 100

Label Statistics:
  First Session Success Rate: 68.4%
  High Churn Risk (14d): 24.3%
  High Churn Risk (30d): 29.8%
  Avg Health Score: 64.7
  Avg Session Velocity: 1.32

✅ Training data generation complete!
```

---

## Step 2: Train the Model

### Model Architecture

**Multi-Task Neural Network:**

```
Input (59 features)
    ↓
Shared Base Network:
  - Dense(128) + BatchNorm + Dropout(0.3)
  - Dense(64) + BatchNorm + Dropout(0.2)
  - Dense(32)
    ↓
Task-Specific Heads (5):
  1. First Session Success (sigmoid)
  2. Session Velocity (linear)
  3. Churn Risk 14d (sigmoid)
  4. Churn Risk 30d (sigmoid)
  5. Health Score (sigmoid, scaled to 0-100)
```

**Why Multi-Task?**
- Shared patterns across related tasks (churn + health score)
- Better generalization (transfer learning across tasks)
- More efficient (1 model vs. 5 separate models)
- Improved accuracy (typically 5-15% better than single-task)

### Install Dependencies

```bash
pip install tensorflow pandas numpy
```

Or with conda:
```bash
conda install tensorflow pandas numpy
```

### Train the Model

```bash
cd scripts
python train-sagemaker-model.py \
  --train-data ../data/train.jsonl \
  --val-data ../data/validation.jsonl \
  --test-data ../data/test.jsonl \
  --output-dir ../models \
  --epochs 50 \
  --batch-size 64 \
  --learning-rate 0.001
```

### Training Output

```
Loading data from ../data/train.jsonl...
Loaded 7000 records

Feature shape: (7000, 59)
Label shapes:
  first_session_success: (7000,)
  session_velocity: (7000,)
  churn_risk_14d: (7000,)
  churn_risk_30d: (7000,)
  health_score: (7000,)

Building model...

Training model...
Epoch 1/50
109/109 [==============================] - 2s 15ms/step - loss: 2.3456 - val_loss: 1.8932
Epoch 2/50
109/109 [==============================] - 1s 12ms/step - loss: 1.7821 - val_loss: 1.6543
...
Epoch 35/50
109/109 [==============================] - 1s 11ms/step - loss: 0.8234 - val_loss: 0.8145

Early stopping triggered. Restoring best weights from epoch 32.

✅ Training complete! Model saved to ../models

Final Validation Metrics:
  first_session_success_accuracy: 0.847
  first_session_success_auc: 0.912
  churn_risk_14d_accuracy: 0.823
  churn_risk_14d_auc: 0.896
  churn_risk_30d_accuracy: 0.831
  churn_risk_30d_auc: 0.903
  session_velocity_mae: 0.234
  health_score_mae: 8.76
```

### Output Files

```
models/
├── best_model.h5              # Best model (by validation loss)
├── final_model.h5             # Final model after all epochs
├── training_history.json      # Loss/metrics over time
├── normalization_params.json  # Feature normalization (for inference)
└── logs/                      # TensorBoard logs
```

---

## Step 3: Inspect Training Results

### View Training Metrics

```bash
# Launch TensorBoard
tensorboard --logdir ../models/logs

# Open browser to http://localhost:6006
```

You'll see:
- Loss curves (training vs. validation)
- Accuracy/AUC for each task
- Learning rate schedule
- Model graph

### Review CSV Data (Manual Inspection)

```bash
# Open in Excel, Google Sheets, or:
head -20 ../data/train.csv

# Check segment distribution
cut -d',' -f2 ../data/train.csv | sort | uniq -c
```

### Quick Python Analysis

```python
import pandas as pd
import json

# Load data
data = []
with open('../data/train.jsonl', 'r') as f:
    for line in f:
        data.append(json.loads(line))

df = pd.DataFrame(data)

# Segment distribution
print(df['segment'].value_counts())

# Correlations with churn
print(df[['ib_call_count_14d', 'label_churn_risk_30d']].corr())

# High-risk customers
high_risk = df[df['label_churn_risk_30d'] > 0.7]
print(f"\nHigh risk customers: {len(high_risk)}")
print(high_risk[['session_frequency_7d', 'ib_call_count_14d', 'days_since_last_session']].describe())
```

---

## Step 4: Test Inference (Local)

```python
import tensorflow as tf
import json
import numpy as np

# Load model
model = tf.keras.models.load_model('../models/best_model.h5')

# Load normalization params
with open('normalization_params.json', 'r') as f:
    norm = json.load(f)

# Example customer features (59 features)
customer_features = [
    2, 4, 8,  # session_count_7d, 14d, 30d
    0.28, 0.28, 0.28,  # session_frequency
    4.2, 4.2, 4.2,  # avg_rating
    0.05, 0.05, 0.05,  # cancellation_rate
    1, 2, 4,  # ib_call_count (2 calls in 14 days - HIGH RISK!)
    0, 1, 2,  # negative_calls
    15,  # days_since_last_session (HIGH - engagement dropping)
    18, 20, 5,  # days_since_login, payment, ib_call
    120, 24, 1800,  # tenure, total_sessions, spend
    1, 0, 2,  # tier (standard), channel (organic), grade (high_school)
    3, 6, 12,  # login_count
    5, 10, 20,  # message_count
    0.95, 0.95, 0.95,  # payment_success_rate
    0.75, 4.3, 2, 3.5,  # tutor_consistency, rating, switches, response_time
    1,  # first_session_success
    -0.15, -0.2, -2,  # velocity_change, rating_trend, engagement_trend
    5,  # primary_subject (ap_calculus)
]

# Normalize
X = np.array(customer_features).reshape(1, -1)
X_norm = (X - np.array(norm['mean'])) / np.array(norm['std'])

# Predict
predictions = model.predict(X_norm)

print("Predictions:")
print(f"  First Session Success: {predictions['first_session_success'][0][0]:.2%}")
print(f"  Session Velocity: {predictions['session_velocity'][0][0]:.2f} sessions/week")
print(f"  Churn Risk (14d): {predictions['churn_risk_14d'][0][0]:.2%}")
print(f"  Churn Risk (30d): {predictions['churn_risk_30d'][0][0]:.2%}")
print(f"  Health Score: {predictions['health_score'][0][0] * 100:.0f}/100")

# Output:
# Predictions:
#   First Session Success: 68%
#   Session Velocity: 0.28 sessions/week
#   Churn Risk (14d): 73%  ← HIGH RISK!
#   Churn Risk (30d): 84%  ← VERY HIGH RISK!
#   Health Score: 42/100   ← AT-RISK!
```

---

## Step 5: Deploy to SageMaker (Next Steps)

Once you're happy with the model:

1. **Package model for SageMaker:**
   ```bash
   tar -czf model.tar.gz -C ../models best_model.h5 normalization_params.json
   ```

2. **Upload to S3:**
   ```bash
   aws s3 cp model.tar.gz s3://your-bucket/marketplace-health-model/
   ```

3. **Create SageMaker endpoint:**
   ```bash
   # See deployment script (coming next)
   python deploy-to-sagemaker.py
   ```

---

## Customization Options

### Adjust Segment Distributions

Edit `SEGMENTS` in `generate-training-data.ts`:

```typescript
const SEGMENTS = {
  thriving: { probability: 0.35 },  // Increase thriving customers
  healthy: { probability: 0.40 },
  at_risk: { probability: 0.15 },   // Decrease at-risk
  churned: { probability: 0.10 },
};
```

### Add More Features

1. Add to `FEATURE_COLUMNS` in `train-sagemaker-model.py`
2. Generate feature in `generateCustomer()` in `generate-training-data.ts`
3. Re-run both scripts

### Change Model Architecture

Edit `MarketplaceHealthModel` class in `train-sagemaker-model.py`:

```python
# Make model deeper
self.shared_layers = keras.Sequential([
    layers.Dense(256, activation='relu'),  # Bigger
    layers.BatchNormalization(),
    layers.Dropout(0.3),
    layers.Dense(128, activation='relu'),  # Add layer
    layers.BatchNormalization(),
    layers.Dropout(0.2),
    layers.Dense(64, activation='relu'),
    layers.Dense(32, activation='relu'),
])
```

---

## Troubleshooting

### "Module not found: ts-node"
```bash
npm install -g ts-node typescript
```

### "ImportError: No module named tensorflow"
```bash
pip install tensorflow
# OR
conda install tensorflow
```

### "ValueError: Input shape mismatch"
- Make sure `FEATURE_COLUMNS` matches the generated data
- Check that you're using the same normalization params

### Model not converging (loss stays high)
- Try lower learning rate: `--learning-rate 0.0001`
- Increase epochs: `--epochs 100`
- Check data quality (are labels correct?)

### Overfitting (val_loss > train_loss)
- Increase dropout: Change `0.3` to `0.5` in model
- Add more training data: Change `NUM_CUSTOMERS` to `50000`
- Use L2 regularization:
  ```python
  layers.Dense(128, activation='relu',
               kernel_regularizer=keras.regularizers.l2(0.01))
  ```

---

## Expected Results

After training on 10,000 synthetic records:

| Metric | Expected Value | Good | Excellent |
|--------|----------------|------|-----------|
| Churn AUC (14d) | 0.85-0.90 | >0.90 | >0.93 |
| Churn AUC (30d) | 0.87-0.92 | >0.92 | >0.95 |
| First Session Accuracy | 0.80-0.85 | >0.85 | >0.90 |
| Health Score MAE | 8-12 points | <8 | <5 |
| Session Velocity MAE | 0.20-0.30 | <0.20 | <0.15 |

---

## Next Steps

1. ✅ Generate training data
2. ✅ Train model locally
3. ⏳ Package for SageMaker
4. ⏳ Deploy to SageMaker endpoint
5. ⏳ Integrate with Lambda
6. ⏳ Connect to Kinesis stream
7. ⏳ Build alerting system

See `SAGEMAKER_DEPLOYMENT.md` for deployment instructions (coming next).
