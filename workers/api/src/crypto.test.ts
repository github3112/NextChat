import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe("encrypted secrets", () => {
  it("round-trips secret material without exposing plaintext", async () => {
    const encrypted = await encryptSecret(
      "sample-secret",
      key,
      "user-1:model-key:openai",
    );

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("sample-secret");
    await expect(
      decryptSecret(encrypted, key, "user-1:model-key:openai"),
    ).resolves.toBe("sample-secret");
  });

  it("rejects ciphertext bound to a different user", async () => {
    const encrypted = await encryptSecret("sample-secret", key, "user-1");

    await expect(decryptSecret(encrypted, key, "user-2")).rejects.toThrow();
  });

  it("rejects keys that are not 256 bits", async () => {
    await expect(encryptSecret("secret", btoa("short"), "user-1")).rejects.toThrow(
      "exactly 32 bytes",
    );
  });
});
