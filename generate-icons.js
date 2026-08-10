// Генератор PNG-иконок расширения (без внешних зависимостей).
// Рисует синий скруглённый квадрат + белое облако со стрелкой вверх (upload).
// Запуск: node generate-icons.js  → создаёт icons/icon16.png, icon48.png, icon128.png
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const BLUE = [0x00, 0x77, 0xff];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = 0 (deflate, adaptive, no interlace)
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// мягкое сглаживание границ через супер-сэмплинг
function sample(test, x, y, S) {
  let hits = 0;
  for (let sy = 0; sy < S; sy++)
    for (let sx = 0; sx < S; sx++)
      if (test(x + (sx + 0.5) / S, y + (sy + 0.5) / S)) hits++;
  return hits / (S * S);
}

function makeIcon(N) {
  const u = N / 100; // единица относительно размера
  const r = 22 * u; // радиус скругления фона
  const inRoundRect = (x, y) => {
    const min = 0, max = N;
    const cx = Math.min(Math.max(x, min + r), max - r);
    const cy = Math.min(Math.max(y, min + r), max - r);
    if (x >= min + r && x <= max - r) return y >= min && y <= max;
    if (y >= min + r && y <= max - r) return x >= min && x <= max;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };

  // Облако: объединение кругов + базовый прямоугольник
  const circles = [
    [38 * u, 64 * u, 16 * u],
    [60 * u, 60 * u, 20 * u],
    [76 * u, 66 * u, 14 * u],
  ];
  const cloudBase = [26 * u, 64 * u, 78 * u, 80 * u]; // x1,y1,x2,y2
  const inCloud = (x, y) => {
    for (const [cx, cy, cr] of circles)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= cr * cr) return true;
    if (x >= cloudBase[0] && x <= cloudBase[2] && y >= cloudBase[1] && y <= cloudBase[3])
      return true;
    return false;
  };

  // Стрелка вверх (стебель + наконечник) по центру облака
  const stemW = 8 * u, stemTop = 34 * u, stemBot = 72 * u, midX = 52 * u;
  const headTop = 30 * u, headHalf = 14 * u, headBot = 48 * u;
  const inArrow = (x, y) => {
    if (Math.abs(x - midX) <= stemW / 2 && y >= stemTop && y <= stemBot) return true;
    if (y >= headTop && y <= headBot) {
      const t = (y - headTop) / (headBot - headTop); // 0..1
      const half = headHalf * (1 - t);
      if (Math.abs(x - midX) <= half) return true;
    }
    return false;
  };

  const data = Buffer.alloc(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const bgA = sample(inRoundRect, x, y, 4);
      if (bgA <= 0) { data[i + 3] = 0; continue; }
      // стрелка имеет приоритет (вырез белым), затем облако
      const arrowA = sample(inArrow, x, y, 4);
      const cloudA = Math.max(arrowA, sample(inCloud, x, y, 4));
      const fg = cloudA;
      const R = BLUE[0] * (1 - fg) + WHITE[0] * fg;
      const G = BLUE[1] * (1 - fg) + WHITE[1] * fg;
      const B = BLUE[2] * (1 - fg) + WHITE[2] * fg;
      data[i] = R; data[i + 1] = G; data[i + 2] = B;
      data[i + 3] = Math.round(bgA * 255);
    }
  }
  return encodePNG(N, N, data);
}

const outDir = path.join(__dirname, "icons");
for (const N of [16, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${N}.png`), makeIcon(N));
  console.log(`icon${N}.png`);
}
