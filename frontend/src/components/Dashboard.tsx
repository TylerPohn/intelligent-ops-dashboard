import { useState } from 'react';
import { useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { Container, Box, Typography, AppBar, Toolbar, Grid, Paper } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import AlertsFeed from './AlertsFeed';
import WebSocketStatus from './WebSocketStatus';
import AlertNotification from './AlertNotification';
import RiskDistributionChart from './HealthChart';
import InsightTrendsChart from './SessionsChart';
import KPICard from './KPICard';
import TimeRangeSelector from './TimeRangeSelector';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import PeopleIcon from '@mui/icons-material/People';
import AssessmentIcon from '@mui/icons-material/Assessment';
import { usePolling } from '../hooks/usePolling';
import { insightsAPI, getTimeRangeISO } from '../api/client';
import type { Insight, TimeRange } from '../api/client';

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

export default function Dashboard() {
  const [newAlert, setNewAlert] = useState<Insight | null>(null);
  const [showNotification, setShowNotification] = useState(false);
  const [lastMessageTime, setLastMessageTime] = useState<Date | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('today');

  // Use global QueryClient from context instead of creating a new one
  const queryClient = useQueryClient();

  // Query 1: Get aggregations for accurate KPIs and charts (fast, no items)
  const { data: aggregations } = useQuery({
    queryKey: ['insights', 'aggregations', timeRange],
    queryFn: () => insightsAPI.getAggregations(getTimeRangeISO(timeRange)),
    staleTime: 60 * 1000, // 1 minute cache for stats
    refetchInterval: 60 * 1000, // Refetch every minute
  });

  // Query 2: Paginated insights for display (using infinite query for virtual scroll support)
  const {
    data: insightsData,
  } = useInfiniteQuery({
    queryKey: ['insights', 'items', timeRange],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => insightsAPI.getRecentWithFilters({
      limit: 100,
      since: getTimeRangeISO(timeRange),
      nextToken: pageParam,
    }),
    staleTime: 5 * 60 * 1000, // 5 minute cache
    refetchInterval: false, // Disable automatic refetch - let polling handle it
    getNextPageParam: (lastPage) => lastPage.nextToken,
    initialPageParam: undefined as string | undefined,
  });

  // Get latest timestamp from cached data for incremental polling
  const latestTimestamp = (insightsData?.pages?.[0] as { items: Insight[] } | undefined)?.items?.[0]?.timestamp;

  // Smart polling: only fetch NEW insights since latest timestamp
  const { status } = usePolling({
    url: latestTimestamp
      ? `${import.meta.env.VITE_API_URL}/insights/recent?limit=10&since=${latestTimestamp}`
      : `${import.meta.env.VITE_API_URL}/insights/recent?limit=10`,
    interval: 10000, // Poll every 10 seconds
    invalidateQueries: [], // Don't invalidate - we'll manually update cache
    onData: (data) => {
      const typedData = data as { items?: Insight[] } | Insight[] | undefined;
      const itemsLength = Array.isArray(typedData) ? typedData.length : (typedData?.items?.length || 0);
      console.log('Polling: Received', itemsLength, 'new insights');
      setLastMessageTime(new Date());

      const newInsights = Array.isArray(data) ? data : ((data as { items?: Insight[] })?.items || []);

      if (newInsights.length > 0) {
        // Manual cache update: PREPEND new insights without invalidating
        queryClient.setQueryData(
          ['insights', 'items', timeRange],
          (old: any) => {
            if (!old || !old.pages || old.pages.length === 0) {
              return { pages: [{ items: newInsights, nextToken: undefined }], pageParams: [undefined] };
            }

            const firstPage = (old.pages[0] as { items: Insight[]; nextToken?: string }) || { items: [], nextToken: undefined };
            const existingItems = Array.isArray(firstPage.items) ? firstPage.items : [];

            // Merge new insights with existing first page (keep max 100 per page)
            const updatedFirstPage = {
              ...firstPage,
              items: [...newInsights, ...existingItems].slice(0, 100),
            };

            return {
              ...old,
              pages: [updatedFirstPage, ...old.pages.slice(1)],
            };
          }
        );

        // Show notification for the latest alert
        const latestAlert = newInsights[0] as Insight;
        setNewAlert(latestAlert);
        setShowNotification(true);

        // Also refetch aggregations since we have new data
        queryClient.invalidateQueries({ queryKey: ['insights', 'aggregations', timeRange] });
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

  // Flatten all pages for KPI calculation fallback (if aggregations not loaded yet)
  const allInsights = insightsData?.pages?.flatMap((page: { items: Insight[] }) => page.items) || [];

  // Use aggregations for KPIs if available, otherwise calculate from loaded items
  const totalAlerts = aggregations?.total ?? allInsights.length;
  const criticalAlerts = aggregations?.critical ?? allInsights.filter(i => i?.risk_score >= 80).length;
  const avgRiskScore = aggregations?.avgRisk ?? (
    allInsights.length > 0
      ? Math.round(allInsights.reduce((sum, i) => sum + (i?.risk_score || 0), 0) / allInsights.length)
      : 0
  );
  const churnRiskAlerts = aggregations?.byType?.churn_risk ?? allInsights.filter(i => i?.prediction_type === 'churn_risk').length;

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <AppBar position="static" elevation={1}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ mr: 4 }}>
            Tutor Marketplace Operations
          </Typography>
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
          <Box sx={{ flexGrow: 1 }} />
          <WebSocketStatus status={status} lastMessageTime={lastMessageTime} />
        </Toolbar>
      </AppBar>

      <Container maxWidth={false} sx={{ mt: 4, mb: 4 }}>
        <Grid container spacing={3}>
          {/* KPI Cards */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KPICard
              title="Total Alerts"
              value={totalAlerts}
              subtitle="Active insights"
              icon={<AssessmentIcon />}
              color="primary"
              trend="neutral"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KPICard
              title="Critical Alerts"
              value={criticalAlerts}
              subtitle={`${totalAlerts > 0 ? ((criticalAlerts / totalAlerts) * 100).toFixed(0) : 0}% of total`}
              icon={<TrendingUpIcon />}
              color="error"
              trend={criticalAlerts > 5 ? 'up' : 'down'}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KPICard
              title="Avg Risk Score"
              value={avgRiskScore}
              subtitle="System-wide average"
              icon={<TrendingDownIcon />}
              color="info"
              trend="neutral"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <KPICard
              title="Churn Risks"
              value={churnRiskAlerts}
              subtitle="Students at risk"
              icon={<PeopleIcon />}
              color="warning"
              trend="neutral"
            />
          </Grid>

          {/* Charts */}
          <Grid size={{ xs: 12, md: 6 }}>
            <RiskDistributionChart
              insights={allInsights}
              loading={!aggregations && allInsights.length === 0}
              aggregations={aggregations}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <InsightTrendsChart
              insights={allInsights}
              loading={!aggregations && allInsights.length === 0}
              aggregations={aggregations}
            />
          </Grid>

          {/* Alerts Feed */}
          <Grid size={{ xs: 12, lg: 8 }}>
            <AlertsFeed timeRange={timeRange} onFilterChange={setTimeRange} />
          </Grid>

          {/* System Status */}
          <Grid size={{ xs: 12, lg: 4 }}>
            <Paper sx={{ p: 3, height: '100%' }}>
              <Typography variant="h6" gutterBottom>
                System Status
              </Typography>
              <Box>
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
    </ThemeProvider>
  );
}
