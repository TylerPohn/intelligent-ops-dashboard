import { Card, CardContent, Typography, Box } from '@mui/material';
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
import type { HealthMetric } from '../api/client';

interface HealthChartProps {
  data: HealthMetric[];
  loading?: boolean;
}

export default function HealthChart({ data, loading = false }: HealthChartProps) {
  // Format data for Recharts
  const chartData = data.map((metric) => ({
    time: new Date(metric.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    CPU: Number(metric.cpu_utilization.toFixed(1)),
    Memory: Number(metric.memory_utilization.toFixed(1)),
    'Disk I/O': Number(metric.disk_io_rate.toFixed(1)),
    Network: Number(metric.network_throughput.toFixed(1)),
  }));

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" component="div" gutterBottom>
            System Health Metrics
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Real-time monitoring of CPU, Memory, Disk I/O, and Network utilization
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
              Loading health metrics...
            </Typography>
          </Box>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
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
                  value: 'Utilization (%)',
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
                formatter={(value: number) => `${value}%`}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                iconType="circle"
              />
              <Bar dataKey="CPU" fill="#667eea" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Memory" fill="#764ba2" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Disk I/O" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Network" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
