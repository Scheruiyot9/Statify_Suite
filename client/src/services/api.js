import axios from 'axios';
import { useAuthStore } from '@/app/store';
import { queryClient } from '@/app/queryClient';

const api = axios.create({
  baseURL:         '/api/v1',
  headers:         { 'Content-Type': 'application/json' },
  timeout:         15000,
  withCredentials: true, // send httpOnly refresh cookie on every request
});

// Attach access token + super-admin company context to every request
api.interceptors.request.use((config) => {
  const { accessToken, user, activeCompanyId } = useAuthStore.getState();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  if (user?.role === 'super_admin' && activeCompanyId && !config.headers['X-Company-ID']) {
    config.headers['X-Company-ID'] = activeCompanyId;
  }
  return config;
});

// On 401: attempt silent token refresh once via httpOnly cookie, then force logout
let isRefreshing = false;
let failedQueue  = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  failedQueue = [];
};

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    if (error.response?.status === 401 && !original._retry && !original.url?.includes('/auth/')) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        });
      }

      original._retry = true;
      isRefreshing    = true;

      try {
        // Refresh token is in httpOnly cookie — no body needed
        const { data } = await axios.post('/api/v1/auth/refresh', {}, { withCredentials: true });
        const newToken = data.data.accessToken;
        useAuthStore.getState().setAccessToken(newToken);
        processQueue(null, newToken);
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        useAuthStore.getState().clearAuth();
        queryClient.clear();
        window.location.href = '/login';
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
