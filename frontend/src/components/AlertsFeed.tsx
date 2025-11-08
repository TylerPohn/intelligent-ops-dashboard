import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Divider,
  Stack,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import WarningIcon from '@mui/icons-material/Warning';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { insightsAPI } from '../api/client';
import type { Insight } from '../api/client';

export default function AlertsFeed() {
  const [filter, setFilter] = useState<string>('all');
  const [selectedAlert, setSelectedAlert] = useState<Insight | null>(null);

  const { data: insights, isLoading, error } = useQuery({
    queryKey: ['insights', 'recent'],
    queryFn: () => insightsAPI.getRecent(50),
    refetchInterval: 10000, // Refetch every 10 seconds
  });

  const filteredInsights = insights?.filter(i =>
    filter === 'all' || i.prediction_type === filter
  );

  const getSeverityColor = (score: number): 'error' | 'warning' | 'info' => {
    if (score >= 80) return 'error';
    if (score >= 60) return 'warning';
    return 'info';
  };

  const handleFilterChange = (event: SelectChangeEvent) => {
    setFilter(event.target.value);
  };

  if (error) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography color="error">Failed to load alerts</Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box display="flex" alignItems="center" gap={1}>
          <WarningIcon color="error" />
          <Typography variant="h6">Live Alerts Feed</Typography>
        </Box>

        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Filter by Type</InputLabel>
          <Select
            value={filter}
            label="Filter by Type"
            onChange={handleFilterChange}
          >
            <MenuItem value="all">All Alerts</MenuItem>
            <MenuItem value="customer_health">Customer Health</MenuItem>
            <MenuItem value="churn_risk">Churn Risk</MenuItem>
            <MenuItem value="session_quality">Session Quality</MenuItem>
            <MenuItem value="marketplace_balance">Supply/Demand</MenuItem>
            <MenuItem value="tutor_capacity">Tutor Capacity</MenuItem>
            <MenuItem value="first_session_success">First Session Success</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {isLoading ? (
        <Typography color="text.secondary">Loading alerts...</Typography>
      ) : (
        <List sx={{ maxHeight: 600, overflow: 'auto' }}>
          {filteredInsights && filteredInsights.length > 0 ? (
            filteredInsights.map((alert, index) => (
              <Box key={alert.alert_id}>
                {index > 0 && <Divider />}
                <ListItem disablePadding>
                  <ListItemButton onClick={() => setSelectedAlert(alert)}>
                    <ListItemText
                      primary={
                        <Box display="flex" alignItems="center" gap={1} mb={1}>
                          <Chip
                            label={alert.risk_score}
                            color={getSeverityColor(alert.risk_score)}
                            size="small"
                          />
                          <Typography variant="body2" color="text.secondary">
                            {new Date(alert.timestamp).toLocaleTimeString()}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Box>
                          <Typography variant="subtitle2" color="text.primary" gutterBottom>
                            {alert.entity_id}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {alert.explanation.substring(0, 100)}...
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItemButton>
                </ListItem>
              </Box>
            ))
          ) : (
            <Typography color="text.secondary" sx={{ p: 2 }}>
              No alerts to display
            </Typography>
          )}
        </List>
      )}

      {selectedAlert && (
        <AlertDetailDialog
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
        />
      )}
    </Paper>
  );
}

function AlertDetailDialog({ alert, onClose }: { alert: Insight; onClose: () => void }) {
  const getSeverityColor = (score: number): 'error' | 'warning' | 'info' => {
    if (score >= 80) return 'error';
    if (score >= 60) return 'warning';
    return 'info';
  };

  return (
    <Dialog
      open={true}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Alert Details</Typography>
          <Chip
            label={`Risk: ${alert.risk_score}/100`}
            color={getSeverityColor(alert.risk_score)}
          />
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">Entity</Typography>
            <Typography variant="body1">{alert.entity_id}</Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" color="text.secondary">Type</Typography>
            <Typography variant="body1">{alert.prediction_type}</Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" color="text.secondary">AI Model</Typography>
            <Typography variant="body1">{alert.model_used}</Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" color="text.secondary">Confidence</Typography>
            <Typography variant="body1">{(alert.confidence * 100).toFixed(1)}%</Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" color="text.secondary">Timestamp</Typography>
            <Typography variant="body1">
              {new Date(alert.timestamp).toLocaleString()}
            </Typography>
          </Box>

          <Divider />

          <Box>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <LightbulbIcon color="primary" />
              <Typography variant="h6">Explanation</Typography>
            </Box>
            <Typography variant="body2" paragraph>
              {alert.explanation}
            </Typography>
          </Box>

          <Box>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <CheckCircleIcon color="success" />
              <Typography variant="h6">Recommendations</Typography>
            </Box>
            <List dense>
              {alert.recommendations.map((rec, i) => (
                <ListItem key={i}>
                  <ListItemText primary={rec} />
                </ListItem>
              ))}
            </List>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
