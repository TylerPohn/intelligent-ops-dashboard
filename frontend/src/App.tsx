import {
  AppBar,
  Toolbar,
  Typography,
  Container,
  Box,
  IconButton,
} from '@mui/material';
import { Dashboard as DashboardIcon, Refresh } from '@mui/icons-material';
import { useQueryClient } from '@tanstack/react-query';
import Dashboard from './components/Dashboard';

function App() {
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* AppBar with Datadog-inspired gradient */}
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <DashboardIcon sx={{ mr: 2, fontSize: 32 }} />
          <Typography
            variant="h5"
            component="h1"
            sx={{
              flexGrow: 1,
              fontWeight: 700,
              letterSpacing: '0.02em',
            }}
          >
            IOPS Dashboard
          </Typography>
          <IconButton
            color="inherit"
            onClick={handleRefresh}
            aria-label="refresh dashboard"
            sx={{
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
              },
            }}
          >
            <Refresh />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Main Content */}
      <Container
        maxWidth="xl"
        sx={{
          mt: 4,
          mb: 4,
          flexGrow: 1,
        }}
      >
        <Dashboard />
      </Container>

      {/* Footer */}
      <Box
        component="footer"
        sx={{
          py: 3,
          px: 2,
          mt: 'auto',
          backgroundColor: (theme) =>
            theme.palette.mode === 'light'
              ? theme.palette.grey[100]
              : theme.palette.grey[800],
        }}
      >
        <Container maxWidth="xl">
          <Typography variant="body2" color="text.secondary" align="center">
            IOPS Monitoring Dashboard • Real-time Analytics •{' '}
            {new Date().getFullYear()}
          </Typography>
        </Container>
      </Box>
    </Box>
  );
}

export default App;
