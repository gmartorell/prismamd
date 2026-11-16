import { describe, expect, it } from 'vitest';
import { findBase64DataUriRanges } from '../src/editors/raw/base64FoldExtension';
import { formatByteSize } from '../src/markdown/imageDataUri';

describe('Raw Base64 Data URI folding detector', () => {
  it('detects long data:image base64 payloads without crossing lines', () => {
    const longPayload = 'A'.repeat(240);
    const line = `![captura](data:image/png;base64,${longPayload}) y texto normal`;
    const matches = findBase64DataUriRanges(line, 100);

    expect(matches).toHaveLength(1);
    expect(matches[0].mime).toBe('png');
    expect(matches[0].from).toBe(100 + line.indexOf('data:image/'));
    expect(matches[0].to).toBe(100 + line.indexOf(')'));
    expect(matches[0].approxBytes).toBe(180);
  });

  it('ignores short base64 snippets and normal HTTPS URLs', () => {
    const line = '![logo](https://example.com/logo.png) and ![tiny](data:image/png;base64,AAAA)';
    const matches = findBase64DataUriRanges(line, 0);
    expect(matches).toHaveLength(0);
  });

  it('formats byte sizes cleanly', () => {
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(2048)).toBe('2 KB');
    expect(formatByteSize(1572864)).toBe('1.5 MB');
  });
});
