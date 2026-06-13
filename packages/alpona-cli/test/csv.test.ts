import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/csv.js';

describe('parseCsv', () => {
  it('parses a simple file with header', () => {
    const { header, rows } = parseCsv('id,name\n1,Acme\n2,Globex\n');
    expect(header).toEqual(['id', 'name']);
    expect(rows).toEqual([
      ['1', 'Acme'],
      ['2', 'Globex'],
    ]);
  });

  it('handles quoted fields with commas, quotes, and newlines', () => {
    const text = 'id,name,notes\n1,"Shenzhen, Ltd","said ""hi""\nsecond line"\n';
    const { rows } = parseCsv(text);
    expect(rows).toEqual([['1', 'Shenzhen, Ltd', 'said "hi"\nsecond line']]);
  });

  it('handles CRLF line endings and trailing newline', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([['1', '2']]);
  });

  it('keeps empty fields', () => {
    const { rows } = parseCsv('a,b,c\n1,,3\n');
    expect(rows).toEqual([['1', '', '3']]);
  });
});
