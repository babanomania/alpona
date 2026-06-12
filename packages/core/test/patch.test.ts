import { describe, expect, it } from 'vitest';
import { applyPatch, parsePointer, PatchError } from '../src/engine/patch.js';
import type { PatchOperation } from '../src/engine/patch.js';

describe('parsePointer', () => {
  it('parses root and nested pointers', () => {
    expect(parsePointer('')).toEqual([]);
    expect(parsePointer('/widgets/0/id')).toEqual(['widgets', '0', 'id']);
  });

  it('unescapes ~0 and ~1 per RFC 6901', () => {
    expect(parsePointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
  });

  it('rejects pointers missing the leading slash', () => {
    expect(() => parsePointer('widgets')).toThrow();
  });
});

describe('applyPatch', () => {
  const doc = () => ({
    title: 'Ops',
    params: { from: '2026-05-01' },
    widgets: [
      { id: 'a', type: 'kpi_card' },
      { id: 'b', type: 'table' },
    ],
  });

  it('replaces a nested value', () => {
    const next = applyPatch(doc(), [{ op: 'replace', path: '/title', value: 'New' }]);
    expect(next.title).toBe('New');
  });

  it('adds to an object and appends to an array with "-"', () => {
    const next = applyPatch(doc(), [
      { op: 'add', path: '/params/to', value: '2026-06-01' },
      { op: 'add', path: '/widgets/-', value: { id: 'c', type: 'gauge' } },
    ]);
    expect((next.params as Record<string, string>).to).toBe('2026-06-01');
    expect(next.widgets).toHaveLength(3);
    expect(next.widgets[2]).toEqual({ id: 'c', type: 'gauge' });
  });

  it('inserts into the middle of an array', () => {
    const next = applyPatch(doc(), [{ op: 'add', path: '/widgets/1', value: { id: 'mid' } }]);
    expect(next.widgets.map((w) => w.id)).toEqual(['a', 'mid', 'b']);
  });

  it('removes an array element', () => {
    const next = applyPatch(doc(), [{ op: 'remove', path: '/widgets/0' }]);
    expect(next.widgets.map((w) => w.id)).toEqual(['b']);
  });

  it('moves and copies values', () => {
    const moved = applyPatch(doc(), [{ op: 'move', from: '/widgets/0', path: '/widgets/1' }]);
    expect(moved.widgets.map((w) => w.id)).toEqual(['b', 'a']);

    const copied = applyPatch(doc(), [{ op: 'copy', from: '/title', path: '/params/copy' }]);
    expect((copied.params as Record<string, string>).copy).toBe('Ops');
  });

  it('supports test, passing and failing', () => {
    expect(() => applyPatch(doc(), [{ op: 'test', path: '/title', value: 'Ops' }])).not.toThrow();
    expect(() => applyPatch(doc(), [{ op: 'test', path: '/title', value: 'Nope' }])).toThrow(
      PatchError,
    );
  });

  it('never mutates the input document', () => {
    const original = doc();
    const snapshot = structuredClone(original);
    applyPatch(original, [{ op: 'replace', path: '/title', value: 'Changed' }]);
    expect(original).toEqual(snapshot);
  });

  it('leaves the input untouched when a later op fails', () => {
    const original = doc();
    const snapshot = structuredClone(original);
    const ops: PatchOperation[] = [
      { op: 'replace', path: '/title', value: 'Changed' },
      { op: 'remove', path: '/nope' },
    ];
    expect(() => applyPatch(original, ops)).toThrow(PatchError);
    expect(original).toEqual(snapshot);
  });

  it('rejects replace of a missing key and out-of-bounds indices', () => {
    expect(() => applyPatch(doc(), [{ op: 'replace', path: '/missing', value: 1 }])).toThrow(
      PatchError,
    );
    expect(() => applyPatch(doc(), [{ op: 'add', path: '/widgets/9', value: {} }])).toThrow(
      PatchError,
    );
  });

  it('rejects moving a node into its own child', () => {
    const nested = { a: { b: { c: 1 } } };
    expect(() => applyPatch(nested, [{ op: 'move', from: '/a', path: '/a/b/x' }])).toThrow(
      PatchError,
    );
  });

  it('replaces the whole document at the root pointer', () => {
    const next = applyPatch<unknown>(doc(), [{ op: 'replace', path: '', value: { fresh: true } }]);
    expect(next).toEqual({ fresh: true });
  });
});
