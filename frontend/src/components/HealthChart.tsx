import { Card, CardContent, Typography, Box, Skeleton, Stack } from '@mui/material';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { Insight, Aggregations } from '../api/client';

interface RiskDistributionChartProps {
  insights: Insight[];
  loading?: boolean;
  aggregations?: Aggregations;
}

export default function RiskDistributionChart({ insights, loading = false, aggregations }: RiskDistributionChartProps) {
  // Use aggregations if available, otherwise calculate from loaded insights
  const predictionTypes = ['customer_health', 'churn_risk', 'session_quality', 'marketplace_balance', 'tutor_capacity', 'first_session_success'];

  const chartData = predictionTypes.map(type => {
    // Prefer aggregations data for accurate counts
    const count = aggregations?.byType?.[type] ?? insights.filter(i => i.prediction_type === type).length;

    // Calculate average risk from loaded insights (approximation)
    const typeInsights = insights.filter(i => i.prediction_type === type);
    const avgRisk = typeInsights.length > 0
      ? typeInsights.reduce((sum, i) => sum + i.risk_score, 0) / typeInsights.length
      : 0;

    return {
      name: type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      'Avg Risk': Number(avgRisk.toFixed(1)),
      'Count': count,
    };
  }).filter(d => d.Count > 0);

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" component="div" gutterBottom>
            Risk Distribution by Category
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Average risk scores across different prediction categories
          </Typography>
        </Box>

        {loading ? (
          <Stack spacing={2}>
            <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
            <Skeleton variant="rectangular" height={260} sx={{ borderRadius: 2 }} />
          </Stack>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
            >
              <defs>
                <linearGradient id="riskGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#667eea" stopOpacity={0.9}/>
                  <stop offset="100%" stopColor="#667eea" stopOpacity={0.3}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                stroke="#9e9e9e"
                angle={-15}
                textAnchor="end"
                height={80}
              />
              <YAxis
                label={{
                  value: 'Average Risk Score',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fontSize: 12, fill: '#9e9e9e' },
                }}
                tick={{ fontSize: 12 }}
                stroke="#9e9e9e"
                domain={[0, 100]}
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
                  if (name === 'Avg Risk') return [`${value.toFixed(1)}/100`, 'Risk Score'];
                  return [value, 'Count'];
                }}
                cursor={{ fill: 'rgba(102, 126, 234, 0.1)' }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                iconType="circle"
              />
              <Bar
                dataKey="Avg Risk"
                fill="url(#riskGradient)"
                radius={[8, 8, 0, 0]}
                animationDuration={800}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
