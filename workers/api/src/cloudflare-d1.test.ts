import { describe, expect, it, vi } from "vitest";
import { CloudflareD1Error, queryUserD1 } from "./cloudflare-d1";

describe("queryUserD1", () => {
  it("sends bound parameters with the account-scoped token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        success: true,
        result: [
          {
            success: true,
            results: [{ value: 1 }],
            meta: { changes: 0 },
          },
        ],
      }),
    );

    const result = await queryUserD1<{ value: number }>(
      "0123456789abcdef0123456789abcdef",
      "01234567-89ab-cdef-0123-456789abcdef",
      "secret-token",
      "SELECT ? AS value",
      [1],
      fetcher,
    );

    expect(result.results).toEqual([{ value: 1 }]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/d1/database/01234567-89ab-cdef-0123-456789abcdef/query",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
        body: JSON.stringify({ sql: "SELECT ? AS value", params: [1] }),
      }),
    );
  });

  it("returns a sanitized error when Cloudflare rejects a query", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          success: false,
          errors: [{ message: "token secret-token was rejected" }],
          result: [],
        },
        { status: 403 },
      ),
    );

    await expect(
      queryUserD1(
        "account",
        "database",
        "secret-token",
        "SELECT 1",
        [],
        fetcher,
      ),
    ).rejects.toThrow(CloudflareD1Error);
  });
});
