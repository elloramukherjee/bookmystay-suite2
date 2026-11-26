import type { LoginResponse, MeResponse, StaffRole, User } from '../types/api';
import { api, request } from './api';

export const authService = {
  login: (email: string, password: string) => request<LoginResponse>({ method: 'POST', url: '/auth/login', data: { email, password } }),
  logout: () => api.post('/auth/logout'),
  me: () => request<MeResponse>({ method: 'GET', url: '/auth/me' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<LoginResponse>({ method: 'POST', url: '/auth/change-password', data: { currentPassword, newPassword } }),
  register: (input: { name: string; email: string; password: string; role: Exclude<StaffRole, 'super_admin' | 'owner'>; phone?: string }) =>
    request<{ user: User }>({ method: 'POST', url: '/auth/register', data: input }),
};
