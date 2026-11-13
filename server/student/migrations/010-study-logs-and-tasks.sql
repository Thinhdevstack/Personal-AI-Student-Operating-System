CREATE TABLE study_logs (
  id TEXT PRIMARY KEY,
  studyDate TEXT NOT NULL,
  courseId TEXT REFERENCES courses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  activityType TEXT NOT NULL CHECK(activityType IN ('read', 'assignment', 'review', 'practice', 'other')),
  durationMinutes INTEGER CHECK(durationMinutes IS NULL OR (durationMinutes >= 0 AND durationMinutes <= 1440)),
  learnedContent TEXT NOT NULL,
  difficulties TEXT,
  nextSteps TEXT,
  sourceTurnId TEXT,
  sourceConversationId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX idx_study_logs_date ON study_logs(studyDate);
CREATE INDEX idx_study_logs_course ON study_logs(courseId);

CREATE TABLE study_tasks (
  id TEXT PRIMARY KEY,
  courseId TEXT REFERENCES courses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  plannedDate TEXT NOT NULL,
  plannedTime TEXT,
  estimatedDuration INTEGER CHECK(estimatedDuration IS NULL OR (estimatedDuration >= 0 AND estimatedDuration <= 1440)),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'skipped')),
  completedAt TEXT,
  studyLogId TEXT REFERENCES study_logs(id) ON DELETE SET NULL,
  reminderDismissedAt TEXT,
  reminderSnoozedUntil TEXT,
  requestId TEXT UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX idx_study_tasks_date ON study_tasks(plannedDate, status);
CREATE INDEX idx_study_tasks_course ON study_tasks(courseId);

