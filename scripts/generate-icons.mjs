import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderIconRgba(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size * 0.22;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      const dx = Math.max(0, Math.abs(x - cx) - (size / 2 - radius));
      const dy = Math.max(0, Math.abs(y - cy) - (size / 2 - radius));
      const cornerDist = Math.hypot(dx, dy);

      if (cornerDist > radius + 0.5) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      // Background gradient (#0f172a -> #1e3a8a)
      const t = (x + y) / (2 * size);
      let r = Math.round(15 + t * 18);
      let g = Math.round(23 + t * 35);
      let b = Math.round(42 + t * 80);
      let a = 255;

      if (cornerDist > radius - 0.5) {
        a = Math.round(255 * Math.max(0, radius + 0.5 - cornerDist));
      }

      // Draw crisp inner diamond prism mark
      const nx = (x - cx) / (size * 0.32);
      const ny = (y - cy) / (size * 0.32);
      const manhattan = Math.abs(nx) + Math.abs(ny);

      if (manhattan <= 1.0) {
        if (manhattan > 0.72) {
          r = 96;
          g = 165;
          b = 250;
        } else if (nx < 0) {
          r = 56;
          g = 189;
          b = 248;
        } else {
          r = 224;
          g = 242;
          b = 254;
        }
      }

      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = a;
    }
  }
  return buf;
}

const SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e3a8a"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg)"/>
  <polygon points="64,20 108,64 64,108 20,64" fill="#60a5fa"/>
  <polygon points="64,31 64,97 31,64" fill="#38bdf8"/>
  <polygon points="64,31 97,64 64,97" fill="#e0f2fe"/>
</svg>
`;

export function generateIcons(targetDir, sizes) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'icon.svg'), SVG_ICON, 'utf8');
  for (const size of sizes) {
    const rgba = renderIconRgba(size);
    const png = encodePng(size, size, rgba);
    fs.writeFileSync(path.join(targetDir, `icon-${size}.png`), png);
  }
}
