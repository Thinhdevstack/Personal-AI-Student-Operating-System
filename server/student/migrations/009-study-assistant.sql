CREATE TABLE assistant_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE assistant_turns (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  conversationId TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  requestId TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  scope TEXT NOT NULL,
  message TEXT NOT NULL,
  language TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  mode TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','completed','failed')),
  answer TEXT,
  errorCode TEXT,
  createdAt TEXT NOT NULL,
  UNIQUE(conversationId, requestId)
);
CREATE UNIQUE INDEX assistant_one_pending ON assistant_turns(conversationId) WHERE status='pending';
