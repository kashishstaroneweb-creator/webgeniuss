import axios from 'axios';

export const BACKEND_GENERATOR_URL = (
  import.meta.env.VITE_BACKEND_GENERATOR_URL || 'http://localhost:3000'
).replace(/\/+$/, '');

const backendGeneratorApi = axios.create({
  baseURL: BACKEND_GENERATOR_URL,
  headers: { 'Content-Type': 'application/json' },
});

backendGeneratorApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default backendGeneratorApi;
