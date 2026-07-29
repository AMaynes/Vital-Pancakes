/**
 * Small deterministic BM25 index used to retrieve textbook chunks locally.
 */

const K1 = 1.4;
const B = 0.75;
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
  "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was",
  "what", "when", "where", "which", "who", "why", "with",
]);

/**
 * @param {Array<object>} chunks
 * @returns {{search: (query: string, limit?: number) => Array<object>}}
 */
export function createRetrievalIndex(chunks) {
  const documents = (Array.isArray(chunks) ? chunks : [])
    .filter((chunk) => typeof chunk?.id === "string" && typeof chunk?.text === "string")
    .map((chunk) => {
      const tokens = tokenize(`${chunk.sectionTitle ?? ""} ${chunk.text}`);
      return { chunk, tokens, frequencies: countTokens(tokens) };
    });
  const averageLength = documents.length
    ? documents.reduce((sum, document) => sum + document.tokens.length, 0) / documents.length
    : 1;
  const documentFrequency = new Map();

  documents.forEach((document) => {
    new Set(document.tokens).forEach((token) => {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    });
  });

  return {
    search(query, limit = 5) {
      const terms = [...new Set(tokenize(query))];
      if (!terms.length) return [];
      return documents
        .map((document) => ({
          ...document.chunk,
          score: scoreDocument(
            document,
            terms,
            documentFrequency,
            documents.length,
            averageLength,
          ),
        }))
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, Math.max(1, Number.parseInt(limit, 10) || 5));
    },
  };
}

export function tokenize(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function scoreDocument(document, terms, documentFrequency, totalDocuments, averageLength) {
  return terms.reduce((score, term) => {
    const frequency = document.frequencies.get(term) ?? 0;
    if (!frequency) return score;
    const containing = documentFrequency.get(term) ?? 0;
    const inverseFrequency = Math.log(1 + ((totalDocuments - containing + 0.5) / (containing + 0.5)));
    const lengthAdjustment = frequency + K1 * (
      1 - B + B * (document.tokens.length / averageLength)
    );
    return score + inverseFrequency * ((frequency * (K1 + 1)) / lengthAdjustment);
  }, 0);
}

function countTokens(tokens) {
  const counts = new Map();
  tokens.forEach((token) => counts.set(token, (counts.get(token) ?? 0) + 1));
  return counts;
}
