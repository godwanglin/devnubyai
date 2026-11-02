import type JSZip from "jszip";
import { parseXml, type XmlElement } from "./xml";

export type ZipArchive = JSZip;

// Zip-bomb guard on the sizes declared in the central directory. JSZip only checks
// real sizes after inflating, so a header that lies about its size is not caught here.
const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

export async function loadZip(input: Uint8Array | ArrayBuffer): Promise<ZipArchive> {
  const mod = await import("jszip");
  const JSZipCtor = (mod.default ?? mod) as unknown as typeof JSZip;
  const zip = await JSZipCtor.loadAsync(input);

  const entries = Object.values(zip.files) as (JSZip.JSZipObject & {
    _data?: { uncompressedSize?: number };
  })[];
  const declaredBytes = entries.reduce((sum, e) => sum + (e._data?.uncompressedSize ?? 0), 0);
  if (entries.length > MAX_ZIP_ENTRIES || declaredBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
    throw new Error("Archive is too large to open safely.");
  }
  return zip;
}

/** Case-insensitive lookup; some producers vary the casing of part names. */
function findEntry(zip: ZipArchive, partPath: string): JSZip.JSZipObject | null {
  const direct = zip.file(partPath);
  if (direct) return direct;
  const lower = partPath.toLowerCase();
  const key = Object.keys(zip.files).find((name) => name.toLowerCase() === lower);
  return key ? zip.file(key) : null;
}

export async function readZipText(zip: ZipArchive, partPath: string): Promise<string | null> {
  const entry = findEntry(zip, partPath);
  return entry ? entry.async("string") : null;
}

export async function readZipXml(zip: ZipArchive, partPath: string): Promise<XmlElement | null> {
  const text = await readZipText(zip, partPath);
  return text === null ? null : parseXml(text);
}

export async function readZipBytes(zip: ZipArchive, partPath: string): Promise<Uint8Array | null> {
  const entry = findEntry(zip, partPath);
  return entry ? entry.async("uint8array") : null;
}

export async function readZipBase64(zip: ZipArchive, partPath: string): Promise<string | null> {
  const entry = findEntry(zip, partPath);
  return entry ? entry.async("base64") : null;
}

/** Uncompressed size when JSZip exposes it, used to skip oversized embedded media. */
export function zipEntrySize(zip: ZipArchive, partPath: string): number {
  const entry = findEntry(zip, partPath) as (JSZip.JSZipObject & {
    _data?: { uncompressedSize?: number };
  }) | null;
  return entry?._data?.uncompressedSize ?? 0;
}
