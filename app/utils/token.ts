const IMAGE_TOKEN_ESTIMATE = 16384;

export function resolveContextWindow(
  manualOverride?: number,
  modelMetadata?: number,
) {
  return manualOverride && manualOverride > 0 ? manualOverride : modelMetadata;
}

export function estimateTokenLength(input: string): number {
  let tokenLength = 0;

  for (let i = 0; i < input.length; i++) {
    const charCode = input.charCodeAt(i);

    if (charCode < 128) {
      // ASCII character
      if (charCode <= 122 && charCode >= 65) {
        // a-Z
        tokenLength += 0.25;
      } else {
        tokenLength += 0.5;
      }
    } else {
      // Unicode character
      tokenLength += 1.5;
    }
  }

  return tokenLength;
}

export function estimateMessageTokenLength(message: {
  content: string | { type: string; text?: string; image_url?: unknown }[];
}): number {
  if (typeof message.content === "string") {
    return estimateTokenLength(message.content);
  }

  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
  const imageCount = message.content.filter(
    (part) => part.type === "image_url",
  ).length;

  return estimateTokenLength(text) + imageCount * IMAGE_TOKEN_ESTIMATE;
}

export function truncateTextToTokenLimit(
  input: string,
  tokenLimit: number,
  marker = "[middle of message omitted during compaction]",
): string {
  if (estimateTokenLength(input) <= tokenLimit) return input;
  if (estimateTokenLength(marker) > tokenLimit) return "";

  let low = 0;
  let high = input.length;
  let result = marker;

  while (low <= high) {
    const includedLength = Math.floor((low + high) / 2);
    const prefixLength = Math.ceil(includedLength / 2);
    const suffixLength = Math.floor(includedLength / 2);
    const candidate =
      input.slice(0, prefixLength) +
      marker +
      (suffixLength ? input.slice(-suffixLength) : "");

    if (estimateTokenLength(candidate) <= tokenLimit) {
      result = candidate;
      low = includedLength + 1;
    } else {
      high = includedLength - 1;
    }
  }

  return result;
}
