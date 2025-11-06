import { Snackbar, Alert, AlertTitle } from '@mui/material';
import type { Insight } from '../api/client';

interface AlertNotificationProps {
  alert: Insight | null;
  open: boolean;
  onClose: () => void;
  autoHideDuration?: number;
}

export default function AlertNotification({
  alert,
  open,
  onClose,
  autoHideDuration = 6000,
}: AlertNotificationProps) {
  if (!alert) return null;

  const getSeverity = (score: number): 'error' | 'warning' | 'info' => {
    if (score >= 80) return 'error';
    if (score >= 60) return 'warning';
    return 'info';
  };

  return (
    <Snackbar
      open={open}
      autoHideDuration={autoHideDuration}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      <Alert
        onClose={onClose}
        severity={getSeverity(alert.risk_score)}
        variant="filled"
        sx={{ width: '100%', maxWidth: 400 }}
      >
        <AlertTitle>New Alert: {alert.entity_id}</AlertTitle>
        Risk Score: {alert.risk_score} | {alert.prediction_type.replace(/_/g, ' ')}
      </Alert>
    </Snackbar>
  );
}
