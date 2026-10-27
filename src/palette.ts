// Reads a logo's main colors in the browser, to suggest them in the design studio.

type Rgb = [number, number, number];

const toHex = ([r, g, b]: Rgb) => "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;

// Blends two colors: amount 0 keeps `a`, 1 gives `b`.
export const mix = (a: string, b: string, amount: number) => {
  const [x, y] = [fromHex(a), fromHex(b)];
  return toHex(x.map((c, i) => c + (y[i] - c) * amount) as Rgb);
};

function hsl([r, g, b]: Rgb) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

// The logo's strongest colors, most present first. Greys, white and black are left out.
export async function logoColors(src: string): Promise<string[]> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  await img.decode();
  const size = 64;
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size });
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const buckets = new Map<number, { w: number; sum: Rgb }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const rgb: Rgb = [data[i], data[i + 1], data[i + 2]];
    const { h, s, l } = hsl(rgb);
    if (s < 0.28 || l < 0.12 || l > 0.9) continue;
    const key = Math.floor(h / 15);
    const b = buckets.get(key) ?? { w: 0, sum: [0, 0, 0] };
    b.w += s;
    b.sum = b.sum.map((c, j) => c + rgb[j] * s) as Rgb;
    buckets.set(key, b);
  }
  const ranked = [...buckets.entries()].sort((a, b) => b[1].w - a[1].w);
  const picked: { hue: number; hex: string }[] = [];
  for (const [key, b] of ranked) {
    const hue = key * 15;
    if (picked.some((p) => Math.min(Math.abs(p.hue - hue), 360 - Math.abs(p.hue - hue)) < 40)) continue;
    picked.push({ hue, hex: toHex(b.sum.map((c) => c / b.w) as Rgb) });
    if (picked.length === 3) break;
  }
  return picked.map((p) => p.hex);
}
