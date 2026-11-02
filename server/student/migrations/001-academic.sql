CREATE TABLE semesters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  academicYear TEXT NOT NULL,
  startDate TEXT,
  endDate TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  isActive INTEGER NOT NULL DEFAULT 0 CHECK(isActive IN (0,1)),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  CHECK(status != 'archived' OR isActive = 0)
);
CREATE UNIQUE INDEX one_active_semester ON semesters(isActive) WHERE isActive = 1;
CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  semesterId TEXT NOT NULL REFERENCES semesters(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX courses_semester ON courses(semesterId);
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  courseId TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  filename TEXT NOT NULL,
  originalFilename TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  storagePath TEXT NOT NULL UNIQUE,
  sizeBytes INTEGER NOT NULL CHECK(sizeBytes > 0),
  pageCount INTEGER,
  status TEXT NOT NULL CHECK(status IN ('uploaded','processing','ready','failed')),
  uploadedAt TEXT NOT NULL
);
CREATE INDEX documents_course ON documents(courseId);
