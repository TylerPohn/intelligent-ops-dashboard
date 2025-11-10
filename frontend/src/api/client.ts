import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export interface Insight {
  alert_id: string;
  entity_id: string;
  timestamp: string;
  prediction_type: 'high_ib_call_frequency' | 'low_health_score' | 'supply_demand_imbalance' | 'churn_risk' | 'customer_health' | 'session_quality' | 'marketplace_balance' | 'tutor_capacity' | 'first_session_success';
  risk_score: number;
  explanation: string;
  recommendations: string[];
  model_used: string;
  confidence: number;
}

export interface MetricData {
  timestamp: string;
  value: number;
  entity_id: string;
}

export interface HealthMetric {
  timestamp: string;
  health_score: number;
  entity_id: string;
  cpu_utilization: number;
  memory_utilization: number;
  disk_io_rate: number;
  network_throughput: number;
}

export interface SessionMetric {
  timestamp: string;
  active_sessions: number;
  peak_sessions: number;
  entity_id: string;
}

export interface InsightsResponse {
  items: Insight[];
  nextToken?: string;
  aggregations?: {
    total: number;
    critical: number;
    avgRisk: number;
    byType: Record<string, number>;
  };
}

export interface Aggregations {
  total: number;
  critical: number;
  avgRisk: number;
  byType: Record<string, number>;
}

export type TimeRange = '1h' | '3h' | 'today' | 'week';

// Helper to convert time range to ISO timestamp
export const getTimeRangeISO = (range: TimeRange): string => {
  const now = new Date();
  switch (range) {
    case '1h':
      return new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    case '3h':
      return new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
    case 'today':
      return new Date(now.setHours(0, 0, 0, 0)).toISOString();
    case 'week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
};

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const insightsAPI = {
  // Legacy method - returns just items for backward compatibility
  getRecent: async (limit: number = 50): Promise<Insight[]> => {
    const response = await apiClient.get(`/insights/recent?limit=${limit}`);
    // Handle both old array format and new response format
    return Array.isArray(response.data) ? response.data : response.data.items;
  },

  // New method with full pagination and filtering support
  getRecentWithFilters: async (params: {
    limit?: number;
    since?: string;
    nextToken?: string;
    aggregations?: boolean;
  }): Promise<InsightsResponse> => {
    const queryParams = new URLSearchParams();
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.since) queryParams.append('since', params.since);
    if (params.nextToken) queryParams.append('nextToken', params.nextToken);
    if (params.aggregations) queryParams.append('aggregations', 'true');

    const response = await apiClient.get(`/insights/recent?${queryParams.toString()}`);
    return response.data;
  },

  // Get ALL insights for a time range (handles pagination automatically)
  // Limited to 5000 max for performance
  getAllInTimeRange: async (since?: string, signal?: AbortSignal): Promise<Insight[]> => {
    const startTime = Date.now();
    console.log(`🔄 Fetching insights for since=${since}`);

    const allInsights: Insight[] = [];
    let nextToken: string | undefined = undefined;
    let pageCount = 0;
    const maxInsights = 5000; // Hard limit for performance
    const maxPages = 5; // Only fetch 5 pages max

    do {
      // Check if request was aborted
      if (signal?.aborted) {
        console.log(`⚠️ Request aborted after ${pageCount} pages`);
        throw new Error('Request aborted');
      }

      const queryParams = new URLSearchParams();
      queryParams.append('limit', '1000');
      if (since) queryParams.append('since', since);
      if (nextToken) queryParams.append('nextToken', nextToken);

      const response = await apiClient.get(`/insights/recent?${queryParams.toString()}`, { signal });
      const data: InsightsResponse = response.data;

      // Stop if no items
      if (data.items.length === 0) {
        break;
      }

      allInsights.push(...data.items);
      nextToken = data.nextToken;
      pageCount++;

      console.log(`📄 Fetched ${allInsights.length} insights`);

      // Stop if we have enough data
      if (allInsights.length >= maxInsights) {
        console.log(`✅ Reached ${maxInsights} insights limit`);
        break;
      }

      // Stop if max pages reached
      if (pageCount >= maxPages) {
        console.log(`✅ Fetched ${pageCount} pages`);
        break;
      }

      // Stop if we got fewer items than requested (end of data)
      if (data.items.length < 1000) {
        console.log(`✅ Reached end of data`);
        break;
      }
    } while (nextToken);

    const duration = Date.now() - startTime;
    console.log(`✅ Done in ${duration}ms: ${allInsights.length} insights`);
    return allInsights;
  },

  // Get aggregations only (fast, no items)
  getAggregations: async (since?: string): Promise<Aggregations> => {
    const queryParams = since ? `?since=${since}` : '';
    const response = await apiClient.get(`/insights/aggregations${queryParams}`);
    return response.data;
  },

  getById: async (alertId: string): Promise<Insight> => {
    const response = await apiClient.get(`/insights/${alertId}`);
    return response.data;
  },
};

export const metricsAPI = {
  getLatest: async (entityId?: string): Promise<MetricData[]> => {
    const url = entityId ? `/metrics?entity_id=${entityId}` : '/metrics';
    const response = await apiClient.get(url);
    return response.data;
  },
};

export default apiClient;
