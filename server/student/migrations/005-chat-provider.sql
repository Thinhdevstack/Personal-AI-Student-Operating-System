ALTER TABLE chat_turns ADD COLUMN provider TEXT NOT NULL DEFAULT 'openai'
  CHECK(provider IN ('openai','gemini','deepseek','mock'));
UPDATE chat_turns SET provider='mock' WHERE isMock=1;
