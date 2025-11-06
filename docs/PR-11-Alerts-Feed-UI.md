# PR-11: Alerts Feed UI Component (MUI)

## Overview
Create real-time alerts feed component showing live EventBridge alerts with filtering and detail views using Material-UI components.

## Dependencies
- PR-09: Frontend UI (with MUI)
- PR-10: WebSocket Updates

## Objectives
- Build alerts feed component with MUI List and Card components
- Add alert filtering by severity/type using MUI Select
- Implement detail modal for AI explanations using MUI Dialog
- Add real-time alert notifications with MUI Snackbar

## Key Component: AlertsFeed.tsx (MUI Version)

```typescript
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
import WarningIcon from '@mui/icons-material/Warning';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { insightsAPI, Insight } from '../api/client';

export default function AlertsFeed() {
  const [filter, setFilter] = useState<string>('all');
  const [selectedAlert, setSelectedAlert] = useState<Insight | null>(null);

  const { data: insights } = useQuery({
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
            onChange={(e) => setFilter(e.target.value)}
          >
            <MenuItem value="all">All Alerts</MenuItem>
            <MenuItem value="high_ib_call_frequency">High IB Calls</MenuItem>
            <MenuItem value="low_health_score">Low Health Score</MenuItem>
            <MenuItem value="supply_demand_imbalance">Supply/Demand</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <List sx={{ maxHeight: 600, overflow: 'auto' }}>
        {filteredInsights?.map((alert, index) => (
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
        ))}
      </List>

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
```

## MUI Styling Notes

All styling is now handled through MUI's `sx` prop and theming system:
- Paper component provides the container with elevation
- List and ListItem for scrollable alert feed
- Chip components for severity badges with built-in color variants
- Dialog component for modal (replaces custom CSS overlay)
- Typography variants for consistent text hierarchy
- Built-in hover states and transitions via ListItemButton
- Responsive layout through MUI's Box and Stack components

No custom CSS required - MUI handles all styling through its theming system.

## Estimated Time: 45 minutes
