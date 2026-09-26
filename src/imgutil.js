// Downscale an image File to fit within `max` px (longest side) via canvas, so
// uploads stay small. Returns a JPEG File; falls back to the original on error.
export function downscaleImage(file, max = 640) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => resolve(blob ? new File([blob], 'group.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

// Warm the browser cache for a set of remote image URLs so they're already fetched/decoded
// by the time views insert them (covers, tiles, avatars otherwise pop in late). Best-effort
// and fire-and-forget: dedupes, skips falsy/data: URLs, and swallows failures (a stale or
// offline URL just falls back to the normal lazy fetch when the markup renders).
const preloaded = new Set();
export function preloadImages(urls) {
  for (const url of urls) {
    if (!url || url.startsWith('data:') || preloaded.has(url)) continue;
    preloaded.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}
