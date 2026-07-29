import type { FileData } from "./FormatHandler.ts";

export type ByteVerificationResult =
  | {
      matches: true;
      comparedBytes: number;
    }
  | {
      matches: false;
      reason: "file-count" | "file-length" | "byte-mismatch";
      fileIndex?: number;
      expected?: number;
      actual?: number;
      mismatchOffset?: number;
      comparedBytes: number;
    };

const YIELD_INTERVAL_BYTES = 8 * 1024 * 1024;

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Compares an original file set with a round-tripped file set without relying
 * on filenames, which conversion handlers are allowed to change.
 */
export async function compareFileBytes(
  originalFiles: FileData[],
  roundTripFiles: FileData[]
): Promise<ByteVerificationResult> {
  if (originalFiles.length !== roundTripFiles.length) {
    return {
      matches: false,
      reason: "file-count",
      expected: originalFiles.length,
      actual: roundTripFiles.length,
      comparedBytes: 0
    };
  }

  let comparedBytes = 0;
  let nextYield = YIELD_INTERVAL_BYTES;

  for (let fileIndex = 0; fileIndex < originalFiles.length; fileIndex++) {
    const original = originalFiles[fileIndex].bytes;
    const roundTrip = roundTripFiles[fileIndex].bytes;

    if (original.length !== roundTrip.length) {
      return {
        matches: false,
        reason: "file-length",
        fileIndex,
        expected: original.length,
        actual: roundTrip.length,
        mismatchOffset: Math.min(original.length, roundTrip.length),
        comparedBytes
      };
    }

    for (let offset = 0; offset < original.length; offset++) {
      if (original[offset] !== roundTrip[offset]) {
        return {
          matches: false,
          reason: "byte-mismatch",
          fileIndex,
          mismatchOffset: offset,
          comparedBytes
        };
      }

      comparedBytes++;
      if (comparedBytes >= nextYield) {
        nextYield += YIELD_INTERVAL_BYTES;
        await yieldToBrowser();
      }
    }
  }

  return { matches: true, comparedBytes };
}
