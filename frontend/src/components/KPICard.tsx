import { Card, CardContent, Typography, Box } from '@mui/material';
import { TrendingUp, TrendingDown } from '@mui/icons-material';

interface KPICardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon?: React.ReactNode;
  color?: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';
}

export default function KPICard({
  title,
  value,
  unit = '',
  trend = 'neutral',
  trendValue,
  icon,
  color = 'primary',
}: KPICardProps) {
  const getTrendColor = () => {
    if (trend === 'up') return 'success.main';
    if (trend === 'down') return 'error.main';
    return 'text.secondary';
  };

  const TrendIcon = trend === 'up' ? TrendingUp : TrendingDown;

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'visible',
      }}
    >
      <CardContent>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 2,
          }}
        >
          <Typography
            variant="subtitle2"
            color="text.secondary"
            sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            {title}
          </Typography>
          {icon && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                borderRadius: 2,
                bgcolor: `${color}.main`,
                color: 'white',
              }}
            >
              {icon}
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'baseline', mb: 1 }}>
          <Typography
            variant="h4"
            component="div"
            sx={{
              fontWeight: 700,
              color: `${color}.main`,
            }}
          >
            {value}
          </Typography>
          {unit && (
            <Typography
              variant="subtitle1"
              color="text.secondary"
              sx={{ ml: 1 }}
            >
              {unit}
            </Typography>
          )}
        </Box>

        {trendValue && trend !== 'neutral' && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <TrendIcon
              sx={{
                fontSize: 18,
                color: getTrendColor(),
              }}
            />
            <Typography
              variant="body2"
              sx={{
                color: getTrendColor(),
                fontWeight: 600,
              }}
            >
              {trendValue}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              from last hour
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
