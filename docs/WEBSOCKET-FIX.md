# WebSocket Connection Fix

## Problem
WebSocket connections were failing with "Insufficient resources" errors due to:

1. **Connection Loop** - Multiple simultaneous connection attempts
2. **No Connection Cleanup** - Old connections not being properly closed
3. **Fast Reconnection** - No exponential backoff causing rapid retry storms
4. **Component Re-renders** - React re-renders triggering new connections

## Changes Made

### 1. useWebSocket.ts - Connection Management
- Added `isConnectingRef` to prevent simultaneous connection attempts
- Implemented proper cleanup of existing connections before creating new ones
- Added exponential backoff (1.5x multiplier) for reconnection attempts
- Capped maximum delay at 30 seconds
- Fixed useEffect to only connect once on mount
- Improved disconnect logic to prevent auto-reconnect

### 2. Connection State Management
- Prevent multiple connections by checking `isConnectingRef.current`
- Clean up WebSocket before creating new one
- Clear reconnection timeouts properly
- Set reconnect attempts to max on manual disconnect

### 3. Error Handling
- Try-catch around WebSocket creation
- Better error logging for debugging
- Proper status updates on all error paths

## Testing

### Test the Fixed WebSocket
1. Start frontend: `cd frontend && npm run dev`
2. Open browser console
3. Look for these logs:
   ```
   [useWebSocket] Initializing connection on mount
   [useWebSocket] ✅ WebSocket opened successfully
   ```

### Expected Behavior
- ✅ Only ONE connection attempt on mount
- ✅ Exponential backoff on reconnection (5s, 7.5s, 11.25s, etc.)
- ✅ Clean disconnection on unmount
- ✅ No "Insufficient resources" errors

## Configuration

### Current Settings
- **Max Reconnect Attempts**: 10
- **Base Reconnect Interval**: 5000ms
- **Backoff Multiplier**: 1.5x
- **Max Backoff**: 30000ms

### Adjust in Dashboard.tsx:
```typescript
const { status, lastMessage } = useWebSocket({
  url: WS_URL,
  reconnectInterval: 5000,     // Base delay
  maxReconnectAttempts: 10,    // Max retries
  // ...
});
```

## Architecture Notes

### WebSocket Flow
1. Client connects to `wss://il7omaw929.execute-api.us-east-2.amazonaws.com/prod`
2. API Gateway invokes `connect` Lambda
3. Connection ID stored in DynamoDB
4. DynamoDB streams trigger `stream-processor` Lambda
5. Updates broadcast to all active connections
6. On disconnect, `disconnect` Lambda cleans up

### Connection Limits
- **API Gateway**: 500 connections/second, 10,000 concurrent connections per account
- **WebSocket idle timeout**: 10 minutes (configurable)
- **DynamoDB TTL**: 24 hours for stale connections

## Troubleshooting

### Still seeing "Insufficient resources"?
1. Check browser console for connection loops
2. Verify only one useWebSocket instance per app
3. Check API Gateway CloudWatch logs for rate limiting
4. Verify Lambda concurrency limits

### Check CloudWatch Logs
```bash
aws logs tail /aws/lambda/IopsDashboard-ConnectFunction --follow
aws logs tail /aws/lambda/IopsDashboard-DisconnectFunction --follow
```

### Monitor API Gateway
```bash
aws apigatewayv2 get-api --api-id il7omaw929
aws apigatewayv2 get-stages --api-id il7omaw929
```

## Future Improvements

1. **Add throttling** - Rate limit connection attempts per IP
2. **Add authentication** - Require tokens for WebSocket connections
3. **Add heartbeat** - Periodic ping/pong to detect stale connections
4. **Add metrics** - CloudWatch dashboard for connection metrics
5. **Add circuit breaker** - Stop reconnecting after persistent failures
