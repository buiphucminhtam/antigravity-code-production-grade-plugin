import { describe, expect, it } from 'vitest';
import { ProductOutcomeActionSchema } from './product-outcome-contract.js';

describe('Product Outcome to Web ACI action compatibility', () => {
  it('preserves legacy click type and two-axis scroll payloads', () => {
    for (const action of [
      { actionId: 'legacy-click', kind: 'click', payload: { target: 'confirm' } },
      { actionId: 'legacy-type', kind: 'type', payload: { target: 'name', text: 'Task' } },
      { actionId: 'legacy-scroll', kind: 'scroll', payload: { xDelta: 0, yDelta: 120 } },
    ])
      expect(ProductOutcomeActionSchema.parse(action)).toEqual(action);
  });

  it('preserves semantic click and fill payloads required by the actual Web adapter', () => {
    for (const action of [
      {
        actionId: 'semantic-click',
        kind: 'click',
        payload: { target: { role: 'button', name: 'Add task' } },
      },
      {
        actionId: 'semantic-fill',
        kind: 'fill',
        payload: { target: { role: 'textbox', name: 'Task name' }, value: 'Ship reference' },
      },
      {
        actionId: 'clear-fill',
        kind: 'fill',
        payload: { target: { role: 'textbox', name: 'Task name' }, value: '' },
      },
      { actionId: 'semantic-scroll', kind: 'scroll', payload: { deltaY: 120 } },
    ])
      expect(ProductOutcomeActionSchema.parse(action)).toEqual(action);
  });

  it('rejects selector injection extra fields and malformed semantic actions', () => {
    for (const action of [
      {
        actionId: 'bad-click',
        kind: 'click',
        payload: { target: { role: 'button', name: 'Add task', selector: '#submit' } },
      },
      {
        actionId: 'bad-fill',
        kind: 'fill',
        payload: {
          target: { role: 'textbox', name: 'Task name' },
          value: 'x',
          token: 'unexpected',
        },
      },
      {
        actionId: 'bad-role',
        kind: 'fill',
        payload: { target: { role: '', name: 'Task name' }, value: 'x' },
      },
      { actionId: 'bad-scroll', kind: 'scroll', payload: { deltaY: 120, yDelta: 120 } },
      {
        actionId: 'bad-size',
        kind: 'fill',
        payload: { target: { role: 'textbox', name: 'Task name' }, value: 'x'.repeat(4097) },
      },
    ])
      expect(ProductOutcomeActionSchema.safeParse(action).success).toBe(false);
  });
});
