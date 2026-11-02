/**
 * gRPC-web frame decoder for xAI GetGrokCreditsConfig
 * (grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig).
 * Ported from 9router wire capture. Fail-open: any malformed buffer returns null.
 */

const FIELD_CREDITS_INFO = 1;
const CREDITS_FIELD_USAGE_RATIO = 1;
const CREDITS_FIELD_RESET_TIMESTAMP = 5;
const TIMESTAMP_FIELD_SECONDS = 1;
const TIMESTAMP_FIELD_NANOS = 2;

const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_FIXED64 = 1;
const WIRE_TYPE_LENGTH_DELIMITED = 2;
const WIRE_TYPE_FIXED32 = 5;

const GRPC_WEB_TRAILER_FLAG_BIT = 0x80;
const MAX_VARINT_SHIFT_BITS = 70n;

interface FieldResult {
  wireType: number;
  value?: number;
  bytes?: Buffer;
}

function probeFrameHeader(buffer: Buffer, offset = 0): { flag: number; payloadStart: number; payloadLength: number } | null {
  if (!Buffer.isBuffer(buffer) || offset < 0 || buffer.length - offset < 5) return null;
  const flag = buffer[offset];
  if (flag !== 0x00 && flag !== 0x01 && flag !== 0x80 && flag !== 0x81) return null;
  const payloadStart = offset + 5;
  const payloadLength = buffer.readUInt32BE(offset + 1);
  if (payloadLength > buffer.length - payloadStart) return null;
  return { flag, payloadStart, payloadLength };
}

function readVarint(buffer: Buffer, offset: number): { value: number; next: number } | null {
  let result = 0n;
  let shift = 0n;
  let pos = offset;
  for (;;) {
    if (pos >= buffer.length) return null;
    const byte = buffer[pos];
    result |= BigInt(byte & 0x7f) << shift;
    pos += 1;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
    if (shift > MAX_VARINT_SHIFT_BITS) return null;
  }
  return { value: Number(result), next: pos };
}

function readLengthDelimitedField(buffer: Buffer, offset: number): { field: FieldResult; next: number } | null {
  const lengthResult = readVarint(buffer, offset);
  if (!lengthResult) return null;
  const { value: length, next: bodyStart } = lengthResult;
  if (length < 0 || bodyStart + length > buffer.length) return null;
  return {
    field: { wireType: WIRE_TYPE_LENGTH_DELIMITED, bytes: buffer.subarray(bodyStart, bodyStart + length) },
    next: bodyStart + length,
  };
}

function readField(buffer: Buffer, offset: number): { fieldNumber: number; field: FieldResult; next: number } | null {
  const tagResult = readVarint(buffer, offset);
  if (!tagResult) return null;
  const fieldNumber = tagResult.value >>> 3;
  const wireType = tagResult.value & 0x7;
  if (fieldNumber === 0) return null;

  if (wireType === WIRE_TYPE_VARINT) {
    const valueResult = readVarint(buffer, tagResult.next);
    if (!valueResult) return null;
    return {
      fieldNumber,
      field: { wireType: WIRE_TYPE_VARINT, value: valueResult.value },
      next: valueResult.next,
    };
  }
  if (wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    const result = readLengthDelimitedField(buffer, tagResult.next);
    return result ? { fieldNumber, field: result.field, next: result.next } : null;
  }
  if (wireType === WIRE_TYPE_FIXED64) {
    if (tagResult.next + 8 > buffer.length) return null;
    return {
      fieldNumber,
      field: { wireType: WIRE_TYPE_FIXED64, bytes: buffer.subarray(tagResult.next, tagResult.next + 8) },
      next: tagResult.next + 8,
    };
  }
  if (wireType === WIRE_TYPE_FIXED32) {
    if (tagResult.next + 4 > buffer.length) return null;
    return {
      fieldNumber,
      field: { wireType: WIRE_TYPE_FIXED32, bytes: buffer.subarray(tagResult.next, tagResult.next + 4) },
      next: tagResult.next + 4,
    };
  }
  return null;
}

function decodeFields(buffer: Buffer): Map<number, FieldResult> | null {
  const fields = new Map<number, FieldResult>();
  let offset = 0;
  while (offset < buffer.length) {
    const result = readField(buffer, offset);
    if (!result) return null;
    fields.set(result.fieldNumber, result.field);
    offset = result.next;
  }
  return fields;
}

function findDataFramePayload(buffer: Buffer): Buffer | null {
  let offset = 0;
  while (offset < buffer.length) {
    const frame = probeFrameHeader(buffer, offset);
    if (!frame) return null;
    const frameEnd = frame.payloadStart + frame.payloadLength;
    const isTrailer = (frame.flag & GRPC_WEB_TRAILER_FLAG_BIT) !== 0;
    if (!isTrailer) {
      return buffer.subarray(frame.payloadStart, frameEnd);
    }
    offset = frameEnd;
  }
  return null;
}

function extractUsageRatio(field?: FieldResult): number | null {
  if (!field) return 0;
  if (field.wireType === WIRE_TYPE_FIXED32 && field.bytes) return field.bytes.readFloatLE(0);
  if (field.wireType === WIRE_TYPE_FIXED64 && field.bytes) return field.bytes.readDoubleLE(0);
  return null;
}

function extractResetAt(field?: FieldResult): string | null {
  if (!field || field.wireType !== WIRE_TYPE_LENGTH_DELIMITED || !field.bytes) return null;
  const timestampFields = decodeFields(field.bytes);
  if (!timestampFields) return null;

  const secondsField = timestampFields.get(TIMESTAMP_FIELD_SECONDS);
  const nanosField = timestampFields.get(TIMESTAMP_FIELD_NANOS);
  const seconds = secondsField?.wireType === WIRE_TYPE_VARINT ? (secondsField.value ?? 0) : 0;
  const nanos = nanosField?.wireType === WIRE_TYPE_VARINT ? (nanosField.value ?? 0) : 0;

  const millis = seconds * 1000 + Math.round(nanos / 1_000_000);
  const parsed = new Date(millis);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function decodeGrokCreditsFrame(buffer: Buffer): { percentUsed: number; resetAt: string | null } | null {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  try {
    const framed = probeFrameHeader(buffer, 0) !== null;
    const payload = framed ? findDataFramePayload(buffer) : buffer;
    if (!payload) return null;

    const topLevelFields = decodeFields(payload);
    if (!topLevelFields) return null;

    const creditsField = topLevelFields.get(FIELD_CREDITS_INFO);
    if (!creditsField || creditsField.wireType !== WIRE_TYPE_LENGTH_DELIMITED || !creditsField.bytes) return null;
    const creditsInfo = decodeFields(creditsField.bytes);
    if (!creditsInfo) return null;

    const usageRatio = extractUsageRatio(creditsInfo.get(CREDITS_FIELD_USAGE_RATIO));
    if (usageRatio === null || !Number.isFinite(usageRatio) || usageRatio < 0) return null;

    return {
      percentUsed: Math.min(100, usageRatio * 100),
      resetAt: extractResetAt(creditsInfo.get(CREDITS_FIELD_RESET_TIMESTAMP)),
    };
  } catch {
    return null;
  }
}
