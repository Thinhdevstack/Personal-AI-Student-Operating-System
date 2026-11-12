import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTutorAnswer } from '../../server/ai/context.mjs';

test('P1 rejects a fabricated citation even when another citation is valid', () => {
  const sources = [{ sourceId: 'S1', documentId: 'document-a', pageNumber: 2 }];
  assert.throws(() => validateTutorAnswer({ answer: 'Explanation', basis: 'materials', sourceIds: ['S1', 'S99'] }, sources), (error) => error.code === 'aiInvalidCitation');
  assert.equal(validateTutorAnswer({ answer: 'Explanation', basis: 'materials', sourceIds: ['S1'] }, sources).sources[0].documentId, 'document-a');
});

test('P1 does not silently discard citations attached to general knowledge', () => {
  assert.throws(() => validateTutorAnswer({ answer: 'Explanation', basis: 'general', sourceIds: ['S1'] }, [{ sourceId: 'S1' }]), (error) => error.code === 'aiInvalidCitation');
});
