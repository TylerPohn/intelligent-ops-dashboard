import { Card, CardContent, Typography, Box, Skeleton, Stack } from '@mui/material';
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  ComposedChart,
} from 'recharts';
import type { Insight, Aggregations, TimeRange } from '../api/client';

interface InsightTrendsChartProps {
  insights: Insight[];
  loading?: boolean;
  aggregations?: Aggregations; // Used in Dashboard but not here
  timeRange?: TimeRange;
}

// Get bucket configuration based on time range
const getBucketConfig = (timeRange?: TimeRange) => {
  switch (timeRange) {
    case '1h':
      return { intervalMs: 10 * 60 * 1000, label: '10 min' }; // 10 minutes
    case '3h':
      return { intervalMs: 20 * 60 * 1000, label: '20 min' }; // 20 minutes
    case 'today':
      return { intervalMs: 2 * 60 * 60 * 1000, label: '2 hours' }; // 2 hours
    case 'week':
      return { intervalMs: 24 * 60 * 60 * 1000, label: '1 day' }; // 1 day
    default:
      return { intervalMs: 30 * 60 * 1000, label: '30 min' }; // default 30 minutes
  }
};

export default function InsightTrendsChart({ insights, loading = false, timeRange }: InsightTrendsChartProps) {
  // Sort insights by timestamp
  const sortedInsights = [...insights].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const { intervalMs } = getBucketConfig(timeRange);

  let chartData: Array<{ time: string; 'Critical Alerts': number; 'Churn Risks': number }> = [];

  // Get time range bounds - use ACTUAL time range, not just data range
  const now = new Date().getTime();
  let rangeStartTime: number;

  switch (timeRange) {
    case '1h':
      rangeStartTime = now - (60 * 60 * 1000); // 1 hour ago
      break;
    case '3h':
      rangeStartTime = now - (3 * 60 * 60 * 1000); // 3 hours ago
      break;
    case 'today':
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      rangeStartTime = today.getTime(); // Start of today
      break;
    case 'week':
      rangeStartTime = now - (7 * 24 * 60 * 60 * 1000); // 7 days ago
      break;
    default:
      rangeStartTime = now - (24 * 60 * 60 * 1000); // Default 1 day ago
  }

  console.log('📊 Chart Debug:', {
    timeRange,
    intervalMs,
    rangeStart: new Date(rangeStartTime).toISOString(),
    now: new Date(now).toISOString(),
    insightCount: sortedInsights.length,
    firstInsight: sortedInsights[0]?.timestamp,
    lastInsight: sortedInsights[sortedInsights.length - 1]?.timestamp,
  });

  // Create time buckets based on interval for ENTIRE time range
  const buckets = new Map<number, { critical: number; churn: number; timestamp: number }>();

  // Initialize buckets from range start to now
  let currentBucketStart = Math.floor(rangeStartTime / intervalMs) * intervalMs;
  const maxBucketStart = Math.floor(now / intervalMs) * intervalMs;

  let bucketCount = 0;
  while (currentBucketStart <= maxBucketStart) {
    buckets.set(currentBucketStart, { critical: 0, churn: 0, timestamp: currentBucketStart });
    currentBucketStart += intervalMs;
    bucketCount++;
  }

  console.log(`📊 Created ${bucketCount} time buckets`);

  // Assign insights to buckets (only if we have insights)
  let assignedCount = 0;
  if (sortedInsights.length > 0) {
    sortedInsights.forEach((insight, idx) => {
      // Ensure timestamp is parsed as UTC by appending 'Z' if not present
      const timestamp = insight.timestamp.endsWith('Z') ? insight.timestamp : insight.timestamp + 'Z';
      const insightTime = new Date(timestamp).getTime();
      const bucketStart = Math.floor(insightTime / intervalMs) * intervalMs;

      const bucket = buckets.get(bucketStart);
      if (bucket) {
        if (insight.risk_score >= 80) {
          bucket.critical++;
        }
        if (insight.prediction_type === 'churn_risk') {
          bucket.churn++;
        }
        assignedCount++;
      } else {
        if (idx < 5) { // Only log first 5 misses
          console.warn(`❌ No bucket for insight at ${new Date(insightTime).toISOString()}, bucketStart would be ${new Date(bucketStart).toISOString()}`);
        }
      }
    });

    console.log(`📊 Assigned ${assignedCount} / ${sortedInsights.length} insights to buckets`);
  }

  // Convert to chart data - SHOW ALL BUCKETS including zeros
  chartData = Array.from(buckets.values())
    .map(bucket => {
      const date = new Date(bucket.timestamp);
      let timeLabel: string;

      if (timeRange === 'week') {
        // For week view, show day of week
        timeLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      } else if (timeRange === 'today') {
        // For today, show hour
        timeLabel = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      } else {
        // For 1h and 3h, show time
        timeLabel = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      }

      return {
        time: timeLabel,
        'Critical Alerts': bucket.critical,
        'Churn Risks': bucket.churn,
      };
    });
    // Don't filter - show all buckets including zeros for proper time distribution

  const nonZeroBuckets = chartData.filter(d => d['Critical Alerts'] > 0 || d['Churn Risks'] > 0).length;
  console.log(`📊 Chart has ${chartData.length} total buckets, ${nonZeroBuckets} with data`);

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" component="div" gutterBottom>
            Alert Distribution Over Time
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Distribution of critical alerts and churn risks across generated insights
          </Typography>
        </Box>

        {loading ? (
          <Stack spacing={2}>
            <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
            <Skeleton variant="rectangular" height={260} sx={{ borderRadius: 2 }} />
          </Stack>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
            >
              <defs>
                <linearGradient id="criticalGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="churnGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 12 }}
                stroke="#9e9e9e"
              />
              <YAxis
                label={{
                  value: 'Count',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fontSize: 12, fill: '#9e9e9e' },
                }}
                tick={{ fontSize: 12 }}
                stroke="#9e9e9e"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e1e1e',
                  border: '1px solid #667eea',
                  borderRadius: 12,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                  padding: '12px',
                  color: '#ffffff',
                }}
                labelStyle={{
                  color: '#ffffff',
                  fontWeight: 600,
                  marginBottom: '8px',
                }}
                itemStyle={{
                  color: '#e0e0e0',
                }}
                formatter={(value: number, name: string) => {
                  const colorMap: Record<string, string> = {
                    'Critical Alerts': '#ef4444',
                    'Churn Risks': '#f59e0b',
                  };
                  return [
                    <span style={{ color: colorMap[name] || '#e0e0e0', fontWeight: 600 }}>
                      {value}
                    </span>,
                    name
                  ];
                }}
                labelFormatter={(label: string) => {
                  return `Time: ${label}`;
                }}
                cursor={{ fill: 'rgba(102, 126, 234, 0.1)' }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                iconType="circle"
              />
              <Area
                type="monotone"
                dataKey="Critical Alerts"
                fill="url(#criticalGradient)"
                stroke="none"
                animationDuration={1000}
                animationEasing="ease-out"
                legendType="none"
                hide={true}
              />
              <Line
                type="monotone"
                dataKey="Critical Alerts"
                stroke="#ef4444"
                strokeWidth={3}
                dot={{ r: 5, fill: '#ef4444', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 7, fill: '#ef4444', strokeWidth: 3, stroke: '#fff' }}
                animationDuration={1000}
                animationEasing="ease-out"
                name="Critical Alerts"
              />
              <Area
                type="monotone"
                dataKey="Churn Risks"
                fill="url(#churnGradient)"
                stroke="none"
                animationDuration={1000}
                animationEasing="ease-out"
                legendType="none"
                hide={true}
              />
              <Line
                type="monotone"
                dataKey="Churn Risks"
                stroke="#f59e0b"
                strokeWidth={3}
                dot={{ r: 5, fill: '#f59e0b', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 7, fill: '#f59e0b', strokeWidth: 3, stroke: '#fff' }}
                animationDuration={1000}
                animationEasing="ease-out"
                name="Churn Risks"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
