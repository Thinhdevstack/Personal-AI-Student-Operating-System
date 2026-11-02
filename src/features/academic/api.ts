import type { AcademicSnapshot, Material, SearchResult } from './types';

export class AcademicApiError extends Error {}

export function apiUrl(path: string) {
  const url = new URL(`/api/student/${path}`, window.location.origin);
  const token = new URLSearchParams(window.location.search).get('k');
  if (token) url.searchParams.set('k', token);
  return url.toString();
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), { cache: 'no-store', ...init });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new AcademicApiError('serverError');
  }
  if (!response.ok) throw new AcademicApiError(typeof data.error === 'string' ? data.error : 'serverError');
  return data as T;
}

export const snapshot = (signal?: AbortSignal) => request<AcademicSnapshot>('snapshot', { signal });
export const materials = (id: string, signal?: AbortSignal) => request<Material[]>(`courses/${id}/materials`, { signal });
export const mutate = <T>(path: string, method: string, body?: object) =>
  request<T>(path, {
    method,
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
export const upload = (courseId: string, file: File) =>
  request<Material>(`courses/${courseId}/materials?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  });
export const processDocument = (id: string, sync = false) =>
  request<{ ok?: boolean; id?: string; status?: string; document?: Material }>(
    `documents/${id}/process${sync ? '?sync=true' : ''}`,
    { method: 'POST' }
  );
export const searchCourse = (courseId: string, query: string, limit = 5) =>
  request<{ results: SearchResult[] }>(`courses/${courseId}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  });
