import Jimp from 'jimp';
import potrace, { type PotraceOptions } from 'potrace';

// jimp@0.14's types export a single pre-3.1-style interface (`export =`)
// that isn't itself usable as a type name once imported as a default value;
// deriving it from `read`'s return type is the safe way to name it.
type JimpImage = Awaited<ReturnType<typeof Jimp.read>>;

export interface VectorizeGlyphOptions {
  /** Override auto-thresholding (0-255). Otsu's method is used when omitted. */
  threshold?: number;
  /** Ink components smaller than this many pixels are dropped as noise. */
  minBlobPixels?: number;
  /** Optical margin (px, in the source image's own resolution) kept around the ink. */
  marginPixels?: number;
}

export interface VectorizeGlyphResult {
  svg: string;
  threshold: number;
  width: number;
  height: number;
}

const DEFAULT_MIN_BLOB_PIXELS = 6;
const DEFAULT_MARGIN_PIXELS = 4;

function traceToSvg(image: Buffer, opts: PotraceOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    potrace.trace(image, opts, (err, svg) => (err ? reject(err) : resolve(svg)));
  });
}

/** Pasted glyph screenshots (PDF/database cutouts) are often RGBA with a
 * transparent background rather than a real paper background - reading RGB
 * while ignoring alpha would treat every transparent pixel as solid black
 * ink. Compositing onto white first is what a real paper photo already
 * looks like anyway. */
function compositeOnWhite(image: JimpImage): JimpImage {
  const bg = new Jimp(image.bitmap.width, image.bitmap.height, 0xffffffff);
  return bg.composite(image, 0, 0);
}

/** Flatfield correction: divide by a heavily blurred copy of the image (an
 * estimate of the local background) to even out uneven lighting/paper tone
 * before thresholding. */
function flattenBackground(gray: JimpImage): JimpImage {
  const bg = gray.clone().blur(25);
  const { width, height, data } = gray.bitmap;
  const out = gray.clone();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = gray.getPixelIndex(x, y);
      const fg = data[idx];
      const bgv = bg.bitmap.data[idx] || 1;
      const v = Math.max(0, Math.min(255, (fg / bgv) * 255));
      out.bitmap.data[idx] = v;
      out.bitmap.data[idx + 1] = v;
      out.bitmap.data[idx + 2] = v;
    }
  }
  return out;
}

/** Otsu's method: the threshold that best separates two peaks (ink vs. paper). */
function otsuThreshold(gray: JimpImage): number {
  const hist = new Array(256).fill(0);
  const { data, width, height } = gray.bitmap;
  const total = width * height;
  for (let i = 0; i < data.length; i += 4) hist[data[i]]++;

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let bestVariance = -1;
  // A gap in the histogram between the ink and paper clusters (common in
  // low-color-depth/quantized screenshots) holds the between-class variance
  // constant across the whole gap, since no pixels fall inside it - tying
  // every t in that range for "best". Taking the first tied t would put the
  // threshold right on the ink cluster's own value instead of in the middle
  // of the gap, which the strict `<` in binarize() would then exclude
  // entirely. Track the tied plateau and use its midpoint instead.
  let plateauStart = 0;
  let plateauEnd = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const meanB = sumB / wB;
    const meanF = (sum - sumB) / wF;
    const variance = wB * wF * (meanB - meanF) * (meanB - meanF);
    if (variance > bestVariance) {
      bestVariance = variance;
      plateauStart = t;
      plateauEnd = t;
    } else if (variance === bestVariance) {
      plateauEnd = t;
    }
  }
  return Math.round((plateauStart + plateauEnd) / 2);
}

interface BitonalImage {
  bits: Uint8Array;
  width: number;
  height: number;
}

function binarize(gray: JimpImage, threshold: number): BitonalImage {
  const { width, height, data } = gray.bitmap;
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = gray.getPixelIndex(x, y);
      bits[y * width + x] = data[idx] < threshold ? 1 : 0;
    }
  }
  return { bits, width, height };
}

/** Connected-component despeckle: a global threshold alone can't tell a real
 * stroke from texture noise (wood grain, stone-rubbing speckle) - but noise
 * shows up as many small disconnected ink blobs, while strokes are large
 * connected runs, so dropping small components cleans the background without
 * eroding the glyph. */
function despeckle(image: BitonalImage, minBlobPixels: number): BitonalImage {
  const { bits, width, height } = image;
  const visited = new Uint8Array(width * height);
  const out = new Uint8Array(width * height);
  const stack: number[] = [];

  for (let start = 0; start < bits.length; start++) {
    if (!bits[start] || visited[start]) continue;
    const component = [start];
    visited[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop() as number;
      const x = p % width;
      const y = (p / width) | 0;
      const neighbors = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        y > 0 ? p - width : -1,
        y < height - 1 ? p + width : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && bits[n] && !visited[n]) {
          visited[n] = 1;
          stack.push(n);
          component.push(n);
        }
      }
    }
    if (component.length >= minBlobPixels) {
      for (const p of component) out[p] = 1;
    }
  }
  return { bits: out, width, height };
}

interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function inkBoundingBox(image: BitonalImage, marginPixels: number): BoundingBox {
  const { bits, width, height } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bits[y * width + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };
  return {
    minX: Math.max(0, minX - marginPixels),
    minY: Math.max(0, minY - marginPixels),
    maxX: Math.min(width - 1, maxX + marginPixels),
    maxY: Math.min(height - 1, maxY + marginPixels),
  };
}

function cropToJimp(image: BitonalImage, box: BoundingBox): JimpImage {
  const w = box.maxX - box.minX + 1;
  const h = box.maxY - box.minY + 1;
  const out = new Jimp(w, h, 0xffffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ink = image.bits[(y + box.minY) * image.width + (x + box.minX)];
      if (ink) out.setPixelColor(0x000000ff, x, y);
    }
  }
  return out;
}

/**
 * Turns a pasted raster (a screenshot of a non-standard character, often
 * with an ugly photographed-paper or database-cutout background) into a
 * clean, cropped, `currentColor`-filled SVG glyph: composite-on-white ->
 * grayscale -> flatfield -> threshold -> despeckle -> crop-to-ink -> trace.
 */
export async function vectorizeGlyphImage(
  bytes: Uint8Array,
  options: VectorizeGlyphOptions = {},
): Promise<VectorizeGlyphResult> {
  const minBlobPixels = options.minBlobPixels ?? DEFAULT_MIN_BLOB_PIXELS;
  const marginPixels = options.marginPixels ?? DEFAULT_MARGIN_PIXELS;

  const original = await Jimp.read(Buffer.from(bytes));
  const onWhite = compositeOnWhite(original.clone());
  const gray = onWhite.grayscale();
  const flattened = flattenBackground(gray);
  const threshold = options.threshold ?? otsuThreshold(flattened);

  const rawBin = binarize(flattened, threshold);
  const cleanBin = despeckle(rawBin, minBlobPixels);
  const box = inkBoundingBox(cleanBin, marginPixels);
  const cropped = cropToJimp(cleanBin, box);

  const svg = await traceToSvg(await cropped.getBufferAsync(Jimp.MIME_PNG), {
    threshold: 128,
    color: 'currentColor',
    background: 'transparent',
    optCurve: true,
  });

  return {
    svg,
    threshold,
    width: box.maxX - box.minX + 1,
    height: box.maxY - box.minY + 1,
  };
}
