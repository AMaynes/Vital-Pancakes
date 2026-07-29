const YIELD_INTERVAL_BYTES = 8 * 1024 * 1024;

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Compares original and round-tripped file sets without relying on filenames,
 * which conversion engines are allowed to change.
 *
 * @param {Array<{bytes: Uint8Array}>} originalFiles
 * @param {Array<{bytes: Uint8Array}>} roundTripFiles
 * @returns {Promise<object>}
 */
export async function compareFileBytes(originalFiles, roundTripFiles) {
  if (originalFiles.length !== roundTripFiles.length) {
    return {
      matches: false,
      reason: "file-count",
      expected: originalFiles.length,
      actual: roundTripFiles.length,
      comparedBytes: 0,
    };
  }

  let comparedBytes = 0;
  let nextYield = YIELD_INTERVAL_BYTES;

  for (let fileIndex = 0; fileIndex < originalFiles.length; fileIndex += 1) {
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
        comparedBytes,
      };
    }

    for (let offset = 0; offset < original.length; offset += 1) {
      if (original[offset] !== roundTrip[offset]) {
        return {
          matches: false,
          reason: "byte-mismatch",
          fileIndex,
          mismatchOffset: offset,
          comparedBytes,
        };
      }

      comparedBytes += 1;
      if (comparedBytes >= nextYield) {
        nextYield += YIELD_INTERVAL_BYTES;
        await yieldToBrowser();
      }
    }
  }

  return { matches: true, comparedBytes };
}
