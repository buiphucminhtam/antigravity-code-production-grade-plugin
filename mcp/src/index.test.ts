import { describe, expect, it } from 'vitest';
import { deferredSkillAllowlist } from './index.js';

describe('deferredSkillAllowlist', () => {
  it('defaults to disabled and accepts unique safe names', () => {
    expect(deferredSkillAllowlist('')).toEqual([]);
    expect(deferredSkillAllowlist('["software-engineer","ui-designer"]')).toEqual([
      'software-engineer',
      'ui-designer',
    ]);
  });

  it.each(['not-json', '{}', '["Bad"]', '["safe","safe"]'])('fails startup for %s', (raw) => {
    expect(() => deferredSkillAllowlist(raw)).toThrow('FORGEWRIGHT_DEFERRED_SKILLS_JSON');
  });
});
