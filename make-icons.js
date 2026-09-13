// Generates icon-180.png, icon-192.png, icon-512.png: a terracotta bowl under a
// teal drop, on warm paper. Zero dependencies (hand-rolled PNG encoder plus
// node's zlib). The art stays inside the maskable safe circle.
// Run: node make-icons.js
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// ---- minimal PNG encoder (8-bit RGBA, filter 0) ------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- drawing (coordinates are 0..1 across the icon) --------------------------
const PAPER = [0xf6, 0xf1, 0xe8], CLAY = [0xb0, 0x55, 0x3a], TEAL = [0x34, 0x76, 0x6f];

function inBowl(x, y) {
  const rimY = 0.555, rimR = 0.034, rimL = 0.19, rimRight = 0.81;
  // rim: a bar with rounded ends across the top of the bowl
  const nearest = Math.min(Math.max(x, rimL), rimRight);
  if (Math.hypot(x - nearest, y - rimY) <= rimR) return true;
  // body: the lower half of an ellipse hanging from the rim
  if (y < rimY) return false;
  const nx = (x - 0.5) / 0.275, ny = (y - rimY) / 0.235;
  return nx * nx + ny * ny <= 1;
}

function inDrop(x, y) {
  const cx = 0.5, cy = 0.365, r = 0.078, apex = 0.2;
  if (Math.hypot(x - cx, y - cy) <= r) return true;
  // the pointed top: the cone between the apex and the circle's tangent points
  const d = cy - apex, tangentY = cy - (r * r) / d;
  if (y < apex || y > tangentY) return false;
  return Math.abs(x - cx) <= (y - apex) * (r / Math.sqrt(d * d - r * r));
}

function draw(size) {
  const SS = 4, N = size * SS;
  const acc = new Float64Array(size * size * 3);
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const x = (px + 0.5) / N, y = (py + 0.5) / N;
      const c = inDrop(x, y) ? TEAL : inBowl(x, y) ? CLAY : PAPER;
      const i = (Math.floor(py / SS) * size + Math.floor(px / SS)) * 3;
      acc[i] += c[0]; acc[i + 1] += c[1]; acc[i + 2] += c[2];
    }
  }
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.round(acc[i * 3 + k] / (SS * SS));
    rgba[i * 4 + 3] = 255;
  }
  return encodePNG(size, size, rgba);
}

for (const size of [180, 192, 512]) {
  writeFileSync(`icon-${size}.png`, draw(size));
  console.log(`wrote icon-${size}.png`);
}
