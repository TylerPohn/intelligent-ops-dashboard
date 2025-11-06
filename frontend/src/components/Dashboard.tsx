import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Container, Box, Typography, AppBar, Toolbar, Grid } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import AlertsFeed from './AlertsFeed';
import WebSocketStatus from './WebSocketStatus';
import AlertNotification from './AlertNotification';
import { usePolling } from '../hooks/usePolling';
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
            IOPS Dashboard
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
            AI-powered insights and alerts for InfiniBand call patterns and health metrics
          </Typography>
        </Box>

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, lg: 8 }}>
            <AlertsFeed />
          </Grid>

          <Grid size={{ xs: 12, lg: 4 }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                System Status
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Connection: {status}
              </Typography>
              {lastMessageTime && (
                <Typography variant="body2" color="text.secondary">
                  Last update: {lastMessageTime.toLocaleTimeString()}
                </Typography>
              )}
            </Box>
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
