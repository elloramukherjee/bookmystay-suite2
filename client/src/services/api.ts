import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { ApiErrorBody, LoginResponse } from '../types/api';

/**
 * The access token lives only in memory (never localStorage) so an XSS bug can't lift a long-lived
 * credential. The refresh token is an httpOnly cookie the browser sends to /api/v1/auth only.
 */
let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (token: string | null) => {
    accessToken = token;
  },
  onExpired: (handler: (() => void) | null) => {
    onSessionExpired = handler;
  },
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorBody['details'],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages keyed by path, for wiring into react-hook-form. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(this.details.map((d) => [d.path, d.message]));
  }
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
  withCredentials: true,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.set('Authorization', `Bearer ${accessToken}`);
  return config;
});

let refreshInFlight: Promise<string | null> | null = null;

/** Single-flight refresh: concurrent 401s share one /auth/refresh call. */
export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= axios
    .post<{ data: LoginResponse }>(`${api.defaults.baseURL}/auth/refresh`, null, { withCredentials: true, timeout: 15_000 })
    .then((res) => {
      accessToken = res.data.data.accessToken;
      return accessToken;
    })
    .catch(() => {
      accessToken = null;
      return null;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<{ error?: ApiErrorBody }>) => {
    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status ?? 0;
    const body = error.response?.data?.error;

    const isAuthEndpoint = config?.url?.startsWith('/auth/');
    if (status === 401 && config && !config._retried && !isAuthEndpoint && accessToken !== null) {
      config._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        config.headers.set('Authorization', `Bearer ${token}`);
        return api.request(config);
      }
      onSessionExpired?.();
    }

    if (!error.response) {
      throw new ApiError(0, 'NETWORK', navigator.onLine ? 'Could not reach the server. Please try again.' : 'You are offline. Check your connection.');
    }
    throw new ApiError(status, body?.code ?? 'UNKNOWN', body?.message ?? 'Something went wrong', body?.details);
  },
);

/** Unwraps the `{ data }` envelope. */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const res = await api.request<{ data: T }>(config);
  return res.data.data;
}

export const errorMessage = (err: unknown): string => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong');
