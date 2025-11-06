import { Card, CardContent, Typography, Box } from '@mui/material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { SessionMetric } from '../api/client';

interface SessionsChartProps {
  data: SessionMetric[];
  loading?: boolean;
}

export default function SessionsChart({ data, loading = false }: SessionsChartProps) {
  // Format data for Recharts
  const chartData = data.map((metric) => ({
    time: new Date(metric.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    'Active Sessions': metric.active_sessions,
    'Peak Sessions': metric.peak_sessions,
  }));

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" component="div" gutterBottom>
            Active Sessions
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Real-time tracking of active and peak concurrent sessions
          </Typography>
        </Box>

        {loading ? (
          <Box
            sx={{
              height: 300,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              Loading session metrics...
            </Typography>
          </Box>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 12 }}
                stroke="#9e9e9e"
              />
              <YAxis
                label={{
                  value: 'Sessions',
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
                  borderRadius: 8,
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                iconType="circle"
              />
              <Line
                type="monotone"
                dataKey="Active Sessions"
                stroke="#667eea"
                strokeWidth={3}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="Peak Sessions"
                stroke="#764ba2"
                strokeWidth={3}
                strokeDasharray="5 5"
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
