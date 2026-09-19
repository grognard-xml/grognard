export const getClipboardImageFile = (clipboard: DataTransfer): File | null => {
  for (const item of Array.from(clipboard.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }
  return null;
};

export const getDroppedImageFile = (dataTransfer: DataTransfer): File | null => {
  for (const file of Array.from(dataTransfer.files)) {
    if (file.type.startsWith('image/')) return file;
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
