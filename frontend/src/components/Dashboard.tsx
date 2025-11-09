import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Container, Box, Typography, AppBar, Toolbar, Grid, Paper } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import AlertsFeed from './AlertsFeed';
import WebSocketStatus from './WebSocketStatus';
import AlertNotification from './AlertNotification';
import RiskDistributionChart from './HealthChart';
import InsightTrendsChart from './SessionsChart';
import KPICard from './KPICard';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import PeopleIcon from '@mui/icons-material/People';
import AssessmentIcon from '@mui/icons-material/Assessment';
import { usePolling } from '../hooks/usePolling';
import { insightsAPI } from '../api/client';
import type { Insight } from '../api/client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#90caf9',
    },
    secondary: {
      main: '#f48fb1',
    },
    error: {
      main: '#f44336',
    },
    warning: {
      main: '#ff9800',
    },
    info: {
      main: '#2196f3',
    },
    success: {
      main: '#4caf50',
    },
  },
});

function DashboardContent() {
  const [newAlert, setNewAlert] = useState<Insight | null>(null);
  const [showNotification, setShowNotification] = useState(false);
  const [lastMessageTime, setLastMessageTime] = useState<Date | null>(null);

  const API_URL = `${import.meta.env.VITE_API_URL}/insights/recent?limit=10`;

  const { data: insights } = useQuery({
    queryKey: ['insights', 'recent'],
    queryFn: () => insightsAPI.getRecent(1000),
    refetchInterval: 10000,
  });

  const { status, lastData } = usePolling({
    url: API_URL,
    interval: 5000, // Poll every 5 seconds
    invalidateQueries: ['insights', 'metrics'],
    onData: (data) => {
      console.log('Polling data received:', data);
      setLastMessageTime(new Date());

      // Handle new alerts - check if there are new items
      if (data && Array.isArray(data) && data.length > 0) {
        const latestAlert = data[0] as Insight;

        // Only show notification if this is a genuinely new alert
        // (you could track last seen alert_id to be more precise)
        if (latestAlert) {
          setNewAlert(latestAlert);
          setShowNotification(true);
        }
      }
    },
    onConnect: () => {
      console.log('Dashboard: Polling connected');
    },
    onDisconnect: () => {
      console.log('Dashboard: Polling disconnected');
    },
    onError: (error) => {
      console.error('Dashboard: Polling error:', error);
    },
  });

  // Calculate KPI metrics from insights
  const totalAlerts = insights?.length || 0;
  const criticalAlerts = insights?.filter(i => i.risk_score >= 80).length || 0;
  const avgRiskScore = insights?.length
    ? Math.round(insights.reduce((sum, i) => sum + i.risk_score, 0) / insights.length)
    : 0;
  const churnRiskAlerts = insights?.filter(i => i.prediction_type === 'churn_risk').length || 0;

  useEffect(() => {
    if (lastData) {
      console.log('Last data updated:', lastData.length, 'items');
    }
  }, [lastData]);

  return (
    <>
      <CssBaseline />
      <AppBar position="static" elevation={1}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Tutor Marketplace Operations
          </Typography>
          <WebSocketStatus status={status} lastMessageTime={lastMessageTime} />
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Box mb={3}>
          <Typography variant="h4" gutterBottom>
            Real-Time Operations Monitoring
          </Typography>
          <Typography variant="body1" color="text.secondary">
            AI-powered insights and alerts for customer health, churn risk, and marketplace balance
          </Typography>
        </Box>

        <Grid container spacing={3}>
          {/* KPI Cards */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KPICard
              title="Total Alerts"
              value={totalAlerts}
              icon={<AssessmentIcon />}
              color="primary"
              trend="neutral"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KPICard
              title="Critical Alerts"
              value={criticalAlerts}
              icon={<TrendingUpIcon />}
              color="error"
              trend={criticalAlerts > 0 ? "up" : "neutral"}
              trendValue={criticalAlerts > 0 ? `${criticalAlerts} active` : undefined}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KPICard
              title="Avg Risk Score"
              value={avgRiskScore}
              unit="/100"
              icon={<TrendingDownIcon />}
              color={avgRiskScore >= 70 ? "error" : avgRiskScore >= 50 ? "warning" : "success"}
              trend="neutral"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KPICard
              title="Churn Risks"
              value={churnRiskAlerts}
              icon={<PeopleIcon />}
              color="warning"
              trend="neutral"
            />
          </Grid>

          {/* Charts */}
          <Grid size={{ xs: 12, md: 6 }}>
            <RiskDistributionChart insights={insights || []} loading={!insights} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <InsightTrendsChart insights={insights || []} loading={!insights} />
          </Grid>

          {/* Alerts Feed */}
          <Grid size={{ xs: 12, lg: 8 }}>
            <AlertsFeed />
          </Grid>

          {/* System Status */}
          <Grid size={{ xs: 12, lg: 4 }}>
            <Paper sx={{ p: 3, height: '100%' }}>
              <Typography variant="h6" gutterBottom>
                System Status
              </Typography>
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Connection: <strong>{status}</strong>
                </Typography>
                {lastMessageTime && (
                  <Typography variant="body2" color="text.secondary">
                    Last update: {lastMessageTime.toLocaleTimeString()}
                  </Typography>
                )}
                <Box sx={{ mt: 3 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Quick Stats
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    • {totalAlerts} total insights
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    • {criticalAlerts} critical ({((criticalAlerts / (totalAlerts || 1)) * 100).toFixed(0)}%)
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    • {churnRiskAlerts} churn risks identified
                  </Typography>
                </Box>
              </Box>
            </Paper>
          </Grid>
        </Grid>
      </Container>

      <AlertNotification
        alert={newAlert}
        open={showNotification}
        onClose={() => setShowNotification(false)}
      />
    </>
  );
}

export default function Dashboard() {
  return (
    <ThemeProvider theme={darkTheme}>
      <QueryClientProvider client={queryClient}>
        <DashboardContent />
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
