import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import type { ApiError } from '@careerpilot/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

/**
 * Typed API client.
 *
 * Two things happen here that would otherwise be repeated in every hook:
 *  - a 401 triggers a single refresh attempt, and all concurrent requests that
 *    failed meanwhile are replayed once the new token arrives
 *  - error envelopes are unwrapped into a consistent `ApiClientError`, so the
 *    UI can show `error.message` directly and branch on `error.code`
 */

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Array<{ path: string; message: string }>;
  readonly requestId?: string;

  constructor(error: ApiError, status: number) {
    super(error.message);
    this.name = 'ApiClientError';
    this.code = error.code;
    this.status = status;
    this.details = error.details;
    this.requestId = error.requestId;
  }

  /** Field-level message for a form, keyed by the field path. */
  fieldError(path: string): string | undefined {
    return this.details?.find((d) => d.path === path)?.message;
  }
}

let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

export const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  // The refresh token is an httpOnly cookie, so credentials must be sent.
  withCredentials: true,
  timeout: 180_000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/** Single-flight refresh: concurrent 401s wait on one refresh request. */
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true })
      .then((response) => {
        const token = response.data?.data?.tokens?.accessToken as string | undefined;
        if (token) setAccessToken(token);
        return token ?? null;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error?: ApiError }>) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };
    const status = error.response?.status ?? 0;
    const payload = error.response?.data?.error;

    // Refresh once on an expired/invalid access token, then replay the request.
    // The refresh endpoint itself is excluded to avoid an infinite loop.
    const isAuthEndpoint = original?.url?.includes('/auth/refresh') || original?.url?.includes('/auth/login');
    if (status === 401 && original && !original._retried && !isAuthEndpoint) {
      original._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return http(original);
      }
      onUnauthenticated?.();
    }

    if (payload) {
      return Promise.reject(new ApiClientError(payload, status));
    }

    if (error.code === 'ECONNABORTED') {
      return Promise.reject(
        new ApiClientError(
          { code: 'TIMEOUT', message: 'The request took too long. AI analysis can be slow - please try again.' },
          0,
        ),
      );
    }

    return Promise.reject(
      new ApiClientError(
        {
          code: 'NETWORK_ERROR',
          message: 'Could not reach the server. Check your connection and try again.',
        },
        status,
      ),
    );
  },
);

/* ------------------------------------------------------------------ */
/* Typed helpers                                                       */
/* ------------------------------------------------------------------ */

export interface Paginated<T> {
  items: T[];
  meta: { page: number; limit: number; total: number; totalPages: number } & Record<string, unknown>;
}

export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const response = await http.get(url, { params });
  return response.data.data as T;
}

export async function apiGetPaginated<T>(url: string, params?: Record<string, unknown>): Promise<Paginated<T>> {
  const response = await http.get(url, { params });
  return { items: response.data.data as T[], meta: response.data.meta };
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const response = await http.post(url, body);
  return response.data.data as T;
}

export async function apiPut<T>(url: string, body?: unknown): Promise<T> {
  const response = await http.put(url, body);
  return response.data.data as T;
}

export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const response = await http.patch(url, body);
  return response.data.data as T;
}

export async function apiDelete<T = void>(url: string): Promise<T> {
  const response = await http.delete(url);
  return response.data?.data as T;
}

/** Uploads a file with progress, used by the resume uploader. */
export async function apiUpload<T>(
  url: string,
  file: File,
  fieldName = 'resume',
  onProgress?: (percent: number) => void,
): Promise<T> {
  const formData = new FormData();
  formData.append(fieldName, file);

  const response = await http.post(url, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (event) => {
      if (event.total && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    },
  });
  return response.data.data as T;
}

/**
 * Downloads a binary response (PDF/CSV) and hands it to the browser.
 * Errors arrive as a JSON blob, so they are decoded before being surfaced.
 */
export async function apiDownload(url: string, filename: string, params?: Record<string, unknown>): Promise<void> {
  try {
    const response = await http.get(url, { params, responseType: 'blob' });

    const disposition = response.headers['content-disposition'] as string | undefined;
    const match = disposition?.match(/filename="?([^";]+)"?/);
    const resolvedName = match?.[1] ? decodeURIComponent(match[1]) : filename;

    const blobUrl = URL.createObjectURL(response.data as Blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = resolvedName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    if (error instanceof ApiClientError) throw error;

    const blob = (error as AxiosError).response?.data as Blob | undefined;
    if (blob instanceof Blob) {
      const text = await blob.text();
      try {
        const parsed = JSON.parse(text) as { error?: ApiError };
        if (parsed.error) {
          throw new ApiClientError(parsed.error, (error as AxiosError).response?.status ?? 0);
        }
      } catch {
        // Fall through to the generic error below.
      }
    }
    throw new ApiClientError({ code: 'DOWNLOAD_FAILED', message: 'The download could not be completed.' }, 0);
  }
}
