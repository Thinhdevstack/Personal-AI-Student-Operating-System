export type ActivityType = 'read' | 'assignment' | 'review' | 'practice' | 'other';
export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface StudyLog {
  id: string;
  studyDate: string;
  courseId: string | null;
  courseName?: string | null;
  courseCode?: string | null;
  courseStatus?: string | null;
  title: string;
  activityType: ActivityType;
  durationMinutes: number | null;
  learnedContent: string;
  difficulties?: string | null;
  nextSteps?: string | null;
  content?: string;
  blockers?: string | null;
  sourceTurnId?: string | null;
  sourceConversationId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyHeatmapDay {
  date: string;
  count: number;
  totalMinutes: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface StudySummary {
  startDate: string;
  endDate: string;
  days: StudyHeatmapDay[];
  totalLogs: number;
  totalMinutes: number;
  stats: {
    totalLogs: number;
    totalMinutes: number;
    activeDays: number;
  };
}

export interface StudyTask {
  id: string;
  courseId: string | null;
  courseName?: string | null;
  courseCode?: string | null;
  courseStatus?: string | null;
  title: string;
  plannedDate: string;
  plannedTime?: string | null;
  estimatedDuration?: number | null;
  priority: TaskPriority;
  notes?: string | null;
  status: TaskStatus;
  completedAt?: string | null;
  studyLogId?: string | null;
  reminderDismissedAt?: string | null;
  reminderSnoozedUntil?: string | null;
  reminderDismissed?: boolean;
  reminderSnoozed?: boolean;
  actualMinutes?: number | null;
  targetDate?: string;
  reminderTime?: string | null;
  estimatedMinutes?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskSuggestion {
  type: 'overdue_task' | 'log_next_step';
  reason: 'overdue' | 'next_steps';
  taskId?: string;
  logId?: string;
  title: string;
  originalTitle?: string;
  courseId?: string | null;
  courseName?: string | null;
  priority?: TaskPriority;
}

export interface StudyTaskGroup {
  items: StudyTask[];
  tasks?: StudyTask[];
  overdue: StudyTask[];
  today: StudyTask[];
  upcoming: StudyTask[];
  completed: StudyTask[];
  other: StudyTask[];
  todayDate: string;
}

