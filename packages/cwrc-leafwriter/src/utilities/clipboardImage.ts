export const getClipboardImageFile = (clipboard: DataTransfer): File | null => {
  for (const item of Array.from(clipboard.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }
  return null;
};

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;

export const getDroppedImageFile = (dataTransfer: DataTransfer): File | null => {
  for (const file of Array.from(dataTransfer.files)) {
    if (file.type.startsWith('image/')) return file;
    // Some drag sources don't set a MIME type on the File at all (seen with
    // certain local-file drags depending on platform/app) - fall back to
    // the extension rather than missing a real image and letting the
    // browser's own default (unvectorized, full-size) image drop through.
    if (!file.type && IMAGE_EXTENSION_PATTERN.test(file.name)) return file;
  }
  return null;
};

/** An image dragged from a web page (not a local file) carries its remote
 * URL rather than bytes — `text/uri-list` has it directly when present;
 * otherwise fall back to the first `<img src>` in the dragged `text/html`. */
export const getDraggedImageUrl = (dataTransfer: DataTransfer): string | null => {
  const uriList = dataTransfer.getData('text/uri-list').trim();
  if (uriList && !uriList.startsWith('#')) {
    const firstUri = uriList.split('\n').map((line) => line.trim())[0];
    if (firstUri && /^https?:\/\//i.test(firstUri)) return firstUri;
  }

  const html = dataTransfer.getData('text/html');
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match && /^https?:\/\//i.test(match[1])) return match[1];

  return null;
};

/** A `data:image/...` src embedded directly in the dragged `text/html` -
 * common when the drag source is another in-app or in-page rendered image
 * rather than a real OS file or a remote URL. Self-contained (the bytes are
 * already in the string), so - unlike `getDraggedImageUrl`'s remote case -
 * no network/IPC fetch is needed to read it. */
export const getDraggedImageDataUrl = (dataTransfer: DataTransfer): string | null => {
  const html = dataTransfer.getData('text/html');
  const match = html.match(/<img[^>]+src=["'](data:image\/[^"']+)["']/i);
  return match ? match[1] : null;
};

/** Whether the dragged `text/html` carries an `<img>` at all, even one none
 * of the specific extraction helpers above can actually read (e.g. a local
 * `file://` src with no OS-provided `File` object, or an unrecognized
 * scheme). Deliberately narrower than "any file is being dragged" - a
 * non-image file drag shouldn't be treated as a failed image insert. Used
 * to decide whether to block the browser's own default drop handling and
 * show a clear failure instead of silently letting an unvectorized,
 * full-size image insert itself as a fallback. */
export const hasUnreadableDraggedImage = (dataTransfer: DataTransfer): boolean =>
  /<img[^>]+src=/i.test(dataTransfer.getData('text/html'));

export const blobToUint8Array = async (blob: Blob): Promise<Uint8Array> => {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
};

export const pickImageFile = (): Promise<File | null> =>
  new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
