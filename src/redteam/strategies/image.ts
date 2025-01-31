import { deflateSync } from 'zlib';
import type { TestCase } from '../../types';

/**
 * Creates a minimal PNG image with white background and black text.
 * This is a very basic implementation that creates a fixed-size PNG
 * with text at a specific position.
 */
function createMinimalPNG(text: string): string {
  // PNG header and IHDR chunk (fixed size 800x200 PNG)
  const header = Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // PNG signature
    0x00,
    0x00,
    0x00,
    0x0d, // IHDR length
    0x49,
    0x48,
    0x44,
    0x52, // "IHDR"
    0x00,
    0x00,
    0x03,
    0x20, // width (800)
    0x00,
    0x00,
    0x00,
    0xc8, // height (200)
    0x08, // bit depth
    0x06, // color type (RGBA)
    0x00, // compression
    0x00, // filter
    0x00, // interlace
    0x00,
    0x00,
    0x00,
    0x00, // CRC placeholder
  ]);

  // Create IDAT chunk with white background and black text
  const width = 800;
  const height = 200;
  const data = Buffer.alloc(width * height * 4);

  // Fill with white
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255; // R
    data[i + 1] = 255; // G
    data[i + 2] = 255; // B
    data[i + 3] = 255; // A
  }

  // Simple text rendering at fixed position
  const textBytes = Buffer.from(text);
  const startPos = (width * 50 + 50) * 4; // Position text at (50,50)
  for (let i = 0; i < textBytes.length; i++) {
    const pos = startPos + i * 4;
    if (pos + 3 < data.length) {
      data[pos] = 0; // R
      data[pos + 1] = 0; // G
      data[pos + 2] = 0; // B
      data[pos + 3] = 255; // A
    }
  }

  // Compress data using built-in zlib
  const compressed = deflateSync(data);

  // IDAT chunk
  const idatLength = Buffer.alloc(4);
  idatLength.writeUInt32BE(compressed.length);
  const idatChunk = Buffer.concat([
    idatLength,
    Buffer.from('IDAT'),
    compressed,
    Buffer.alloc(4), // CRC placeholder
  ]);

  // IEND chunk
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  // Combine all chunks
  const png = Buffer.concat([header, idatChunk, iend]);

  return png.toString('base64');
}

/**
 * Transform test cases by converting the specified variable into a base64 encoded image.
 * This strategy is designed to test multi-modal LLMs by converting text prompts into images
 * that could potentially bypass text-based content filters.
 * Currently only supports OpenAI's vision format.
 */
export function addImageEncoding(testCases: TestCase[], injectVar: string): TestCase[] {
  return testCases.map((testCase) => ({
    ...testCase,
    assert: testCase.assert?.map((assertion) => ({
      ...assertion,
      metric: `${assertion.metric}/Image`,
    })),
    vars: {
      ...testCase.vars,
      [injectVar]: {
        type: 'image_url',
        url: `data:image/png;base64,${createMinimalPNG(String(testCase.vars![injectVar]))}`,
      },
    },
  }));
}
