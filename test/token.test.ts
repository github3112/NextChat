import {
  estimateMessageTokenLength,
  estimateTokenLength,
  resolveContextWindow,
  truncateTextToTokenLimit,
} from "../app/utils/token";

describe("token estimates", () => {
  test("prefers a manual context window override over model metadata", () => {
    expect(resolveContextWindow(65536, 131072)).toBe(65536);
    expect(resolveContextWindow(0, 131072)).toBe(131072);
  });

  test("reserves estimated tokens for image attachments", () => {
    expect(
      estimateMessageTokenLength({
        content: [
          { type: "text", text: "look at this" },
          { type: "image_url", image_url: { url: "image-data" } },
        ],
      }),
    ).toBe(estimateTokenLength("look at this") + 16384);
  });

  test("truncates oversized text within the requested estimate", () => {
    const original = `begin${"x".repeat(10000)}end`;
    const truncated = truncateTextToTokenLimit(original, 100);

    expect(estimateTokenLength(truncated)).toBeLessThanOrEqual(100);
    expect(truncated).toContain(
      "[middle of message omitted during compaction]",
    );
    expect(truncated.startsWith("begin")).toBe(true);
    expect(truncated.endsWith("end")).toBe(true);
    expect(truncated.length).toBeLessThan(original.length);
  });
});
