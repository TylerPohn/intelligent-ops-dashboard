import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface WebSocketMessage {
  type: string;
  payload: unknown;
}

export interface UseWebSocketOptions {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  invalidateQueries?: string[];
}

export function useWebSocket(options: UseWebSocketOptions) {
  const {
    url,
    reconnectInterval = 5000,
    maxReconnectAttempts = 5,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    invalidateQueries = ['insights'],
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | undefined>(undefined);
  const isConnectingRef = useRef(false);
  const queryClient = useQueryClient();

  const connect = useCallback(() => {
    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current) {
      console.log('[useWebSocket] Connection already in progress, skipping');
      return;
    }

    // Check if already connected
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[useWebSocket] WebSocket already open, skipping reconnection');
      return;
    }

    // Clean up any existing connection
    if (wsRef.current) {
      console.log('[useWebSocket] Cleaning up existing connection');
      wsRef.current.close();
      wsRef.current = null;
    }

    isConnectingRef.current = true;
    console.log(`[useWebSocket] Attempting to connect to: ${url}`);
    setStatus('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      console.error('[useWebSocket] Failed to create WebSocket:', error);
      isConnectingRef.current = false;
      setStatus('error');
      return;
    }

    ws.onopen = () => {
      console.log('[useWebSocket] ✅ WebSocket opened successfully');
      isConnectingRef.current = false;
      setStatus('connected');
      reconnectAttemptsRef.current = 0;

      // Send initial ping to keep connection alive
      try {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        console.log('[useWebSocket] Sent initial ping message');
      } catch (error) {
        console.error('[useWebSocket] Failed to send ping:', error);
      }

      onConnect?.();
    };

    ws.onmessage = (event) => {
      try {
        console.log('[useWebSocket] Message received:', event.data);
        const message: WebSocketMessage = JSON.parse(event.data);
        setLastMessage(message);
        onMessage?.(message);

        // Invalidate TanStack Query cache for relevant queries
        invalidateQueries.forEach((queryKey) => {
          void queryClient.invalidateQueries({ queryKey: [queryKey] });
        });
      } catch (error) {
        console.error('[useWebSocket] Failed to parse WebSocket message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[useWebSocket] ❌ WebSocket error:', error);
      isConnectingRef.current = false;
      setStatus('error');
      onError?.(error);
    };

    ws.onclose = (event) => {
      console.log(`[useWebSocket] ❌ WebSocket closed - Code: ${event.code}, Reason: ${event.reason || 'none'}`);
      isConnectingRef.current = false;
      setStatus('disconnected');
      onDisconnect?.();

      // Only clear if this is still our connection
      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      // Attempt reconnection with exponential backoff
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current += 1;
        const backoffDelay = reconnectInterval * Math.pow(1.5, reconnectAttemptsRef.current - 1);
        const cappedDelay = Math.min(backoffDelay, 30000); // Cap at 30 seconds

        console.log(
          `[useWebSocket] Reconnecting... (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts}) in ${cappedDelay}ms`
        );

        // Clear any existing timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, cappedDelay);
      } else {
        console.error('[useWebSocket] ❌ Max reconnection attempts reached');
      }
    };

    wsRef.current = ws;
  }, [url, reconnectInterval, maxReconnectAttempts, onConnect, onDisconnect, onError, onMessage, invalidateQueries, queryClient]);

  const disconnect = useCallback(() => {
    console.log('[useWebSocket] Disconnecting...');

    // Clear reconnection timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    // Reset connection state
    isConnectingRef.current = false;
    reconnectAttemptsRef.current = maxReconnectAttempts; // Prevent auto-reconnect

    // Close WebSocket connection
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, 'Client disconnect');
      } catch (error) {
        console.error('[useWebSocket] Error closing WebSocket:', error);
      }
      wsRef.current = null;
    }

    setStatus('disconnected');
  }, [maxReconnectAttempts]);

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.error('WebSocket is not connected');
    }
  }, []);

  useEffect(() => {
    // Only connect once on mount
    const shouldConnect = !wsRef.current && !isConnectingRef.current;

    if (shouldConnect) {
      console.log('[useWebSocket] Initializing connection on mount');
      connect();
    }

    // Cleanup on unmount
    return () => {
      console.log('[useWebSocket] Cleaning up on unmount');
      disconnect();
    };
  }, []); // Empty deps - only run on mount/unmount

  return {
    status,
    lastMessage,
    sendMessage,
    connect,
    disconnect,
  };
}
