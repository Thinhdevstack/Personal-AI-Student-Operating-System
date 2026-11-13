import { request, mutate } from '@/features/academic/api';
import type { StudyLog, StudySummary, StudyTask, StudyTaskGroup, TaskSuggestion } from './types';

export function listLogs(params?: {
  courseId?: string;
  studyDate?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (params?.courseId) query.set('courseId', params.courseId);
  if (params?.studyDate) query.set('studyDate', params.studyDate);
  if (params?.fromDate) query.set('fromDate', params.fromDate);
  if (params?.toDate) query.set('toDate', params.toDate);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return request<{ items: StudyLog[]; logs: StudyLog[]; total: number; limit: number; offset: number }>(
    `study-logs${qs ? `?${qs}` : ''}`,
    { signal }
  );
}

export function getLog(id: string, signal?: AbortSignal) {
  return request<StudyLog>(`study-logs/${id}`, { signal });
}

export function createLog(input: Partial<StudyLog>) {
  return mutate<StudyLog>('study-logs', 'POST', input);
}

export function updateLog(id: string, input: Partial<StudyLog>) {
  return mutate<StudyLog>(`study-logs/${id}`, 'PATCH', input);
}

export function deleteLog(id: string) {
  return mutate<{ ok: boolean; id: string }>(`study-logs/${id}`, 'DELETE');
}

export function getSummary(params?: { courseId?: string; year?: number; months?: number }, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (params?.courseId) query.set('courseId', params.courseId);
  if (params?.year) query.set('year', String(params.year));
  if (params?.months) query.set('months', String(params.months));
  const qs = query.toString();
  return request<StudySummary>(`study-logs/summary${qs ? `?${qs}` : ''}`, { signal });
}

export function listTasks(params?: { courseId?: string; date?: string; status?: string; scope?: string }, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (params?.courseId) query.set('courseId', params.courseId);
  if (params?.date) query.set('date', params.date);
  if (params?.status) query.set('status', params.status);
  if (params?.scope) query.set('scope', params.scope);
  const qs = query.toString();
  return request<StudyTaskGroup>(`study-tasks${qs ? `?${qs}` : ''}`, { signal });
}

export function getTask(id: string, signal?: AbortSignal) {
  return request<StudyTask>(`study-tasks/${id}`, { signal });
}

export function createTask(input: Partial<StudyTask> & { requestId?: string }) {
  return mutate<StudyTask>('study-tasks', 'POST', input);
}

export function updateTask(id: string, input: Partial<StudyTask>) {
  return mutate<StudyTask>(`study-tasks/${id}`, 'PATCH', input);
}

export function deleteTask(id: string) {
  return mutate<{ ok: boolean; id: string }>(`study-tasks/${id}`, 'DELETE');
}

export function completeTask(id: string, input: {
  actualMinutes?: number;
  durationMinutes?: number;
  content?: string;
  learnedContent?: string;
  blockers?: string;
  difficulties?: string;
  nextSteps?: string;
  studyDate?: string;
  activityType?: string;
  requestId?: string;
}) {
  return mutate<{ task: StudyTask; log: StudyLog; studyLog: StudyLog }>(`study-tasks/${id}/complete`, 'POST', input);
}

export function reopenTask(id: string) {
  return mutate<StudyTask>(`study-tasks/${id}/reopen`, 'POST');
}

export function updateReminder(id: string, input: { action: 'dismiss' | 'snooze'; snoozeMinutes?: number }) {
  return mutate<StudyTask>(`study-tasks/${id}/reminder`, 'POST', input);
}

export function getSuggestions(params?: { date?: string; courseId?: string; limit?: number }, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (params?.date) query.set('date', params.date);
  if (params?.courseId) query.set('courseId', params.courseId);
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return request<{ suggestions: TaskSuggestion[]; nextSteps: unknown[]; overdueTasks: unknown[] }>(`study-tasks/suggestions${qs ? `?${qs}` : ''}`, { signal });
}
