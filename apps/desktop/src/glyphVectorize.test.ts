import Jimp from 'jimp';

import { vectorizeGlyphImage } from './glyphVectorize';

// Build a tiny synthetic "photo": a black square (the "ink") on a paper
// background, with scattered single-pixel salt-and-pepper noise standing in
// for wood-grain/rubbing texture, plus a transparent margin standing in for
// a screenshot's cutout background (RGBA, alpha 0 outside the paper area).
async function buildNoisySample(): Promise<Buffer> {
  const size = 40;
  const image = new Jimp(size, size, 0x00000000); // fully transparent
  for (let y = 4; y < size - 4; y++) {
    for (let x = 4; x < size - 4; x++) {
      image.setPixelColor(0xf0e6d2ff, x, y); // aged-paper background
    }
  }
  for (let y = 14; y < 26; y++) {
    for (let x = 14; x < 26; x++) {
      image.setPixelColor(0x1a1208ff, x, y); // the "ink"
    }
  }
  // Speckle noise: isolated single dark pixels scattered across the paper,
  // never touching the ink block, mimicking texture noise.
  const specklePositions: [number, number][] = [
    [5, 5],
    [34, 5],
    [5, 34],
    [34, 34],
    [8, 30],
    [30, 8],
  ];
  for (const [x, y] of specklePositions) {
    image.setPixelColor(0x101010ff, x, y);
  }
  return image.getBufferAsync(Jimp.MIME_PNG);
}

describe('vectorizeGlyphImage', () => {
  it('produces a currentColor-filled, transparent-background SVG', async () => {
    const bytes = new Uint8Array(await buildNoisySample());
    const result = await vectorizeGlyphImage(bytes);

    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('fill="currentColor"');
    expect(result.svg).not.toContain('<rect'); // no opaque background rect
  });

  it('crops tighter than the source image by finding the ink bounding box', async () => {
    const bytes = new Uint8Array(await buildNoisySample());
    const result = await vectorizeGlyphImage(bytes);

    expect(result.width).toBeLessThan(40);
    expect(result.height).toBeLessThan(40);
  });

  it('despeckles isolated noise without erasing the real ink block', async () => {
    const bytes = new Uint8Array(await buildNoisySample());

    // A near-zero despeckle floor keeps every single-pixel speckle as its
    // own "component", inflating the crop out toward the noise positions.
    const withoutDespeckle = await vectorizeGlyphImage(bytes, { minBlobPixels: 1 });
    // A realistic floor drops single-pixel noise but keeps the 12x12 block.
    const withDespeckle = await vectorizeGlyphImage(bytes, { minBlobPixels: 6 });

    expect(withDespeckle.width).toBeLessThan(withoutDespeckle.width);
    expect(withDespeckle.height).toBeLessThan(withoutDespeckle.height);
    // The real ink block (12x12 plus the 4px margin on each side) must survive.
    expect(withDespeckle.width).toBeGreaterThanOrEqual(12);
    expect(withDespeckle.height).toBeGreaterThanOrEqual(12);
  });
});
