/** Local learning uses the normal academic database; simulation data remains isolated. */
export function configureStudentLocal(env) {
  if (env.OFFICE_STUDENT_DEMO === '1' || env.OFFICE_STUDENT_LOCAL !== '1') return false;
  Object.assign(env, {
    AI_OFFLINE_MODE: '0', AI_MOCK_CHAT: '0', AI_MOCK_EMBEDDINGS: '0',
    AI_CHAT_PROVIDER: 'ollama', AI_EMBEDDING_PROVIDER: 'ollama',
    OFFICE_HOST: '127.0.0.1', OFFICE_TRANSLATE: '0', OFFICE_USAGE: '0',
    OFFICE_AI_ACCOUNTS: '0', OFFICE_CI: '0', OFFICE_VAULT: '0',
  });
  return true;
}
