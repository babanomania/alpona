import { describe, expect, it } from 'vitest';
import { getLayout, layoutTemplates, parseLayoutRef } from '../src/layouts/index.js';
import { getWidgetDefinition } from '../src/registry/index.js';

describe('layout library', () => {
  it('bundles at least 10 templates with unique name@version refs', () => {
    expect(layoutTemplates.length).toBeGreaterThanOrEqual(10);
    const refs = layoutTemplates.map((t) => `${t.name}@${t.version}`);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('every accepted widget type exists in the registry', () => {
    for (const template of layoutTemplates) {
      for (const slot of template.slots) {
        for (const type of slot.accepts) {
          expect(
            getWidgetDefinition(type),
            `${template.name}@${template.version} slot "${slot.id}" accepts unknown type "${type}"`,
          ).toBeDefined();
        }
      }
    }
  });

  it('slot regions never overlap within a template', () => {
    for (const template of layoutTemplates) {
      const slots = template.slots;
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const a = slots[i]!.region;
          const b = slots[j]!.region;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(
            overlap,
            `${template.name}: slots "${slots[i]!.id}" and "${slots[j]!.id}" overlap`,
          ).toBe(false);
        }
      }
    }
  });

  it('every slot can fit at least minWidgets at their minimum sizes', () => {
    for (const template of layoutTemplates) {
      for (const slot of template.slots) {
        if (slot.minWidgets === 0 || slot.accepts.length === 0) continue;
        const minW = Math.max(...slot.accepts.map((t) => getWidgetDefinition(t)!.sizing.minW));
        const perRow = Math.floor(slot.region.w / minW);
        expect(
          perRow,
          `${template.name} slot "${slot.id}" cannot fit one widget per row`,
        ).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('parseLayoutRef / getLayout', () => {
  it('parses pinned refs', () => {
    expect(parseLayoutRef('ops-monitor@2')).toEqual({ name: 'ops-monitor', version: 2 });
    expect(parseLayoutRef('bad ref')).toBeUndefined();
  });

  it('resolves the README layout', () => {
    expect(getLayout('ops-monitor@2')?.slots.map((s) => s.id)).toEqual([
      'kpis',
      'hero',
      'side',
      'detail',
    ]);
    expect(getLayout('ops-monitor@1')).toBeUndefined();
  });
});
