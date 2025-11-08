# SageMaker Multi-Task Model Specification

## Model Architecture

### Single Endpoint, Multiple Predictions

```python
import tensorflow as tf
from tensorflow import keras

class MarketplaceHealthModel(keras.Model):
    """
    Multi-task learning model that predicts 6 marketplace health metrics
    from a shared feature representation.
    """

    def __init__(self, input_dim=150):
        super().__init__()

        # Shared base network (learns common patterns)
        self.shared_layers = keras.Sequential([
            keras.layers.Dense(256, activation='relu', name='shared_1'),
            keras.layers.BatchNormalization(),
            keras.layers.Dropout(0.3),
            keras.layers.Dense(128, activation='relu', name='shared_2'),
            keras.layers.BatchNormalization(),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(64, activation='relu', name='shared_3'),
        ])

        # Task-specific heads
        self.first_session_success_head = keras.Sequential([
            keras.layers.Dense(32, activation='relu'),
            keras.layers.Dense(1, activation='sigmoid', name='first_session_success')
        ])

        self.session_velocity_head = keras.Sequential([
            keras.layers.Dense(32, activation='relu'),
            keras.layers.Dense(1, activation='linear', name='session_velocity')
        ])

        self.churn_risk_14d_head = keras.Sequential([
            keras.layers.Dense(32, activation='relu'),
            keras.layers.Dense(1, activation='sigmoid', name='churn_risk_14d')
        ])

        self.churn_risk_30d_head = keras.Sequential([
            keras.layers.Dense(32, activation='relu'),
            keras.layers.Dense(1, activation='sigmoid', name='churn_risk_30d')
        ])

        self.supply_demand_head = keras.Sequential([
            keras.layers.Dense(64, activation='relu'),
            keras.layers.Dense(20, activation='linear', name='supply_demand')  # 20 subjects
        ])

        self.health_score_head = keras.Sequential([
            keras.layers.Dense(32, activation='relu'),
            keras.layers.Dense(1, activation='sigmoid', name='health_score')  # 0-1, scale to 0-100
        ])

    def call(self, inputs):
        # Shared feature extraction
        shared_features = self.shared_layers(inputs)

        # Multi-task predictions
        predictions = {
            'first_session_success': self.first_session_success_head(shared_features),
            'session_velocity': self.session_velocity_head(shared_features),
            'churn_risk_14d': self.churn_risk_14d_head(shared_features),
            'churn_risk_30d': self.churn_risk_30d_head(shared_features),
            'supply_demand': self.supply_demand_head(shared_features),
            'health_score': self.health_score_head(shared_features) * 100  # Scale to 0-100
        }

        return predictions


class MultiTaskLoss:
    """Custom loss function with task-specific weights."""

    def __init__(self):
        self.task_weights = {
            'first_session_success': 1.0,
            'session_velocity': 0.5,
            'churn_risk_14d': 2.0,  # Higher weight for critical tasks
            'churn_risk_30d': 2.0,
            'supply_demand': 1.0,
            'health_score': 1.5
        }

    def __call__(self, y_true, y_pred):
        total_loss = 0

        # Binary cross-entropy for classification tasks
        for task in ['first_session_success', 'churn_risk_14d', 'churn_risk_30d']:
            loss = tf.keras.losses.binary_crossentropy(
                y_true[task], y_pred[task]
            )
            total_loss += self.task_weights[task] * loss

        # MSE for regression tasks
        for task in ['session_velocity', 'supply_demand', 'health_score']:
            loss = tf.keras.losses.mean_squared_error(
                y_true[task], y_pred[task]
            )
            total_loss += self.task_weights[task] * loss

        return total_loss
```

## Training Data Generation

### Synthetic Data for Initial Training

```python
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

def generate_training_data(n_samples=10000):
    """
    Generate synthetic marketplace data for model training.
    Based on realistic customer behavior patterns.
    """
    np.random.seed(42)

    data = []

    for i in range(n_samples):
        # Customer segment
        segment = np.random.choice(['thriving', 'healthy', 'at_risk', 'churned'],
                                    p=[0.3, 0.4, 0.2, 0.1])

        # Generate features based on segment
        if segment == 'thriving':
            session_freq_7d = np.random.normal(2.5, 0.5)
            avg_rating_7d = np.random.normal(4.5, 0.3)
            ib_calls_14d = np.random.poisson(0.2)
            days_since_last_session = np.random.randint(1, 4)
            payment_success_rate = np.random.uniform(0.95, 1.0)
            login_freq = np.random.normal(8, 2)

        elif segment == 'healthy':
            session_freq_7d = np.random.normal(1.5, 0.5)
            avg_rating_7d = np.random.normal(4.0, 0.4)
            ib_calls_14d = np.random.poisson(0.5)
            days_since_last_session = np.random.randint(3, 8)
            payment_success_rate = np.random.uniform(0.9, 0.98)
            login_freq = np.random.normal(5, 2)

        elif segment == 'at_risk':
            session_freq_7d = np.random.normal(0.5, 0.3)
            avg_rating_7d = np.random.normal(3.5, 0.5)
            ib_calls_14d = np.random.poisson(1.5)
            days_since_last_session = np.random.randint(10, 20)
            payment_success_rate = np.random.uniform(0.7, 0.9)
            login_freq = np.random.normal(2, 1)

        else:  # churned
            session_freq_7d = 0
            avg_rating_7d = np.random.normal(3.0, 0.6)
            ib_calls_14d = np.random.poisson(2.5)
            days_since_last_session = np.random.randint(25, 60)
            payment_success_rate = np.random.uniform(0.4, 0.7)
            login_freq = 0

        # Generate all 150 features
        features = {
            # Time-window features (7d)
            'session_count_7d': int(session_freq_7d * 7),
            'session_frequency_7d': max(0, session_freq_7d),
            'avg_rating_7d': np.clip(avg_rating_7d, 1, 5),
            'cancellation_rate_7d': np.random.beta(2, 8),
            'ib_call_count_7d': max(0, int(ib_calls_14d * 0.5)),

            # Time-window features (14d)
            'session_count_14d': int(session_freq_7d * 14),
            'session_frequency_14d': max(0, session_freq_7d),
            'avg_rating_14d': np.clip(avg_rating_7d, 1, 5),
            'ib_call_count_14d': max(0, ib_calls_14d),
            'negative_calls_14d': max(0, int(ib_calls_14d * 0.6)),

            # Time-window features (30d)
            'session_count_30d': int(session_freq_7d * 30),
            'session_frequency_30d': max(0, session_freq_7d),
            'avg_rating_30d': np.clip(avg_rating_7d, 1, 5),
            'ib_call_count_30d': max(0, int(ib_calls_14d * 2)),

            # Recency features
            'days_since_last_session': days_since_last_session,
            'days_since_last_login': days_since_last_session + np.random.randint(0, 3),
            'days_since_last_payment': np.random.randint(1, 30),
            'customer_tenure_days': np.random.randint(30, 365),

            # Engagement
            'login_count_7d': max(0, int(login_freq)),
            'message_count_7d': np.random.poisson(3),

            # Payment
            'payment_success_rate_30d': np.clip(payment_success_rate, 0, 1),
            'total_spend_lifetime': np.random.uniform(500, 5000),

            # Tutor consistency
            'tutor_consistency': np.random.uniform(0.5, 1.0),
            'primary_tutor_rating': np.random.uniform(3.5, 5.0),

            # Subscription tier
            'subscription_tier': np.random.choice([0, 1, 2]),  # budget, standard, premium

            # First session
            'first_session_was_success': np.random.choice([0, 1], p=[0.3, 0.7]),
        }

        # Target labels
        labels = {
            'first_session_success': 1 if features['first_session_was_success'] else 0,
            'session_velocity': session_freq_7d,
            'churn_risk_14d': 1 if segment in ['at_risk', 'churned'] else 0,
            'churn_risk_30d': 1 if segment == 'churned' else 0,
            'supply_demand': np.random.randn(20),  # 20 subjects
            'health_score': {
                'thriving': np.random.uniform(80, 100),
                'healthy': np.random.uniform(60, 79),
                'at_risk': np.random.uniform(40, 59),
                'churned': np.random.uniform(0, 39)
            }[segment]
        }

        data.append({**features, **labels, 'segment': segment})

    return pd.DataFrame(data)


# Generate data
df = generate_training_data(10000)

# Split features and labels
feature_cols = [c for c in df.columns if c not in
                ['first_session_success', 'session_velocity', 'churn_risk_14d',
                 'churn_risk_30d', 'supply_demand', 'health_score', 'segment']]

X = df[feature_cols].values
y = {
    'first_session_success': df['first_session_success'].values,
    'session_velocity': df['session_velocity'].values,
    'churn_risk_14d': df['churn_risk_14d'].values,
    'churn_risk_30d': df['churn_risk_30d'].values,
    'health_score': df['health_score'].values,
}

# Train model
model = MarketplaceHealthModel(input_dim=len(feature_cols))
model.compile(
    optimizer=keras.optimizers.Adam(learning_rate=0.001),
    loss=MultiTaskLoss(),
    metrics={
        'first_session_success': 'accuracy',
        'churn_risk_14d': 'accuracy',
        'churn_risk_30d': 'accuracy',
        'session_velocity': 'mse',
        'health_score': 'mse'
    }
)

model.fit(X, y, epochs=50, batch_size=64, validation_split=0.2)
```

## SageMaker Deployment

### Inference Script (inference.py)

```python
import json
import numpy as np
import tensorflow as tf

def model_fn(model_dir):
    """Load the trained model."""
    model = tf.keras.models.load_model(f'{model_dir}/model.h5')
    return model


def input_fn(request_body, request_content_type):
    """Parse input data."""
    if request_content_type == 'application/json':
        data = json.loads(request_body)
        features = np.array(data['features']).reshape(1, -1)
        return features
    else:
        raise ValueError(f"Unsupported content type: {request_content_type}")


def predict_fn(input_data, model):
    """Run inference."""
    predictions = model.predict(input_data)

    # Convert to standard Python types
    output = {
        'first_session_success_prob': float(predictions['first_session_success'][0][0]),
        'predicted_session_velocity': float(predictions['session_velocity'][0][0]),
        'churn_risk_14d': float(predictions['churn_risk_14d'][0][0]),
        'churn_risk_30d': float(predictions['churn_risk_30d'][0][0]),
        'supply_demand_scores': predictions['supply_demand'][0].tolist(),
        'customer_health_score': float(predictions['health_score'][0][0]),

        # Explainability: Feature importance (using gradient-based attribution)
        'feature_importance': compute_feature_importance(input_data, model)
    }

    return output


def compute_feature_importance(input_data, model):
    """
    Compute feature importance using gradient-based attribution.
    Returns top 10 features driving each prediction.
    """
    with tf.GradientTape() as tape:
        input_tensor = tf.convert_to_tensor(input_data, dtype=tf.float32)
        tape.watch(input_tensor)
        predictions = model(input_tensor)

    # Get gradients for churn prediction (most critical task)
    gradients = tape.gradient(predictions['churn_risk_30d'], input_tensor)
    importance = np.abs(gradients.numpy()[0])

    # Map to feature names (in production, load from config)
    feature_names = [f'feature_{i}' for i in range(len(importance))]
    top_features = sorted(zip(feature_names, importance), key=lambda x: x[1], reverse=True)[:10]

    return [{'feature': name, 'importance': float(score)} for name, score in top_features]


def output_fn(prediction, response_content_type):
    """Format output."""
    if response_content_type == 'application/json':
        return json.dumps(prediction)
    else:
        raise ValueError(f"Unsupported content type: {response_content_type}")
```

### Deployment Script

```python
import boto3
import sagemaker
from sagemaker.tensorflow import TensorFlowModel

# Create SageMaker session
sess = sagemaker.Session()
role = 'arn:aws:iam::YOUR_ACCOUNT:role/SageMakerRole'

# Package model
model_data = 's3://your-bucket/marketplace-health-model/model.tar.gz'

# Create TensorFlow model
tf_model = TensorFlowModel(
    model_data=model_data,
    role=role,
    framework_version='2.13',
    entry_point='inference.py',
    name='marketplace-health-model'
)

# Deploy to endpoint
predictor = tf_model.deploy(
    initial_instance_count=1,
    instance_type='ml.m5.xlarge',  # Can scale to ml.m5.4xlarge if needed
    endpoint_name='marketplace-health-endpoint',
    serializer=sagemaker.serializers.JSONSerializer(),
    deserializer=sagemaker.deserializers.JSONDeserializer()
)

print(f"Endpoint deployed: {predictor.endpoint_name}")
```

## Inference Example

```python
# Sample feature vector (150 features)
features = {
    'session_count_7d': 2,
    'session_frequency_7d': 0.28,
    'avg_rating_7d': 4.2,
    'ib_call_count_14d': 2,  # <-- ALERT: 2 calls in 14 days!
    'days_since_last_session': 15,
    'payment_success_rate_30d': 0.85,
    # ... all 150 features
}

# Call SageMaker endpoint
response = runtime.invoke_endpoint(
    EndpointName='marketplace-health-endpoint',
    ContentType='application/json',
    Body=json.dumps({'features': list(features.values())})
)

predictions = json.loads(response['Body'].read())

# Example output:
{
    "first_session_success_prob": 0.72,
    "predicted_session_velocity": 1.8,
    "churn_risk_14d": 0.68,  # <-- HIGH RISK
    "churn_risk_30d": 0.82,  # <-- VERY HIGH RISK
    "customer_health_score": 42,  # <-- AT-RISK
    "supply_demand_scores": [0.8, -0.3, 1.2, ...],  # Per subject
    "feature_importance": [
        {"feature": "ib_call_count_14d", "importance": 0.45},
        {"feature": "days_since_last_session", "importance": 0.38},
        {"feature": "session_frequency_7d", "importance": 0.32},
        ...
    ]
}
```

## Alert Routing Logic

```python
def route_alerts(customer_id, predictions, features):
    """
    Generate actionable alerts based on predictions.
    """
    alerts = []

    # 1. IB Call Spike Alert
    if features['ib_call_count_14d'] >= 2:
        alerts.append({
            'type': 'IB_CALL_SPIKE',
            'severity': 'CRITICAL',
            'customer_id': customer_id,
            'message': f"Customer has made {features['ib_call_count_14d']} calls in 14 days",
            'churn_risk': predictions['churn_risk_14d'],
            'recommendation': 'Assign retention specialist within 24 hours',
            'expected_impact': 'Reduce churn probability by 40%'
        })

    # 2. Churn Risk Alert
    if predictions['churn_risk_30d'] > 0.6:
        alerts.append({
            'type': 'HIGH_CHURN_RISK',
            'severity': 'HIGH',
            'customer_id': customer_id,
            'churn_probability': predictions['churn_risk_30d'],
            'top_risk_factors': predictions['feature_importance'][:3],
            'recommendation': 'Offer discount or free session credit',
            'expected_impact': 'Reduce churn by 35%'
        })

    # 3. Health Score Alert
    if predictions['customer_health_score'] < 40:
        alerts.append({
            'type': 'HEALTH_SCORE_CRITICAL',
            'severity': 'HIGH',
            'customer_id': customer_id,
            'score': predictions['customer_health_score'],
            'recommendation': 'Proactive outreach + personalized recovery plan',
        })

    # 4. First Session Risk
    if predictions['first_session_success_prob'] < 0.5:
        alerts.append({
            'type': 'FIRST_SESSION_RISK',
            'severity': 'MEDIUM',
            'recommendation': 'Match with top-rated tutor (>4.5 stars)',
        })

    # 5. Session Velocity Drop
    if predictions['predicted_session_velocity'] < 1.0 and features['session_frequency_30d'] > 2.0:
        alerts.append({
            'type': 'SESSION_VELOCITY_DROP',
            'severity': 'MEDIUM',
            'message': 'Session frequency dropped 50%+',
            'recommendation': 'Send re-engagement email campaign',
        })

    return alerts
```

## Model Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Churn prediction accuracy | >80% | AUC-ROC |
| IB call spike precision | >75% | True positive rate |
| Health score MAE | <10 points | Mean absolute error |
| Inference latency | <200ms | p95 |
| False positive rate | <15% | For critical alerts |

## Continuous Improvement

1. **Feedback loop**: Track alert outcomes (did customer churn after ignoring alert?)
2. **Retraining**: Monthly retraining with actual outcomes
3. **A/B testing**: Test different intervention strategies
4. **Feature engineering**: Add new signals based on performance analysis
5. **Model versioning**: Shadow deployments for new model versions

## Cost Estimate

**SageMaker endpoint (ml.m5.xlarge)**:
- $0.269/hour = ~$194/month (24/7 uptime)
- Can use auto-scaling to reduce costs during low-traffic periods
- Alternatively: ml.t3.medium (~$58/month) for lower volume

**Inference cost**:
- <1ms per inference on CPU
- Can handle ~1000 inferences/sec on ml.m5.xlarge
