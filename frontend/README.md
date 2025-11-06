# IOPS Dashboard Frontend

React + TypeScript + Material-UI dashboard for real-time IOPS monitoring with AI-powered alerts.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## 🎯 Features

- **Real-Time Alerts Feed** - Live WebSocket updates with auto-reconnect
- **Material-UI Design** - Dark theme with responsive layout
- **Alert Filtering** - Filter by type (high IB calls, low health, supply/demand)
- **Detail Modals** - AI explanations and recommendations
- **Connection Status** - Visual WebSocket connection indicator
- **Toast Notifications** - Real-time alert notifications

## 📦 Technology Stack

- React 19 + TypeScript
- Material-UI v6
- TanStack Query (React Query)
- Recharts
- Vite

## 🔌 Environment Setup

Copy `.env.example` to `.env`:

```env
VITE_API_URL=http://localhost:3000/api
VITE_WEBSOCKET_URL=ws://localhost:3001
VITE_ENV=development
```

## 📚 Documentation

See [PR-11 Implementation Summary](../docs/PR-11-Implementation-Summary.md) for full details.
