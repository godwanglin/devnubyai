import sharp from "sharp";

export type ImageAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export interface ImagePostProcessOptions {
  aspectRatio?: ImageAspectRatio;
  resolution?: string; // e.g. "1024x1024", "1280x720", "720x1280"
  transparentBackground?: boolean;
}

export interface ProcessedImageResult {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

const ASPECT_RATIO_DIMENSIONS: Record<ImageAspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1344, height: 768 },
  "9:16": { width: 768, height: 1344 },
  "4:3": { width: 1152, height: 864 },
  "3:4": { width: 864, height: 1152 },
};

function parseResolution(resStr?: string): { width: number; height: number } | null {
  if (!resStr) return null;
  const match = resStr.trim().match(/^(\d{2,4})[xX*](\d{2,4})$/);
  if (!match) return null;
  const width = Math.min(Math.max(parseInt(match[1], 10), 128), 2048);
  const height = Math.min(Math.max(parseInt(match[2], 10), 128), 2048);
  return { width, height };
}

/**
 * Chroma key / corner color difference background removal.
 * Analyzes the 4 image corners to determine the dominant solid background color,
 * then maps matching outer pixels to transparent alpha while keeping the subject intact.
 */
async function removeBackgroundViaSharp(input: Buffer): Promise<Buffer> {
  const image = sharp(input);
  const metadata = await image.metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;

  const raw = await image.ensureAlpha().raw().toBuffer();
  // Pixel count = width * height, 4 channels: R, G, B, A

  // Sample corner colors (top-left, top-right, bottom-left, bottom-right)
  const cornerCoords = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
  ];

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (const [cx, cy] of cornerCoords) {
    const idx = (cy * width + cx) * 4;
    sumR += raw[idx];
    sumG += raw[idx + 1];
    sumB += raw[idx + 2];
  }
  const bgR = Math.round(sumR / cornerCoords.length);
  const bgG = Math.round(sumG / cornerCoords.length);
  const bgB = Math.round(sumB / cornerCoords.length);

  // Euclidean color distance threshold
  const tolerance = 42; // distance in RGB space
  const feather = 18; // soft edge falloff

  // Flood fill / boundary-aware mask: start scanning from outer edges towards center
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];

  // Seed boundary pixels
  for (let x = 0; x < width; x++) {
    queue.push(x); // top edge
    queue.push((height - 1) * width + x); // bottom edge
  }
  for (let y = 0; y < height; y++) {
    queue.push(y * width); // left edge
    queue.push(y * width + (width - 1)); // right edge
  }

  while (queue.length > 0) {
    const p = queue.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;

    const idx = p * 4;
    const r = raw[idx];
    const g = raw[idx + 1];
    const b = raw[idx + 2];

    const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);

    if (dist <= tolerance + feather) {
      // Calculate alpha falloff
      if (dist <= tolerance) {
        raw[idx + 3] = 0; // Fully transparent
      } else {
        const factor = (dist - tolerance) / feather;
        raw[idx + 3] = Math.min(raw[idx + 3], Math.round(factor * 255));
      }

      // Propagate to 4 neighbors if background-like
      const px = p % width;
      const py = Math.floor(p / width);

      if (px > 0 && !visited[p - 1]) queue.push(p - 1);
      if (px < width - 1 && !visited[p + 1]) queue.push(p + 1);
      if (py > 0 && !visited[p - width]) queue.push(p - width);
      if (py < height - 1 && !visited[p + width]) queue.push(p + width);
    }
  }

  return sharp(raw, {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel: 8 })
    .toBuffer();
}

/**
 * Standard post-processor:
 * 1. Resizes according to requested aspect ratio or exact resolution.
 * 2. Applies background removal if requested (yielding transparent PNG).
 * 3. Returns final buffer, dimensions, and mimeType.
 */
export async function postProcessGeneratedImage(
  inputBuffer: Buffer,
  options: ImagePostProcessOptions = {}
): Promise<ProcessedImageResult> {
  let targetDim: { width: number; height: number } | null = parseResolution(options.resolution);

  if (!targetDim && options.aspectRatio && ASPECT_RATIO_DIMENSIONS[options.aspectRatio]) {
    targetDim = ASPECT_RATIO_DIMENSIONS[options.aspectRatio];
  }

  let pipeline = sharp(inputBuffer);
  const metadata = await pipeline.metadata();

  if (targetDim) {
    pipeline = pipeline.resize(targetDim.width, targetDim.height, {
      fit: "cover",
      position: "center",
    });
  }

  let finalBuffer: Buffer = await pipeline.toBuffer();
  let mimeType: "image/png" | "image/jpeg" = "image/jpeg";

  if (options.transparentBackground) {
    finalBuffer = await removeBackgroundViaSharp(finalBuffer);
    mimeType = "image/png";
  } else {
    // Standard JPEG output optimization
    finalBuffer = await sharp(finalBuffer).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  }

  const finalMeta = await sharp(finalBuffer).metadata();
  return {
    buffer: finalBuffer,
    mimeType,
    width: finalMeta.width || metadata.width || 1024,
    height: finalMeta.height || metadata.height || 1024,
  };
}
