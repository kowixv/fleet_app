import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { VEHICLE_THUMBNAIL_ARTWORK_CONFIGS, type VehicleArtworkConfig } from "./vehicle-thumbnail-asset-config";

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: 4;
}

async function main() {
  const missing = VEHICLE_THUMBNAIL_ARTWORK_CONFIGS
    .filter((config) => !existsSync(config.sourcePath))
    .map((config) => config.sourcePath);
  if (missing.length > 0) {
    throw new Error(`Missing vehicle thumbnail source image(s):\n${missing.join("\n")}`);
  }

  await fs.mkdir(path.dirname(VEHICLE_THUMBNAIL_ARTWORK_CONFIGS[0].outputBasePath), { recursive: true });

  for (const config of VEHICLE_THUMBNAIL_ARTWORK_CONFIGS) {
    const result = await buildAsset(config);
    console.log(`${config.key}: ${result.width}x${result.height}, mask ${(result.coverage * 100).toFixed(1)}%`);
  }
}

async function buildAsset(config: VehicleArtworkConfig) {
  const metadata = await sharp(config.sourcePath).metadata();
  if (metadata.format !== "png") {
    throw new Error(`${config.key} source must be PNG; got ${metadata.format ?? "unknown"}`);
  }
  if (!metadata.width || !metadata.height) {
    throw new Error(`${config.key} source is missing dimensions`);
  }
  if (
    metadata.width < config.minWidth
    || metadata.height < config.minHeight
    || metadata.width > config.maxWidth
    || metadata.height > config.maxHeight
  ) {
    throw new Error(`${config.key} source dimensions ${metadata.width}x${metadata.height} are outside expected bounds`);
  }

  const source = sharp(config.sourcePath)
    .rotate()
    .resize({ width: config.resizeWidth, withoutEnlargement: true })
    .ensureAlpha();
  const raw = await toRawImage(source);
  if (raw.data.length === 0) throw new Error(`${config.key} source pixel data is empty`);

  const hardMask = createBluePaintMask(raw, config);
  const softMask = await softenMask(hardMask, raw.width, raw.height, config);
  const coverage = averageMask(softMask) / 255;
  if (coverage < config.minCoverage || coverage > config.maxCoverage) {
    throw new Error(`${config.key} mask coverage ${(coverage * 100).toFixed(1)}% is outside expected bounds`);
  }
  assertProtectedSamples(config, softMask, raw.width, raw.height);

  await writeNeutralBase(raw, softMask, config.outputBasePath);
  await writeMaskPng(softMask, raw.width, raw.height, config.outputMaskPath);
  await source.webp({ quality: 86, effort: 6 }).toFile(config.outputPreviewPath);

  return { width: raw.width, height: raw.height, coverage };
}

async function toRawImage(source: Sharp): Promise<RawImage> {
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`Expected RGBA pixel data, got ${info.channels} channels`);
  return {
    data,
    width: info.width,
    height: info.height,
    channels: 4,
  };
}

function createBluePaintMask(raw: RawImage, config: VehicleArtworkConfig): Buffer {
  const mask = Buffer.alloc(raw.width * raw.height);
  const [hueMin, hueMax] = config.hueRange;

  for (let index = 0; index < raw.width * raw.height; index += 1) {
    const offset = index * raw.channels;
    const r = raw.data[offset] ?? 0;
    const g = raw.data[offset + 1] ?? 0;
    const b = raw.data[offset + 2] ?? 0;
    const alpha = raw.data[offset + 3] ?? 255;
    const hsv = rgbToHsv(r, g, b);
    const selected =
      alpha > 16
      && hsv.h >= hueMin
      && hsv.h <= hueMax
      && hsv.s >= config.minimumSaturation
      && hsv.v >= config.minimumValue
      && !isExcluded(index, raw.width, raw.height, config);
    mask[index] = selected ? 255 : 0;
  }

  return mask;
}

function isExcluded(index: number, width: number, height: number, config: VehicleArtworkConfig): boolean {
  if (!config.excludeRects?.length) return false;
  const x = index % width;
  const y = Math.floor(index / width);

  return config.excludeRects.some((rect) => {
    const left = rect.leftRatio * width;
    const top = rect.topRatio * height;
    const right = left + rect.widthRatio * width;
    const bottom = top + rect.heightRatio * height;
    return x >= left && x <= right && y >= top && y <= bottom;
  });
}

async function softenMask(mask: Buffer, width: number, height: number, config: VehicleArtworkConfig): Promise<Buffer> {
  let pipeline = sharp(mask, { raw: { width, height, channels: 1 } });
  if (config.maskExpandPixels > 0) pipeline = pipeline.dilate(config.maskExpandPixels);
  if (config.maskBlurRadius > 0) pipeline = pipeline.blur(config.maskBlurRadius);
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  if (info.channels === 1) return data;

  const singleChannel = Buffer.alloc(width * height);
  for (let index = 0; index < width * height; index += 1) {
    singleChannel[index] = data[index * info.channels] ?? 0;
  }
  return singleChannel;
}

async function writeNeutralBase(raw: RawImage, mask: Buffer, outputPath: string) {
  const output = Buffer.alloc(raw.data.length);
  for (let index = 0; index < raw.width * raw.height; index += 1) {
    const offset = index * raw.channels;
    const r = raw.data[offset] ?? 0;
    const g = raw.data[offset + 1] ?? 0;
    const b = raw.data[offset + 2] ?? 0;
    const alpha = raw.data[offset + 3] ?? 255;
    const maskAlpha = (mask[index] ?? 0) / 255;
    const gray = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

    output[offset] = blendChannel(r, gray, maskAlpha);
    output[offset + 1] = blendChannel(g, gray, maskAlpha);
    output[offset + 2] = blendChannel(b, gray, maskAlpha);
    output[offset + 3] = alpha;
  }

  await sharp(output, { raw: { width: raw.width, height: raw.height, channels: raw.channels } })
    .webp({ quality: 88, effort: 6 })
    .toFile(outputPath);
}

async function writeMaskPng(mask: Buffer, width: number, height: number, outputPath: string) {
  const output = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    output[offset] = 255;
    output[offset + 1] = 255;
    output[offset + 2] = 255;
    output[offset + 3] = mask[index] ?? 0;
  }
  await sharp(output, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

function assertProtectedSamples(config: VehicleArtworkConfig, mask: Buffer, width: number, height: number) {
  for (const sample of config.protectedSamples) {
    const x = Math.min(width - 1, Math.max(0, Math.round(sample.xRatio * width)));
    const y = Math.min(height - 1, Math.max(0, Math.round(sample.yRatio * height)));
    const value = mask[y * width + x] ?? 0;
    if (value > sample.maxMaskValue) {
      throw new Error(`${config.key} mask selected protected ${sample.label} sample (${value} > ${sample.maxMaskValue})`);
    }
  }
}

function averageMask(mask: Buffer): number {
  let sum = 0;
  for (const value of mask) sum += value;
  return sum / mask.length;
}

function blendChannel(original: number, target: number, alpha: number): number {
  return Math.round(original * (1 - alpha) + target * alpha);
}

function rgbToHsv(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;

  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
