import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export interface Insight {
  alert_id: string;
  entity_id: string;
  timestamp: string;
  prediction_type: 'high_ib_call_frequency' | 'low_health_score' | 'supply_demand_imbalance';
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

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const insightsAPI = {
  getRecent: async (limit: number = 50): Promise<Insight[]> => {
    const response = await apiClient.get(`/insights/recent?limit=${limit}`);
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
