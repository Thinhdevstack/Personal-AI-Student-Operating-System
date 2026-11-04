CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('global','course')),
  courseId TEXT REFERENCES courses(id) ON DELETE RESTRICT,
  content TEXT NOT NULL CHECK(length(trim(content)) BETWEEN 1 AND 1000),
  normalizedContent TEXT NOT NULL,
  sourceMessageId TEXT REFERENCES chat_messages(id) ON DELETE RESTRICT,
  sourceCourseId TEXT REFERENCES courses(id) ON DELETE RESTRICT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  CHECK((scope='global' AND courseId IS NULL) OR (scope='course' AND courseId IS NOT NULL)),
  CHECK((sourceMessageId IS NULL AND sourceCourseId IS NULL) OR (sourceMessageId IS NOT NULL AND sourceCourseId IS NOT NULL)),
  CHECK(scope='global' OR sourceCourseId IS NULL OR sourceCourseId=courseId)
);
CREATE UNIQUE INDEX memories_content ON memories(scope, ifnull(courseId,''), normalizedContent);
CREATE INDEX memories_scope ON memories(scope, courseId, updatedAt);
CREATE TRIGGER memories_source_insert BEFORE INSERT ON memories
WHEN NEW.sourceMessageId IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversationId
  JOIN chat_turns t ON t.id=m.turnId
  WHERE m.id=NEW.sourceMessageId AND c.courseId=NEW.sourceCourseId AND t.status='completed'
)
BEGIN SELECT RAISE(ABORT, 'invalid memory source'); END;
CREATE TRIGGER memories_source_update BEFORE UPDATE ON memories
WHEN NEW.sourceMessageId IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversationId
  JOIN chat_turns t ON t.id=m.turnId
  WHERE m.id=NEW.sourceMessageId AND c.courseId=NEW.sourceCourseId AND t.status='completed'
)
BEGIN SELECT RAISE(ABORT, 'invalid memory source'); END;
CREATE TABLE memory_create_requests (
  requestId TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  memoryId TEXT REFERENCES memories(id) ON DELETE SET NULL
);
ALTER TABLE chat_messages ADD COLUMN memories TEXT NOT NULL DEFAULT '[]';
