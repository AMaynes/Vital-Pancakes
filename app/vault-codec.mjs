/**
 * JSON-safe structured-clone codec with out-of-band binary attachments.
 */

const TAG = "$vpType";

export function encodeStructuredValue(value, options = {}) {
  const attachments = [];
  const active = new WeakSet();
  let attachmentIndex = 0;
  const nextId = () => (
    options.createAttachmentId?.(attachmentIndex++)
    ?? `attachment-${attachmentIndex}`
  );

  function encode(current) {
    if (current === undefined) return tagged("Undefined");
    if (typeof current === "bigint") return tagged("BigInt", { value: String(current) });
    if (typeof current === "number") {
      if (Number.isNaN(current)) return tagged("Number", { value: "NaN" });
      if (current === Infinity) return tagged("Number", { value: "Infinity" });
      if (current === -Infinity) return tagged("Number", { value: "-Infinity" });
      if (Object.is(current, -0)) return tagged("Number", { value: "-0" });
      return current;
    }
    if (
      current === null
      || typeof current === "string"
      || typeof current === "boolean"
    ) return current;
    if (typeof current !== "object") {
      throw new TypeError(`Unsupported structured value type: ${typeof current}.`);
    }
    if (active.has(current)) throw new TypeError("Cyclic structured values cannot be archived.");

    if (current instanceof Date) return tagged("Date", { value: current.toISOString() });
    if (current instanceof RegExp) {
      return tagged("RegExp", { source: current.source, flags: current.flags });
    }
    if (current instanceof URL) return tagged("URL", { value: current.href });
    if (current instanceof Blob) {
      const id = nextId();
      attachments.push({ id, blob: current, type: "Blob", mimeType: current.type });
      return tagged("Attachment", { id, attachmentType: "Blob", mimeType: current.type });
    }
    if (current instanceof ArrayBuffer) {
      const id = nextId();
      attachments.push({ id, blob: new Blob([current]), type: "ArrayBuffer" });
      return tagged("Attachment", { id, attachmentType: "ArrayBuffer" });
    }
    if (ArrayBuffer.isView(current)) {
      const id = nextId();
      const bytes = current.buffer.slice(current.byteOffset, current.byteOffset + current.byteLength);
      const constructorName = current instanceof DataView ? "DataView" : current.constructor.name;
      attachments.push({ id, blob: new Blob([bytes]), type: constructorName });
      return tagged("Attachment", {
        id,
        attachmentType: constructorName,
        length: "length" in current ? current.length : current.byteLength,
      });
    }

    active.add(current);
    let encoded;
    if (Array.isArray(current)) {
      encoded = tagged("Array", { values: current.map(encode) });
    } else if (current instanceof Map) {
      encoded = tagged("Map", {
        entries: [...current.entries()].map(([key, entryValue]) => [encode(key), encode(entryValue)]),
      });
    } else if (current instanceof Set) {
      encoded = tagged("Set", { values: [...current].map(encode) });
    } else {
      encoded = tagged("Object", {
        entries: Object.entries(current).map(([key, entryValue]) => [key, encode(entryValue)]),
      });
    }
    active.delete(current);
    return encoded;
  }

  return { encoded: encode(value), attachments };
}

export async function decodeStructuredValue(encoded, attachments = new Map()) {
  async function decode(current) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !current[TAG]) {
      return current;
    }
    switch (current[TAG]) {
      case "Undefined": return undefined;
      case "BigInt": return BigInt(current.value);
      case "Number": return decodeNumber(current.value);
      case "Date": return new Date(current.value);
      case "RegExp": return new RegExp(current.source, current.flags);
      case "URL": return new URL(current.value);
      case "Array": return Promise.all(current.values.map(decode));
      case "Map": return new Map(await Promise.all(current.entries.map(async ([key, value]) => [
        await decode(key),
        await decode(value),
      ])));
      case "Set": return new Set(await Promise.all(current.values.map(decode)));
      case "Object": {
        const output = {};
        for (const [key, value] of current.entries) output[key] = await decode(value);
        return output;
      }
      case "Attachment": return decodeAttachment(current, attachments);
      default: throw new TypeError(`Unknown archived structured value type: ${current[TAG]}.`);
    }
  }
  return decode(encoded);
}

export function parseEncodedStructuredValue(value) {
  if (!value || typeof value !== "object" || value[TAG] === undefined) {
    throw new TypeError("The archived structured value is invalid.");
  }
  return value;
}

async function decodeAttachment(reference, attachments) {
  const blob = attachments.get(reference.id);
  if (!(blob instanceof Blob)) throw new TypeError(`Missing vault attachment: ${reference.id}.`);
  if (reference.attachmentType === "Blob") {
    return blob.slice(0, blob.size, String(reference.mimeType ?? ""));
  }
  const buffer = await blob.arrayBuffer();
  if (reference.attachmentType === "ArrayBuffer") return buffer;
  if (reference.attachmentType === "DataView") return new DataView(buffer);
  const Constructor = globalThis[reference.attachmentType];
  if (
    typeof Constructor !== "function"
    || !/^(?:Uint|Int|Float|BigInt|BigUint)\d+(?:Clamped)?Array$/.test(reference.attachmentType)
  ) {
    throw new TypeError(`Unsupported archived typed array: ${reference.attachmentType}.`);
  }
  return new Constructor(buffer);
}

function tagged(type, fields = {}) {
  return { [TAG]: type, ...fields };
}

function decodeNumber(value) {
  if (value === "NaN") return NaN;
  if (value === "Infinity") return Infinity;
  if (value === "-Infinity") return -Infinity;
  if (value === "-0") return -0;
  throw new TypeError("The archived number is invalid.");
}
