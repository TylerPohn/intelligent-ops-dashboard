import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface SSEMessage {
  type?: string;
  data: unknown;
}

export interface UseSSEOptions {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onMessage?: (message: SSEMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  invalidateQueries?: string[];
}

/**
 * Server-Sent Events (SSE) hook - simpler and more reliable than WebSocket
 *
 * Benefits over WebSocket:
 * - Built on regular HTTP (no special protocol)
 * - Automatic reconnection built-in
 * - Better browser support
 * - Works through most proxies/firewalls
 * - Simpler error handling
 */
export function useSSE(options: UseSSEOptions) {
  const {
    url,
    reconnectInterval = 5000,
    maxReconnectAttempts = 10,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    invalidateQueries = ['insights'],
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [lastMessage, setLastMessage] = useState<SSEMessage | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | undefined>(undefined);
  const queryClient = useQueryClient();

  const connect = useCallback(() => {
    // Check if already connected
    if (eventSourceRef.current?.readyState === EventSource.OPEN) {
      console.log('[useSSE] Already connected, skipping');
      return;
    }

    // Clean up existing connection
    if (eventSourceRef.current) {
      console.log('[useSSE] Cleaning up existing connection');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    console.log(`[useSSE] Connecting to: ${url}`);
    setStatus('connecting');

    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      console.log('[useSSE] ✅ Connected successfully');
      setStatus('connected');
      reconnectAttemptsRef.current = 0;
      onConnect?.();
    };

    eventSource.onmessage = (event) => {
      try {
        console.log('[useSSE] Message received:', event.data);
        const data = JSON.parse(event.data);
        const message: SSEMessage = { data };

        setLastMessage(message);
        onMessage?.(message);

        // Invalidate TanStack Query cache
        invalidateQueries.forEach((queryKey) => {
          void queryClient.invalidateQueries({ queryKey: [queryKey] });
        });
      } catch (error) {
        console.error('[useSSE] Failed to parse message:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[useSSE] ❌ Connection error');
      setStatus('error');
      onError?.(error);

      // EventSource will automatically reconnect, but we track manual reconnections
      if (eventSource.readyState === EventSource.CLOSED) {
        eventSource.close();
        eventSourceRef.current = null;
        setStatus('disconnected');
        onDisconnect?.();

        // Manual reconnection with exponential backoff
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          const backoffDelay = reconnectInterval * Math.pow(1.5, reconnectAttemptsRef.current - 1);
          const cappedDelay = Math.min(backoffDelay, 30000);

          console.log(
            `[useSSE] Reconnecting... (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts}) in ${cappedDelay}ms`
          );

          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }

          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect();
          }, cappedDelay);
        } else {
          console.error('[useSSE] ❌ Max reconnection attempts reached');
        }
      }
    };

    eventSourceRef.current = eventSource;
  }, [url, reconnectInterval, maxReconnectAttempts, onConnect, onDisconnect, onError, onMessage, invalidateQueries, queryClient]);

  const disconnect = useCallback(() => {
    console.log('[useSSE] Disconnecting...');

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    reconnectAttemptsRef.current = maxReconnectAttempts; // Prevent auto-reconnect

    if (eventSourceRef.current) {
      try {
        eventSourceRef.current.close();
      } catch (error) {
        console.error('[useSSE] Error closing connection:', error);
      }
      eventSourceRef.current = null;
    }

    setStatus('disconnected');
  }, [maxReconnectAttempts]);

  useEffect(() => {
    // Only connect once on mount
    const shouldConnect = !eventSourceRef.current;

    if (shouldConnect) {
      console.log('[useSSE] Initializing connection on mount');
      connect();
    }

    // Cleanup on unmount
    return () => {
      console.log('[useSSE] Cleaning up on unmount');
      disconnect();
    };
  }, []); // Empty deps - only run on mount/unmount

  return {
    status,
    lastMessage,
    connect,
    disconnect,
  };
}
