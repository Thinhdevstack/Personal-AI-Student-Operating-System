-- Migration 008: Expand provider CHECK to include 'ollama-cloud' and add sourceTarget column
ALTER TABLE chat_turns RENAME COLUMN provider TO legacyProvider;
ALTER TABLE chat_turns ADD COLUMN provider TEXT NOT NULL DEFAULT 'openai'
  CHECK(provider IN ('openai','gemini','deepseek','ollama','ollama-cloud','mock'));
UPDATE chat_turns SET provider=legacyProvider;
ALTER TABLE chat_turns DROP COLUMN legacyProvider;
ALTER TABLE chat_turns ADD COLUMN sourceTarget TEXT;
