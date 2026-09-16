/** Downscale an uploaded image to a square-cropped avatar data URL — small
 *  enough to store inline (well under the contract's avatar cap). */
export async function fileToAvatarDataUrl(file: File, edge = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    // Centre-crop to a square, then draw to an edge×edge canvas.
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = edge;
    canvas.height = edge;
    canvas.getContext('2d')!.drawImage(img, sx, sy, side, side, 0, 0, edge, edge);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
