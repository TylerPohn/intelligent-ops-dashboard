import { Card, CardContent, Typography, Box, Grow } from '@mui/material';
import { TrendingUp, TrendingDown } from '@mui/icons-material';
import { useState, useEffect } from 'react';

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
  const [displayValue, setDisplayValue] = useState<number>(0);
  const numericValue = typeof value === 'number' ? value : parseFloat(value.toString().replace(/,/g, ''));

  useEffect(() => {
    if (typeof numericValue === 'number' && !isNaN(numericValue)) {
      const duration = 1000;
      const steps = 60;
      const startValue = displayValue;
      const increment = (numericValue - startValue) / steps;
      let current = startValue;

      const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= numericValue) || (increment < 0 && current <= numericValue)) {
          setDisplayValue(numericValue);
          clearInterval(timer);
        } else {
          setDisplayValue(current);
        }
      }, duration / steps);

      return () => clearInterval(timer);
    } else {
      setDisplayValue(0);
    }
  }, [numericValue]);

  const getTrendColor = () => {
    if (trend === 'up') return 'success.main';
    if (trend === 'down') return 'error.main';
    return 'text.secondary';
  };

  const TrendIcon = trend === 'up' ? TrendingUp : TrendingDown;

  const formatValue = () => {
    if (typeof value === 'number') {
      return Math.round(displayValue).toLocaleString();
    }
    return value;
  };

  return (
    <Grow in={true} timeout={500}>
      <Card
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'visible',
          cursor: 'pointer',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            bgcolor: `${color}.main`,
            borderRadius: '12px 12px 0 0',
            opacity: 0,
            transition: 'opacity 0.3s ease-in-out',
          },
          '&:hover::before': {
            opacity: 1,
          },
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
                transition: 'transform 0.2s ease-in-out',
                '&:hover': {
                  transform: 'rotate(10deg) scale(1.1)',
                },
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
              transition: 'transform 0.2s ease-in-out',
            }}
          >
            {formatValue()}
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
    </Grow>
  );
}
