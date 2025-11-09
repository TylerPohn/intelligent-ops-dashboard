import { Box, Chip, Tooltip } from '@mui/material';
import WifiIcon from '@mui/icons-material/Wifi';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import type { ConnectionStatus } from '../hooks/useWebSocket';

interface WebSocketStatusProps {
  status: ConnectionStatus;
  lastMessageTime?: Date | null;
}

export default function WebSocketStatus({ status, lastMessageTime }: WebSocketStatusProps) {
  const getStatusColor = (): 'success' | 'error' | 'warning' | 'default' => {
    switch (status) {
      case 'connected':
        return 'success';
      case 'disconnected':
        return 'error';
      case 'connecting':
        return 'warning';
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (): string => {
    switch (status) {
      case 'connected':
        return 'Live';
      case 'disconnected':
        return 'Offline';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  };

  const getIcon = () => {
    return status === 'connected' ? <WifiIcon /> : <WifiOffIcon />;
  };

  const tooltipText = lastMessageTime
    ? `Last update: ${lastMessageTime.toLocaleTimeString()}`
    : `Status: ${getStatusLabel()}`;

  return (
    <Tooltip title={tooltipText}>
      <Box>
        <Chip
          icon={getIcon()}
          label={getStatusLabel()}
          color={getStatusColor()}
          size="small"
          variant="outlined"
          sx={{
            fontWeight: 600,
            animation: status === 'connected' ? 'pulse 2s ease-in-out infinite' : 'none',
            '@keyframes pulse': {
              '0%, 100%': {
                opacity: 1,
                boxShadow: '0 0 0 0 rgba(16, 185, 129, 0.4)',
              },
              '50%': {
                opacity: 0.9,
                boxShadow: '0 0 0 4px rgba(16, 185, 129, 0)',
              },
            },
            '& .MuiChip-icon': {
              animation: status === 'connected' ? 'iconPulse 2s ease-in-out infinite' : 'none',
              '@keyframes iconPulse': {
                '0%, 100%': {
                  opacity: 1,
                },
                '50%': {
                  opacity: 0.6,
                },
              },
            },
          }}
        />
      </Box>
    </Tooltip>
  );
}
