import path from 'node:path';

/** Applied after dotenv and before server modules read settings. Demo storage is always isolated. */
export function configureStudentDemo(env, root) {
  if (env.OFFICE_STUDENT_DEMO !== '1') return false;
  const subdir = env.OFFICE_STUDENT_DEMO_SUBDIR || '';
  if (subdir && !/^[a-zA-Z0-9_-]{1,60}$/.test(subdir)) throw new Error('Invalid student demo subdirectory');
  const dir = path.resolve(root, 'data', 'student-demo', subdir);
  Object.assign(env, {
    AI_OFFLINE_MODE: '1', AI_MOCK_CHAT: '0', AI_MOCK_EMBEDDINGS: '0',
    AI_CHAT_PROVIDER: 'gemini', AI_EMBEDDING_PROVIDER: 'gemini',
    OPENAI_API_KEY: '', GEMINI_API_KEY: '', DEEPSEEK_API_KEY: '',
    OFFICE_DATA_DIR: dir, CLAUDE_CONFIG_DIR: path.join(dir, 'claude'),
    OFFICE_HOST: '127.0.0.1', OFFICE_TRANSLATE: '0', OFFICE_USAGE: '0',
    OFFICE_AI_ACCOUNTS: '0', OFFICE_CI: '0', OFFICE_VAULT: '0',
  });
  return true;
}
