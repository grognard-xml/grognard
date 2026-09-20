import {
  getDraggedImageDataUrl,
  getDraggedImageUrl,
  getDroppedImageFile,
  hasUnreadableDraggedImage,
} from './clipboardImage';

/** A minimal DataTransfer-shaped fake - jsdom doesn't implement DataTransfer
 * fully enough to construct a real one with files/data pre-populated. */
const makeDataTransfer = (options: {
  files?: File[];
  html?: string;
  uriList?: string;
}): DataTransfer => {
  const data: Record<string, string> = {};
  if (options.html) data['text/html'] = options.html;
  if (options.uriList) data['text/uri-list'] = options.uriList;
  return {
    files: options.files ?? [],
    types: Object.keys(data),
    getData: (format: string) => data[format] ?? '',
  } as unknown as DataTransfer;
};

describe('getDroppedImageFile', () => {
  it('matches a file with a proper image MIME type', () => {
    const file = new File(['x'], 'char.png', { type: 'image/png' });
    const dt = makeDataTransfer({ files: [file] });
    expect(getDroppedImageFile(dt)).toBe(file);
  });

  it('falls back to the file extension when no MIME type is set', () => {
    const file = new File(['x'], 'char.png', { type: '' });
    const dt = makeDataTransfer({ files: [file] });
    expect(getDroppedImageFile(dt)).toBe(file);
  });

  it('ignores a non-image file even without a MIME type', () => {
    const file = new File(['x'], 'notes.txt', { type: '' });
    const dt = makeDataTransfer({ files: [file] });
    expect(getDroppedImageFile(dt)).toBeNull();
  });
});

describe('getDraggedImageDataUrl', () => {
  it('extracts a data: image src from the dragged HTML', () => {
    const dt = makeDataTransfer({
      html: '<img src="data:image/png;base64,AAAA" />',
    });
    expect(getDraggedImageDataUrl(dt)).toBe('data:image/png;base64,AAAA');
  });

  it('returns null when the src is not a data: URI', () => {
    const dt = makeDataTransfer({ html: '<img src="https://example.com/a.png" />' });
    expect(getDraggedImageDataUrl(dt)).toBeNull();
  });
});

describe('getDraggedImageUrl', () => {
  it('accepts an http(s) URL from the dragged HTML', () => {
    const dt = makeDataTransfer({ html: '<img src="https://example.com/a.png" />' });
    expect(getDraggedImageUrl(dt)).toBe('https://example.com/a.png');
  });

  it('rejects a local file:// src (no IPC can read it as a remote fetch)', () => {
    const dt = makeDataTransfer({ html: '<img src="file:///Users/me/a.png" />' });
    expect(getDraggedImageUrl(dt)).toBeNull();
  });
});

describe('hasUnreadableDraggedImage', () => {
  it('is true for an <img> whose src none of the readable helpers can resolve', () => {
    const dt = makeDataTransfer({ html: '<img src="file:///Users/me/a.png" />' });
    expect(getDroppedImageFile(dt)).toBeNull();
    expect(getDraggedImageDataUrl(dt)).toBeNull();
    expect(getDraggedImageUrl(dt)).toBeNull();
    expect(hasUnreadableDraggedImage(dt)).toBe(true);
  });

  it('is false when there is no <img> at all', () => {
    const dt = makeDataTransfer({ html: '<p>just text</p>' });
    expect(hasUnreadableDraggedImage(dt)).toBe(false);
  });
});
