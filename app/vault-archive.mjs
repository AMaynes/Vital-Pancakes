/**
 * Versioned, chunked, authenticated Vital Pancakes archive framing.
 *
 * Only the cryptographic parameters are visible. Entry names, metadata, and
 * bytes are all inside independent AES-GCM frames so large blobs do not need
 * to become base64 or one enormous in-memory string.
 */

export const VAULT_FORMAT = "vital-pancakes-unified-vault";
export const VAULT_VERSION = 1;
export const VAULT_EXTENSION = ".vpvault";

const MAGIC = new TextEncoder().encode("VPVAULT2\n");
const DEFAULT_ITERATIONS = 310_000;
const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const MAXIMUM_HEADER_BYTES = 64 * 1024;
const MAXIMUM_FRAME_BYTES = 64 * 1024 * 1024;

export async function encryptVaultEntries(entries, password, options = {}) {
  const cryptoRef = requireCrypto(options.cryptoRef);
  const normalizedPassword = requirePassword(password);
  const iterations = normalizeIterations(options.iterations);
  const chunkSize = normalizeChunkSize(options.chunkSize);
  const salt = randomBytes(cryptoRef, 16);
  const archiveId = cryptoRef.randomUUID?.() ?? bytesToHex(randomBytes(cryptoRef, 16));
  const header = {
    format: VAULT_FORMAT,
    version: VAULT_VERSION,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations,
    chunkSize,
    salt: bytesToBase64(salt),
    archiveId,
    createdAt: new Date().toISOString(),
  };
  const headerBytes = encodeJson(header);
  const key = await deriveVaultKey(cryptoRef, normalizedPassword, salt, iterations, ["encrypt"]);
  const parts = [MAGIC, encodeUint32(headerBytes.byteLength), headerBytes];
  let sequence = 0;
  let entryCount = 0;
  let sourceBytes = 0;

  for await (const rawEntry of entries) {
    throwIfCancelled(options.signal);
    const entry = normalizeEntry(rawEntry);
    const data = toBlob(entry.data);
    const chunkCount = Math.max(1, Math.ceil(data.size / chunkSize));
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      throwIfCancelled(options.signal);
      const start = chunkIndex * chunkSize;
      const chunk = new Uint8Array(
        await data.slice(start, Math.min(data.size, start + chunkSize)).arrayBuffer(),
      );
      const metadata = {
        kind: entry.kind,
        id: entry.id,
        chunkIndex,
        chunkCount,
        entrySize: data.size,
        ...(chunkIndex === 0 ? { metadata: entry.metadata } : {}),
      };
      parts.push(await encryptFrame(cryptoRef, key, archiveId, sequence, metadata, chunk));
      sourceBytes += chunk.byteLength;
      sequence += 1;
      options.onProgress?.({
        phase: "encrypt",
        entryCount,
        sourceBytes,
        current: entry.id,
      });
    }
    entryCount += 1;
  }

  parts.push(await encryptFrame(cryptoRef, key, archiveId, sequence, {
    kind: "archive-end",
    id: "archive-end",
    chunkIndex: 0,
    chunkCount: 1,
    entrySize: 0,
    metadata: { entryCount, sourceBytes },
  }, new Uint8Array()));

  return new Blob(parts, { type: "application/vnd.vital-pancakes.vault" });
}

export async function readVaultEntries(input, password, options = {}) {
  const cryptoRef = requireCrypto(options.cryptoRef);
  const normalizedPassword = requirePassword(password);
  const reader = createReader(input);
  let offset = 0;

  const magic = await reader.read(offset, MAGIC.byteLength);
  offset += MAGIC.byteLength;
  if (!equalBytes(magic, MAGIC)) throw new TypeError("This is not a Vital Pancakes vault archive.");

  const headerLength = decodeUint32(await reader.read(offset, 4));
  offset += 4;
  if (headerLength < 2 || headerLength > MAXIMUM_HEADER_BYTES) {
    throw new TypeError("The vault header is invalid.");
  }
  const header = parseJson(await reader.read(offset, headerLength), "The vault header is invalid.");
  offset += headerLength;
  validateVaultHeader(header);

  const salt = base64ToBytes(header.salt);
  const key = await deriveVaultKey(
    cryptoRef,
    normalizedPassword,
    salt,
    header.iterations,
    ["decrypt"],
  );
  let sequence = 0;
  let entryCount = 0;
  let sourceBytes = 0;
  let sawEnd = false;
  const entryStates = new Map();

  while (offset < reader.size) {
    throwIfCancelled(options.signal);
    const cipherLength = decodeUint32(await reader.read(offset, 4));
    offset += 4;
    if (cipherLength < 17 || cipherLength > MAXIMUM_FRAME_BYTES) {
      throw new TypeError("The vault contains an invalid encrypted frame.");
    }
    const iv = await reader.read(offset, 12);
    offset += 12;
    const cipher = await reader.read(offset, cipherLength);
    offset += cipherLength;

    let plain;
    try {
      plain = new Uint8Array(await cryptoRef.subtle.decrypt({
        name: "AES-GCM",
        iv,
        additionalData: frameAdditionalData(header.archiveId, sequence),
      }, key, cipher));
    } catch {
      throw new DOMException(
        "The vault password is incorrect or the archive has been altered.",
        "OperationError",
      );
    }
    const metadataLength = decodeUint32(plain.subarray(0, 4));
    if (metadataLength < 2 || metadataLength > Math.min(MAXIMUM_HEADER_BYTES, plain.byteLength - 4)) {
      throw new TypeError("The vault contains invalid encrypted metadata.");
    }
    const metadata = parseJson(
      plain.subarray(4, 4 + metadataLength),
      "The vault contains invalid encrypted metadata.",
    );
    const data = plain.slice(4 + metadataLength);
    validateFrameMetadata(metadata);

    if (metadata.kind === "archive-end") {
      if (offset !== reader.size || metadata.metadata?.entryCount !== entryCount) {
        throw new TypeError("The vault is incomplete or its entry count is invalid.");
      }
      if (metadata.metadata?.sourceBytes !== sourceBytes || entryStates.size) {
        throw new TypeError("The vault is incomplete or its byte count is invalid.");
      }
      sawEnd = true;
      sequence += 1;
      break;
    }

    const current = entryStates.get(metadata.id) ?? {
      nextChunk: 0,
      chunkCount: metadata.chunkCount,
      receivedBytes: 0,
      metadata: metadata.metadata ?? null,
    };
    if (
      metadata.chunkIndex !== current.nextChunk
      || metadata.chunkCount !== current.chunkCount
      || (metadata.chunkIndex === 0 && metadata.metadata === undefined)
    ) {
      throw new TypeError("The vault contains out-of-order entry chunks.");
    }
    current.nextChunk += 1;
    current.receivedBytes += data.byteLength;
    entryStates.set(metadata.id, current);
    sourceBytes += data.byteLength;

    await options.onChunk?.({
      kind: metadata.kind,
      id: metadata.id,
      metadata: current.metadata,
      chunkIndex: metadata.chunkIndex,
      chunkCount: metadata.chunkCount,
      entrySize: metadata.entrySize,
      data,
      final: metadata.chunkIndex === metadata.chunkCount - 1,
    });
    if (metadata.chunkIndex === metadata.chunkCount - 1) {
      if (current.receivedBytes !== metadata.entrySize) {
        throw new TypeError("The vault contains an entry with an invalid byte count.");
      }
      entryStates.delete(metadata.id);
      entryCount += 1;
    }
    sequence += 1;
    options.onProgress?.({
      phase: "decrypt",
      entryCount,
      sourceBytes,
      totalBytes: reader.size,
      processedBytes: offset,
      current: metadata.id,
    });
  }

  if (!sawEnd) throw new TypeError("The vault archive ended before its integrity marker.");
  return { header, entryCount, sourceBytes };
}

export async function collectVaultEntries(input, password, options = {}) {
  const collecting = new Map();
  const entries = [];
  const summary = await readVaultEntries(input, password, {
    ...options,
    async onChunk(chunk) {
      const state = collecting.get(chunk.id) ?? {
        kind: chunk.kind,
        id: chunk.id,
        metadata: chunk.metadata,
        parts: [],
      };
      state.parts.push(chunk.data);
      collecting.set(chunk.id, state);
      if (chunk.final) {
        entries.push({
          kind: state.kind,
          id: state.id,
          metadata: state.metadata,
          data: new Blob(state.parts),
        });
        collecting.delete(chunk.id);
      }
      await options.onChunk?.(chunk);
    },
  });
  return { ...summary, entries };
}

export function validateVaultHeader(header) {
  if (!header || typeof header !== "object" || Array.isArray(header)) {
    throw new TypeError("The vault header is invalid.");
  }
  if (header.format !== VAULT_FORMAT || header.version !== VAULT_VERSION) {
    throw new TypeError(`Unsupported Vital Pancakes vault version: ${header.version ?? "unknown"}.`);
  }
  if (header.algorithm !== "AES-GCM" || header.kdf !== "PBKDF2-SHA-256") {
    throw new TypeError("The vault uses unsupported encryption settings.");
  }
  normalizeIterations(header.iterations);
  normalizeChunkSize(header.chunkSize);
  const salt = base64ToBytes(header.salt);
  if (salt.byteLength !== 16 || typeof header.archiveId !== "string" || !header.archiveId) {
    throw new TypeError("The vault cryptographic header is incomplete.");
  }
  return header;
}

async function encryptFrame(cryptoRef, key, archiveId, sequence, metadata, data) {
  const metadataBytes = encodeJson(metadata);
  const plain = joinBytes(encodeUint32(metadataBytes.byteLength), metadataBytes, data);
  const iv = randomBytes(cryptoRef, 12);
  const cipher = new Uint8Array(await cryptoRef.subtle.encrypt({
    name: "AES-GCM",
    iv,
    additionalData: frameAdditionalData(archiveId, sequence),
  }, key, plain));
  return joinBytes(encodeUint32(cipher.byteLength), iv, cipher);
}

async function deriveVaultKey(cryptoRef, password, salt, iterations, usages) {
  const keyMaterial = await cryptoRef.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return cryptoRef.subtle.deriveKey({
    name: "PBKDF2",
    hash: "SHA-256",
    salt,
    iterations,
  }, keyMaterial, { name: "AES-GCM", length: 256 }, false, usages);
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") throw new TypeError("Vault entries must be objects.");
  const kind = String(entry.kind ?? "").trim();
  const id = String(entry.id ?? "").trim();
  if (!kind || !id || kind === "archive-end") {
    throw new TypeError("Every vault entry needs a non-reserved kind and identifier.");
  }
  return {
    kind: kind.slice(0, 120),
    id: id.slice(0, 500),
    metadata: entry.metadata && typeof entry.metadata === "object"
      ? structuredClone(entry.metadata)
      : {},
    data: entry.data ?? new Uint8Array(),
  };
}

function validateFrameMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("The vault contains invalid encrypted metadata.");
  }
  if (
    typeof metadata.kind !== "string"
    || typeof metadata.id !== "string"
    || !Number.isInteger(metadata.chunkIndex)
    || !Number.isInteger(metadata.chunkCount)
    || metadata.chunkIndex < 0
    || metadata.chunkCount < 1
    || metadata.chunkIndex >= metadata.chunkCount
    || !Number.isSafeInteger(metadata.entrySize)
    || metadata.entrySize < 0
  ) {
    throw new TypeError("The vault contains invalid encrypted frame metadata.");
  }
}

function createReader(input) {
  if (input instanceof Blob) {
    return {
      size: input.size,
      async read(offset, length) {
        if (offset < 0 || length < 0 || offset + length > input.size) {
          throw new TypeError("The vault archive is truncated.");
        }
        return new Uint8Array(await input.slice(offset, offset + length).arrayBuffer());
      },
    };
  }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return {
    size: bytes.byteLength,
    async read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
        throw new TypeError("The vault archive is truncated.");
      }
      return bytes.slice(offset, offset + length);
    },
  };
}

function requireCrypto(cryptoRef) {
  const resolved = cryptoRef ?? globalThis.crypto;
  if (!resolved?.subtle || !resolved?.getRandomValues) {
    throw new Error("Web Crypto is unavailable in this browser.");
  }
  return resolved;
}

function requirePassword(password) {
  const normalized = String(password ?? "");
  if (normalized.length < 8 || normalized.length > 1024) {
    throw new TypeError("The vault password must contain between 8 and 1,024 characters.");
  }
  return normalized;
}

function normalizeIterations(value) {
  const iterations = value === undefined ? DEFAULT_ITERATIONS : Number(value);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 2_000_000) {
    throw new TypeError("The vault PBKDF2 iteration count is invalid.");
  }
  return iterations;
}

function normalizeChunkSize(value) {
  const size = value === undefined ? DEFAULT_CHUNK_SIZE : Number(value);
  if (!Number.isInteger(size) || size < 1024 || size > 16 * 1024 * 1024) {
    throw new TypeError("The vault chunk size is invalid.");
  }
  return size;
}

function toBlob(value) {
  if (value instanceof Blob) return value;
  if (typeof value === "string") return new Blob([new TextEncoder().encode(value)]);
  if (value instanceof ArrayBuffer) return new Blob([value]);
  if (ArrayBuffer.isView(value)) {
    return new Blob([value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)]);
  }
  throw new TypeError("Vault entry data must be text, a Blob, or binary bytes.");
}

function encodeJson(value) {
  return new TextEncoder().encode(JSON.stringify(value));
}

function parseJson(bytes, errorMessage) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TypeError(errorMessage);
  }
}

function encodeUint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function decodeUint32(bytes) {
  if (bytes.byteLength < 4) throw new TypeError("The vault archive is truncated.");
  return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
}

function joinBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.byteLength;
  });
  return output;
}

function frameAdditionalData(archiveId, sequence) {
  return new TextEncoder().encode(`${archiveId}:${sequence}`);
}

function randomBytes(cryptoRef, length) {
  return cryptoRef.getRandomValues(new Uint8Array(length));
}

function equalBytes(left, right) {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function base64ToBytes(value) {
  try {
    const binary = atob(String(value ?? ""));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new TypeError("The vault salt is invalid.");
  }
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw new DOMException("Vault operation cancelled.", "AbortError");
}
