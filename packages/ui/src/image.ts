/** Downscale a picked photo before it becomes a stored data URL.
 *  Longest edge capped, JPEG on a white ground (transparency would
 *  turn black), so a phone photo lands well under the contract's
 *  per-photo character cap. Returns null when the file cannot be
 *  decoded as an image. */
export async function fileToResizedDataURL(
  file: File,
  maxEdge = 1600,
  quality = 0.82,
): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('undecodable image'));
      i.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height, 1));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
