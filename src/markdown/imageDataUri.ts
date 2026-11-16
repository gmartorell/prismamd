export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function estimateBase64Bytes(base64Payload: string): number {
  const clean = /\s/.test(base64Payload) ? base64Payload.replace(/\s+/g, '') : base64Payload;
  if (clean.length === 0) return 0;
  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function sanitizeImageAlt(filename: string | undefined, fallback = 'imagen'): string {
  if (!filename) return fallback;
  const base = filename
    .replace(/\.[^.\\/]+$/, '')
    .replace(/[\[\]()\r\n]/g, ' ')
    .trim()
    .replace(/(?:\\+\s*)+$/, '')
    .trim();
  return base || fallback;
}

export async function fileToDataUri(file: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Expected Data URI string from FileReader'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
  }

  const buffer = await file.arrayBuffer();
  const mime = file.type || 'image/png';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return `data:${mime};base64,${base64}`;
}

export async function fileToMarkdownImage(
  file: File,
  fallbackAlt = 'imagen',
): Promise<{
  alt: string;
  dataUri: string;
  markdown: string;
}> {
  const alt = sanitizeImageAlt(file.name, fallbackAlt);
  const dataUri = await fileToDataUri(file);
  return {
    alt,
    dataUri,
    markdown: `![${alt}](${dataUri})`,
  };
}
