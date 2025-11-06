# PR-09: Frontend UI (React + TanStack Query + MUI)

## Overview
Create the React frontend with Vite, Material-UI (MUI v5), TanStack Query v5, and Recharts for data visualization.

## UI Design Inspiration

The dashboard UI design draws inspiration from industry-leading platforms for each section:

### Primary Design Reference: **Datadog**
Overall layout, color scheme, and component structure follows Datadog's DevOps observability platform for consistency and familiarity.

### UI Section Mappings

| Dashboard Section | Design Reference | Rationale |
|------------------|-----------------|-----------|
| **Dashboard Overview** | Datadog | Clean metric cards, real-time graphs, intuitive color coding for operational data |
| **Metrics Explorer** | Grafana | Best-in-class metric visualization, query builder, and dynamic chart controls |
| **Alert Management** | PagerDuty | Industry-standard alert lifecycle management with clear severity indicators |
| **Real-time Monitoring** | AWS CloudWatch | Familiar streaming data visualization with threshold lines and anomaly highlighting |
| **AI Insights Panel** | GitHub Copilot Chat | Clean AI interaction pattern with markdown rendering and contextual suggestions |
| **System Health** | Statuspage.io | Clear component health visualization with traffic light indicators |
| **Configuration/Settings** | Vercel Dashboard | Modern form design with inline validation and minimalist visual hierarchy |

### Design System
- **Color Palette**: Inspired by Datadog's gradient (purple/blue: `#667eea` to `#764ba2`)
- **Typography**: Inter font family for modern, clean readability
- **Components**: MUI v5 with custom theme overrides for professional appearance
- **Dark Mode**: Optional dark theme support (reducing eye strain for ops teams)
- **Responsive**: Mobile-first design patterns from Datadog and Grafana

## Dependencies
- None (can be built independently)

## Objectives
- Initialize Vite + React + TypeScript project
- Set up Material-UI (MUI v5) with custom theme
- Set up TanStack Query v5
- Create dashboard layout with MUI Grid and KPI cards using MUI Paper/Card
- Add Recharts visualizations with MUI containers
- Implement API client for backend integration

## Step-by-Step Instructions

### 1. Initialize Frontend Project
```bash
cd frontend

# Initialize Vite with React + TypeScript (DONE)
npm create vite@latest . -- --template react-ts

# Install dependencies
npm install

# Install Material-UI and dependencies
npm install @mui/material @mui/icons-material @emotion/react @emotion/styled

# Install additional packages
npm install @tanstack/react-query @tanstack/react-query-devtools
npm install axios recharts
npm install -D @types/recharts
```

### 2. Configure Vite
**File:** `frontend/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
```

### 3. Create API Client
**File:** `frontend/src/api/client.ts`

```typescript
import axios from 'axios';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface Metric {
  entity_id: string;
  entity_type: 'student' | 'tutor' | 'subject' | 'region';
  sessions_7d: number;
  sessions_14d: number;
  sessions_30d: number;
  ib_calls_7d: number;
  ib_calls_14d: number;
  avg_rating: number;
  health_score: number;
  last_updated: string;
}

export interface Insight {
  alert_id: string;
  entity_id: string;
  prediction_type: string;
  risk_score: number;
  explanation: string;
  recommendations: string[];
  timestamp: string;
  model_used: string;
}

export const metricsAPI = {
  getAll: async (): Promise<Metric[]> => {
    const { data } = await apiClient.get('/metrics');
    return data;
  },
  getByType: async (entityType: string): Promise<Metric[]> => {
    const { data } = await apiClient.get(`/metrics/${entityType}`);
    return data;
  },
  getLowHealth: async (threshold = 70): Promise<Metric[]> => {
    const { data } = await apiClient.get(`/metrics/low-health?threshold=${threshold}`);
    return data;
  },
};

export const insightsAPI = {
  getRecent: async (limit = 20): Promise<Insight[]> => {
    const { data } = await apiClient.get(`/insights/recent?limit=${limit}`);
    return data;
  },
  getByEntity: async (entityId: string): Promise<Insight[]> => {
    const { data } = await apiClient.get(`/insights/${entityId}`);
    return data;
  },
  getHighRisk: async (threshold = 70): Promise<Insight[]> => {
    const { data } = await apiClient.get(`/insights/high-risk?threshold=${threshold}`);
    return data;
  },
};

export default apiClient;
```

### 4. Set Up MUI Theme
**File:** `frontend/src/theme.ts`

```typescript
import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: {
      main: '#667eea',
    },
    secondary: {
      main: '#764ba2',
    },
    error: {
      main: '#ef4444',
    },
    warning: {
      main: '#f59e0b',
    },
    success: {
      main: '#10b981',
    },
    background: {
      default: '#f5f7fa',
      paper: '#ffffff',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        },
      },
    },
  },
});
```

### 5. Set Up TanStack Query with MUI Theme Provider
**File:** `frontend/src/main.tsx`

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { theme } from './theme';
import App from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30000, // 30 seconds
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <App />
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
);
```

### 6. Create Dashboard Layout with MUI
**File:** `frontend/src/App.tsx`

```typescript
import { Box, AppBar, Toolbar, Typography, Container } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import Dashboard from './components/Dashboard';

function App() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar
        position="static"
        sx={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        }}
      >
        <Toolbar>
          <DashboardIcon sx={{ mr: 2 }} />
          <Box>
            <Typography variant="h5" component="h1" fontWeight="bold">
              📊 Intelligent Operations Dashboard
            </Typography>
            <Typography variant="body2">
              Real-time marketplace health monitoring
            </Typography>
          </Box>
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4, flex: 1 }}>
        <Dashboard />
      </Container>
    </Box>
  );
}

export default App;
```

### 7. Create KPI Cards Component with MUI
**File:** `frontend/src/components/KPICard.tsx`

```typescript
import { Card, CardContent, Typography, Box } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: 'primary' | 'success' | 'error' | 'warning';
}

export default function KPICard({ title, value, subtitle, trend, color = 'primary' }: KPICardProps) {
  const getTrendIcon = () => {
    if (trend === 'up') return <TrendingUpIcon color="success" />;
    if (trend === 'down') return <TrendingDownIcon color="error" />;
    return <TrendingFlatIcon />;
  };

  return (
    <Card
      sx={{
        height: '100%',
        borderLeft: 4,
        borderColor: `${color}.main`,
      }}
    >
      <CardContent>
        <Typography
          variant="overline"
          color="text.secondary"
          gutterBottom
          sx={{ textTransform: 'uppercase', fontWeight: 600 }}
        >
          {title}
        </Typography>
        <Box display="flex" alignItems="center" gap={1}>
          <Typography variant="h3" component="div" fontWeight="bold">
            {value}
          </Typography>
          {trend && getTrendIcon()}
        </Box>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {subtitle}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
```

### 8. Create Main Dashboard Component with MUI
**File:** `frontend/src/components/Dashboard.tsx`

```typescript
import { useQuery } from '@tanstack/react-query';
import { Grid, Paper, Typography, Box, Alert, Chip } from '@mui/material';
import WarningIcon from '@mui/icons-material/Warning';
import { metricsAPI, insightsAPI } from '../api/client';
import KPICard from './KPICard';
import HealthChart from './HealthChart';
import SessionsChart from './SessionsChart';

export default function Dashboard() {
  const { data: students } = useQuery({
    queryKey: ['metrics', 'student'],
    queryFn: () => metricsAPI.getByType('student'),
  });

  const { data: lowHealthStudents } = useQuery({
    queryKey: ['metrics', 'low-health'],
    queryFn: () => metricsAPI.getLowHealth(70),
  });

  const { data: highRiskInsights } = useQuery({
    queryKey: ['insights', 'high-risk'],
    queryFn: () => insightsAPI.getHighRisk(70),
  });

  const totalStudents = students?.length || 0;
  const atRiskCount = lowHealthStudents?.length || 0;
  const avgHealthScore = students
    ? (students.reduce((sum, s) => sum + s.health_score, 0) / students.length).toFixed(1)
    : '0';
  const total30DaySessions = students
    ? students.reduce((sum, s) => sum + s.sessions_30d, 0)
    : 0;

  return (
    <Box>
      {/* KPI Section */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Total Students"
            value={totalStudents}
            subtitle="Active in last 30 days"
            color="primary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Avg Health Score"
            value={avgHealthScore}
            subtitle="All students"
            color={parseFloat(avgHealthScore) > 75 ? 'success' : 'warning'}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="At-Risk Students"
            value={atRiskCount}
            subtitle="Health score < 70"
            color={atRiskCount > 0 ? 'error' : 'success'}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Sessions (30d)"
            value={total30DaySessions}
            subtitle="All students"
            color="primary"
          />
        </Grid>
      </Grid>

      {/* Charts Section */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={6}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Health Score Distribution
            </Typography>
            <HealthChart students={students || []} />
          </Paper>
        </Grid>
        <Grid item xs={12} lg={6}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Session Velocity (7d)
            </Typography>
            <SessionsChart students={students || []} />
          </Paper>
        </Grid>
      </Grid>

      {/* High Risk Alerts */}
      <Paper sx={{ p: 3 }}>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <WarningIcon color="error" />
          <Typography variant="h6">High Risk Alerts</Typography>
        </Box>
        {highRiskInsights && highRiskInsights.length > 0 ? (
          <Box display="flex" flexDirection="column" gap={2}>
            {highRiskInsights.slice(0, 5).map((insight) => (
              <Alert
                key={insight.alert_id}
                severity="error"
                sx={{
                  borderLeft: 4,
                  borderColor: 'error.main',
                }}
              >
                <Box display="flex" justifyContent="space-between" alignItems="start" mb={1}>
                  <Chip
                    label={insight.prediction_type}
                    color="error"
                    size="small"
                  />
                  <Chip
                    label={`Risk: ${insight.risk_score}`}
                    color="error"
                    variant="outlined"
                    size="small"
                  />
                </Box>
                <Typography variant="body2" paragraph>
                  {insight.explanation}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(insight.timestamp).toLocaleString()}
                </Typography>
              </Alert>
            ))}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No high-risk alerts
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
```

### 9. Create Charts Components with MUI
**File:** `frontend/src/components/HealthChart.tsx`

```typescript
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useTheme } from '@mui/material/styles';
import { Metric } from '../api/client';

interface Props {
  students: Metric[];
}

export default function HealthChart({ students }: Props) {
  const theme = useTheme();

  // Group students by health score ranges
  const ranges = [
    { name: '0-20', min: 0, max: 20, count: 0 },
    { name: '21-40', min: 21, max: 40, count: 0 },
    { name: '41-60', min: 41, max: 60, count: 0 },
    { name: '61-80', min: 61, max: 80, count: 0 },
    { name: '81-100', min: 81, max: 100, count: 0 },
  ];

  students.forEach((student) => {
    const range = ranges.find(
      (r) => student.health_score >= r.min && student.health_score <= r.max
    );
    if (range) range.count++;
  });

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={ranges}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
        <XAxis dataKey="name" stroke={theme.palette.text.secondary} />
        <YAxis stroke={theme.palette.text.secondary} />
        <Tooltip
          contentStyle={{
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
          }}
        />
        <Legend />
        <Bar dataKey="count" fill={theme.palette.primary.main} name="Students" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

**File:** `frontend/src/components/SessionsChart.tsx`

```typescript
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useTheme } from '@mui/material/styles';
import { Metric } from '../api/client';

interface Props {
  students: Metric[];
}

export default function SessionsChart({ students }: Props) {
  const theme = useTheme();

  // Get top 10 most active students
  const topStudents = students
    .sort((a, b) => b.sessions_7d - a.sessions_7d)
    .slice(0, 10)
    .map((s) => ({
      name: s.entity_id.substring(0, 10),
      sessions: s.sessions_7d,
    }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={topStudents}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
        <XAxis dataKey="name" stroke={theme.palette.text.secondary} />
        <YAxis stroke={theme.palette.text.secondary} />
        <Tooltip
          contentStyle={{
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
          }}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="sessions"
          stroke={theme.palette.success.main}
          strokeWidth={2}
          name="Sessions (7d)"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

### 10. Add Global Styles (Optional)
**File:** `frontend/src/index.css`

```css
/* Reset and base styles - MUI CssBaseline handles most of this */
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: 'Inter', 'Roboto', 'Helvetica', 'Arial', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Optional: Custom scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
}

::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #555;
}
```

**Note:** With MUI, most styling is now handled through the `sx` prop and MUI's theming system. The need for extensive CSS files is greatly reduced.

### 10. Create Environment Configuration
**File:** `frontend/.env.example`

```bash
VITE_API_URL=https://your-api-gateway-url.execute-api.us-east-1.amazonaws.com/prod
```

### 11. Run Development Server
```bash
cd frontend
npm run dev
```

Visit: `http://localhost:3000`

## Verification Steps

1. **Check TanStack Query DevTools**
   - Open app
   - Click DevTools button (bottom left)
   - Verify queries are running

2. **Test with Mock Data**
   Create `frontend/src/mocks/mockData.ts` for testing without backend

3. **Build for Production**
```bash
npm run build
npm run preview
```

## Next Steps
- PR-10: Add WebSocket for real-time updates
- PR-11: Build alerts feed component
- Deploy to Vercel/CloudFront

## Estimated Time: 90 minutes
