import { Tabs, Tab, Box } from '@mui/material';
import type { TimeRange } from '../api/client';

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

export default function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  const handleChange = (_event: React.SyntheticEvent, newValue: TimeRange) => {
    onChange(newValue);
  };

  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', mr: 2 }}>
      <Tabs
        value={value}
        onChange={handleChange}
        textColor="inherit"
        indicatorColor="secondary"
        sx={{
          minHeight: 48,
          '& .MuiTab-root': {
            minHeight: 48,
            textTransform: 'none',
            fontWeight: 500,
            fontSize: '0.875rem',
            color: 'rgba(255, 255, 255, 0.7)',
            '&.Mui-selected': {
              color: 'white',
            },
          },
        }}
      >
        <Tab label="Last Hour" value="1h" />
        <Tab label="Last 3 Hours" value="3h" />
        <Tab label="Today" value="today" />
        <Tab label="Last Week" value="week" />
      </Tabs>
    </Box>
  );
}
