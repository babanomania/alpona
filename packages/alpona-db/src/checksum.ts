import { createHash } from 'node:crypto';

/** Stable content checksum — line endings normalized so git settings don't break CI. */
export function checksum(content: string): string {
  return createHash('sha256').update(content.replaceAll('\r\n', '\n')).digest('hex');
}
