CREATE TABLE chat_conversations (
  id TEXT PRIMARY KEY,
  courseId TEXT NOT NULL UNIQUE REFERENCES courses(id) ON DELETE RESTRICT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE chat_turns (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  conversationId TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE RESTRICT,
  requestId TEXT NOT NULL,
  userMessage TEXT NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('en','vi')),
  status TEXT NOT NULL CHECK(status IN ('pending','completed','failed')),
  attemptId TEXT NOT NULL,
  leaseExpiresAt INTEGER NOT NULL,
  errorCode TEXT,
  model TEXT,
  isMock INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  UNIQUE(conversationId, requestId),
  UNIQUE(id, conversationId)
);
CREATE UNIQUE INDEX one_pending_chat ON chat_turns(conversationId) WHERE status='pending';
CREATE INDEX chat_turns_history ON chat_turns(conversationId, sequence);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL,
  turnId TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  basis TEXT CHECK(basis IN ('materials','general','insufficient')),
  sources TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL,
  FOREIGN KEY(turnId, conversationId) REFERENCES chat_turns(id, conversationId) ON DELETE RESTRICT,
  UNIQUE(turnId, role)
);
