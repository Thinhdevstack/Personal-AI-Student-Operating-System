import { validateTutorAnswer } from './context.mjs';
import { StudentError } from '../student/storage.mjs';

// Both conversation scopes use the same provider and citation boundary.
export async function invokeTutor(provider, context, signal) {
  const result = await provider.chat(context, { signal });
  if (signal?.aborted) throw new StudentError('chatCancelled', 409);
  if (context.mode === 'materials' && result.basis === 'general') throw new StudentError('aiInvalidResponse', 502);
  const answer = finalizeTutor(result, context);
  return { ...answer, model: result.model || provider.chatModel || null, isMock: !!result.isMock };
}

export function finalizeTutor(result, context) {
  if (context.mode === 'materials' && result.basis === 'general') throw new StudentError('aiInvalidResponse', 502);
  return validateTutorAnswer(result, context.sources);
}
