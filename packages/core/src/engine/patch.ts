/**
 * Minimal RFC 6902 (JSON Patch) implementation.
 *
 * Refinements arrive from the agent as patches against the current spec —
 * only what changed moves. Operations are applied atomically: any failure
 * throws and the original document is untouched.
 */

export interface PatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

export class PatchError extends Error {
  constructor(
    message: string,
    readonly operation: PatchOperation,
    readonly index: number,
  ) {
    super(`patch op ${index} (${operation.op} ${operation.path}): ${message}`);
    this.name = 'PatchError';
  }
}

/** RFC 6901 JSON Pointer → path segments ("~1" → "/", "~0" → "~"). */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`invalid JSON Pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((seg) => seg.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Walks to the parent of the pointer target. Throws on missing intermediate nodes. */
function resolveParent(doc: unknown, segments: string[]): { parent: unknown; key: string } {
  if (segments.length === 0) throw new Error('cannot address the document root here');
  let node = doc;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (Array.isArray(node)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.length)
        throw new Error(`array index "${seg}" out of bounds`);
      node = node[idx];
    } else if (isRecord(node)) {
      if (!(seg in node)) throw new Error(`path segment "${seg}" not found`);
      node = node[seg];
    } else {
      throw new Error(`cannot descend into primitive at "${seg}"`);
    }
  }
  return { parent: node, key: segments[segments.length - 1]! };
}

function getAt(doc: unknown, segments: string[]): unknown {
  if (segments.length === 0) return doc;
  const { parent, key } = resolveParent(doc, segments);
  if (Array.isArray(parent)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length)
      throw new Error(`array index "${key}" out of bounds`);
    return parent[idx];
  }
  if (isRecord(parent)) {
    if (!(key in parent)) throw new Error(`key "${key}" not found`);
    return parent[key];
  }
  throw new Error(`cannot read key "${key}" of primitive`);
}

function addAt(doc: unknown, segments: string[], value: unknown): unknown {
  if (segments.length === 0) return value;
  const { parent, key } = resolveParent(doc, segments);
  if (Array.isArray(parent)) {
    if (key === '-') {
      parent.push(value);
      return doc;
    }
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx > parent.length)
      throw new Error(`array index "${key}" out of bounds for add`);
    parent.splice(idx, 0, value);
    return doc;
  }
  if (isRecord(parent)) {
    parent[key] = value;
    return doc;
  }
  throw new Error(`cannot add key "${key}" to primitive`);
}

function removeAt(doc: unknown, segments: string[]): { doc: unknown; removed: unknown } {
  if (segments.length === 0) throw new Error('cannot remove the document root');
  const { parent, key } = resolveParent(doc, segments);
  if (Array.isArray(parent)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length)
      throw new Error(`array index "${key}" out of bounds for remove`);
    const [removed] = parent.splice(idx, 1);
    return { doc, removed };
  }
  if (isRecord(parent)) {
    if (!(key in parent)) throw new Error(`key "${key}" not found for remove`);
    const removed = parent[key];
    delete parent[key];
    return { doc, removed };
  }
  throw new Error(`cannot remove key "${key}" from primitive`);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Applies a JSON Patch to `document` and returns a new document.
 * The input is never mutated; a PatchError leaves it untouched.
 */
export function applyPatch<T>(document: T, operations: PatchOperation[]): T {
  let doc: unknown = clone(document);

  operations.forEach((op, index) => {
    try {
      const path = parsePointer(op.path);
      switch (op.op) {
        case 'add':
          doc = addAt(doc, path, clone(op.value));
          break;
        case 'replace': {
          if (path.length === 0) {
            doc = clone(op.value);
            break;
          }
          getAt(doc, path); // must exist per RFC 6902
          const removed = removeAt(doc, path);
          doc = addAt(removed.doc, path, clone(op.value));
          break;
        }
        case 'remove':
          doc = removeAt(doc, path).doc;
          break;
        case 'move': {
          if (op.from === undefined) throw new Error('"move" requires "from"');
          const from = parsePointer(op.from);
          if (op.from !== op.path && op.path.startsWith(op.from + '/'))
            throw new Error('cannot move a node into its own child');
          const { doc: next, removed } = removeAt(doc, from);
          doc = addAt(next, path, removed);
          break;
        }
        case 'copy': {
          if (op.from === undefined) throw new Error('"copy" requires "from"');
          const value = getAt(doc, parsePointer(op.from));
          doc = addAt(doc, path, clone(value));
          break;
        }
        case 'test': {
          const actual = getAt(doc, path);
          if (!deepEqual(actual, op.value)) throw new Error(`"test" failed at ${op.path}`);
          break;
        }
        default:
          throw new Error(`unsupported op "${String(op.op)}"`);
      }
    } catch (err) {
      throw new PatchError(err instanceof Error ? err.message : String(err), op, index);
    }
  });

  return doc as T;
}
