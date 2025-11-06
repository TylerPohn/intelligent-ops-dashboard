import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface PollingMessage {
  data: unknown;
}

export interface UsePollingOptions {
  url: string;
  interval?: number;
  enabled?: boolean;
  onData?: (data: unknown[]) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  invalidateQueries?: string[];
}

/**
 * Polling hook - simpler and more reliable than SSE/WebSocket for Lambda
 *
 * Benefits:
 * - Works with standard REST API (no streaming needed)
 * - No connection management complexity
 * - Works reliably with API Gateway Lambda proxy
 * - Automatic error recovery
 * - Configurable polling interval
 */
export function usePolling(options: UsePollingOptions) {
  const {
    url,
    interval = 5000,
    enabled = true,
    onData,
    onConnect,
    onDisconnect,
    onError,
    invalidateQueries = ['insights'],
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [lastData, setLastData] = useState<unknown[] | null>(null);
  const [errorCount, setErrorCount] = useState(0);
  const intervalRef = useRef<number | undefined>(undefined);
  const queryClient = useQueryClient();
  const isPollingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (isPollingRef.current) {
      console.log('[usePolling] Fetch already in progress, skipping');
      return;
    }

    isPollingRef.current = true;

    try {
      console.log('[usePolling] Fetching data from:', url);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[usePolling] Data received:', data?.length || 0, 'items');

      // Reset error count on success
      if (errorCount > 0) {
        setErrorCount(0);
      }

      // Update status to connected on first successful fetch
      if (status !== 'connected') {
        setStatus('connected');
        onConnect?.();
      }

      // Process data
      if (data && Array.isArray(data)) {
        setLastData(data);
        onData?.(data);

        // Invalidate TanStack Query cache
        invalidateQueries.forEach((queryKey) => {
          void queryClient.invalidateQueries({ queryKey: [queryKey] });
        });
      }
    } catch (error) {
      console.error('[usePolling] ❌ Fetch error:', error);

      const newErrorCount = errorCount + 1;
      setErrorCount(newErrorCount);

      // Mark as error after 3 consecutive failures
      if (newErrorCount >= 3) {
        setStatus('error');
      }

      onError?.(error instanceof Error ? error : new Error('Unknown error'));
    } finally {
      isPollingRef.current = false;
    }
  }, [url, errorCount, status, onConnect, onData, onError, invalidateQueries, queryClient]);

  const start = useCallback(() => {
    if (intervalRef.current) {
      console.log('[usePolling] Already polling, skipping start');
      return;
    }

    console.log(`[usePolling] Starting polling every ${interval}ms`);
    setStatus('connecting');

    // Fetch immediately on start
    void fetchData();

    // Then poll at interval
    intervalRef.current = window.setInterval(() => {
      void fetchData();
    }, interval);
  }, [interval, fetchData]);

  const stop = useCallback(() => {
    console.log('[usePolling] Stopping polling');

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }

    setStatus('disconnected');
    onDisconnect?.();
  }, [onDisconnect]);

  useEffect(() => {
    if (enabled) {
      start();
    } else {
      stop();
    }

    return () => {
      stop();
    };
  }, [enabled]); // Only depend on enabled, not start/stop

  return {
    status,
    lastData,
    errorCount,
    start,
    stop,
  };
}
