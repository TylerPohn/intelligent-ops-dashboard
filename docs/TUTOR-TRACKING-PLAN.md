# Tutor Tracking Implementation Plan

## Overview
Add tutors as first-class entities in the system with their own health predictions using the existing SageMaker endpoint.

## Implementation Steps

### 1. Stream Processor Enhancement
**File:** `lambda/stream-processor/index.ts`

**Add tutor aggregation logic:**
- Track `session_completed` events → aggregate tutor metrics
- Track `tutor_availability_updated` events → update tutor profile
- Create/update `entity_type='tutor'` records in DynamoDB

**Tutor Metrics to Track (46 features):**

#### Session Performance (13 features)
- sessions_7d, sessions_14d, sessions_30d
- sessions_completed_7d, sessions_completed_14d, sessions_completed_30d
- avg_session_duration_min
- session_completion_rate (completed / started)
- no_show_rate, cancellation_rate
- days_since_last_session
- session_frequency_7d, session_frequency_14d

#### Student Satisfaction (8 features)
- avg_rating (from students)
- rating_trend (improving/declining)
- rating_volatility
- positive_reviews_count_30d
- negative_reviews_count_30d (< 3 stars)
- student_retention_rate (returning students)
- unique_students_30d
- avg_student_lifetime_sessions

#### Availability & Capacity (6 features)
- available_hours_this_week
- available_hours_next_week
- utilization_rate (booked / available)
- instant_book_enabled
- avg_response_time_hours
- booking_lead_time_avg_hours

#### Subject Expertise (10 features)
- primary_subject_count
- subject_diversity_score
- avg_rating_by_subject (weighted)
- sessions_per_subject_30d
- subject_match_accuracy (student needs → tutor expertise)
- certification_count
- years_of_experience
- specialization_score
- advanced_topics_count
- student_grade_improvement_avg

#### Financial & Business (9 features)
- total_earnings_30d
- avg_earnings_per_session
- earnings_trend (growing/stable/declining)
- premium_tier_sessions_ratio
- discount_sessions_ratio
- payment_disputes_count_30d
- refund_rate_30d
- pricing_competitiveness_score
- revenue_per_available_hour

### 2. AI Lambda Enhancement
**File:** `lambda/ai-analysis/handler.py`

**Add tutor processing:**
```python
def lambda_handler(event, context):
    # Process students (existing)
    student_results = process_entity_type('student')

    # Process tutors (NEW)
    tutor_results = process_entity_type('tutor')

    return {
        'students_processed': len(student_results),
        'tutors_processed': len(tutor_results),
        'total_processed': len(student_results) + len(tutor_results)
    }
```

**Tutor Feature Engineering:**
- Same 46 features as students but tutor-centric
- Reuse existing SageMaker endpoint
- Store predictions with `entity_type='tutor'`

**Tutor Predictions (5 outputs):**
1. **burnout_risk** (0-1) - Risk of tutor leaving platform
2. **session_velocity** (sessions/week) - Predicted booking rate
3. **churn_risk_14d** (0-1) - 14-day tutor churn probability
4. **churn_risk_30d** (0-1) - 30-day tutor churn probability
5. **health_score** (0-100) - Overall tutor engagement score

**Tutor Segmentation:**
- **Star Tutors:** health > 80, low burnout, high availability
- **Healthy:** health 60-80, stable performance
- **At-Risk:** health 40-60, declining ratings or burnout signs
- **Churning:** health < 40, high burnout risk, low availability

### 3. Event Generator Update
**File:** `scripts/generate-tutor-events.sh`

**Add tutor record creation:**
```bash
# After session_completed event, aggregate tutor metrics
# POST to a new endpoint that creates/updates tutor records
```

**Or create dedicated script:** `scripts/seed-tutor-data.sh`
- Generate 100-500 tutor records
- Populate with realistic metrics across all 46 features
- Store as `entity_type='tutor'` in DynamoDB

### 4. Dashboard Updates
**Files:**
- `frontend/src/api/client.ts` - Add tutor API methods
- `frontend/src/components/TutorDashboard.tsx` (NEW)
- `frontend/src/components/TutorHealthChart.tsx` (NEW)

**Features:**
- Separate tab for "Tutor Health"
- Show tutor segmentation (Star/Healthy/At-Risk/Churning)
- Alert on high burnout risk tutors
- Show tutor capacity vs demand

### 5. Insights API Enhancement
**File:** `lambda/api/get-insights.ts`

**Add tutor filtering:**
```typescript
// GET /insights/recent?entity_type=tutor
// GET /insights/aggregations?entity_type=tutor
// GET /insights/{tutorId}
```

## SageMaker Endpoint Compatibility

**The existing marketplace-health-endpoint can handle tutors because:**
1. **Input:** 46 features (same count for students and tutors)
2. **Output:** 5 predictions (interpretations differ but structure matches)
3. **Model:** TensorFlow multi-task neural network (entity-agnostic)

**Feature mapping:**
- Student `sessions_7d` → Tutor `sessions_taught_7d`
- Student `avg_rating` → Tutor `avg_student_rating`
- Student `payment_success_rate` → Tutor `earnings_stability`

## Implementation Priority

1. ✅ **Phase 1:** Stream processor tutor aggregation (REQUIRED)
2. ✅ **Phase 2:** AI Lambda tutor processing (REQUIRED)
3. **Phase 3:** Dashboard tutor health view (NICE TO HAVE)
4. **Phase 4:** Tutor-specific alerts and interventions (NICE TO HAVE)

## Benefits

- **Supply-side health monitoring:** Predict tutor churn before it happens
- **Capacity planning:** Know when tutors are at burnout risk
- **Quality assurance:** Identify declining tutor performance early
- **Marketplace balance:** Monitor tutor supply vs student demand
- **Same infrastructure:** Reuses existing SageMaker endpoint ($52/month)

## Timeline

- Stream Processor: 1-2 hours
- AI Lambda Update: 1-2 hours
- Testing: 1 hour
- Dashboard (optional): 2-3 hours

**Total: 3-5 hours core implementation, 8 hours with dashboard**
