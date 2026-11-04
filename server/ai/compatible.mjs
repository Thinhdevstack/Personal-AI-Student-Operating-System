import OpenAI from 'openai';
import { AI_CONFIG } from './config.mjs';
import { aiError, TUTOR_FORMAT } from './openai.mjs';
import { StudentError } from '../student/storage.mjs';

/** Fixed upstreams, separate keys, shared bounded tutor schema. No automatic provider fallback. */
export function createCompatibleChatProvider({ id, apiKey, model, client, fetch: fetcher }) {
  if (!['gemini', 'deepseek'].includes(id)) throw new StudentError('aiProviderInvalid');
  const baseURL = id === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/openai/' : 'https://api.deepseek.com';
  let sdk = client;
  return {
    providerId: id, chatModel: model, isMock: false,
    async chat(context) {
      try {
        if (!sdk) {
          if (!apiKey) throw new StudentError('aiKeyMissing');
          sdk = new OpenAI({ apiKey, baseURL, timeout: AI_CONFIG.timeoutMs, maxRetries: 0, ...(fetcher && { fetch: fetcher }) });
        }
        const response = await sdk.chat.completions.create({
          model, messages: [{ role: 'system', content: context.instructions }, ...context.input],
          max_tokens: AI_CONFIG.maxOutputTokens,
          ...(id === 'deepseek' ? { thinking: { type: 'disabled' }, response_format: { type: 'json_object' } } : { response_format: { type: 'json_schema', json_schema: { name: TUTOR_FORMAT.name, strict: true, schema: TUTOR_FORMAT.schema } }, reasoning_effort: 'low' }),
        });
        const choice = response.choices?.[0];
        if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw new StudentError('aiRefused', 422);
        if (choice?.finish_reason !== 'stop') throw new StudentError('aiIncomplete', 502);
        if (typeof choice.message?.content !== 'string' || !choice.message.content.trim() || choice.message.content.length > 100000) throw new StudentError('aiInvalidResponse', 502);
        let result;
        try { result = JSON.parse(choice.message.content); } catch { throw new StudentError('aiInvalidResponse', 502); }
        return { ...result, model, isMock: false };
      } catch (error) {
        if (id === 'gemini' && Array.isArray(error?.error?.details) && error.error.details.some((detail) => detail?.reason === 'API_KEY_INVALID')) throw new StudentError('aiKeyInvalid', 502);
        throw aiError(error);
      }
    },
  };
}
