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
import type { Insight, Aggregations } from '../api/client';

interface InsightTrendsChartProps {
  insights: Insight[];
  loading?: boolean;
  aggregations?: Aggregations;
}

export default function InsightTrendsChart({ insights, loading = false }: InsightTrendsChartProps) {
  // Sort insights by timestamp to get distribution
  const sortedInsights = [...insights].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Group insights into buckets (12 time points for better visualization)
  const bucketCount = 12;
  const insightsPerBucket = Math.ceil(sortedInsights.length / bucketCount);

  const chartData = Array.from({ length: bucketCount }, (_, i) => {
    const startIdx = i * insightsPerBucket;
    const endIdx = Math.min(startIdx + insightsPerBucket, sortedInsights.length);
    const bucketInsights = sortedInsights.slice(startIdx, endIdx);

    const criticalCount = bucketInsights.filter(i => i.risk_score >= 80).length;
    const churnCount = bucketInsights.filter(i => i.prediction_type === 'churn_risk').length;

    // Create time label based on the first insight in bucket
    const timeLabel = bucketInsights.length > 0
      ? new Date(bucketInsights[0].timestamp).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit'
        })
      : `T${i + 1}`;

    return {
      time: timeLabel,
      'Critical Alerts': criticalCount,
      'Churn Risks': churnCount,
    };
  }).filter(d => d['Critical Alerts'] > 0 || d['Churn Risks'] > 0); // Only show buckets with data

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
                  backgroundColor: '#ffffff',
                  border: '1px solid #e0e0e0',
                  borderRadius: 12,
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                }}
                cursor={{ stroke: '#667eea', strokeWidth: 2, strokeDasharray: '5 5' }}
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
