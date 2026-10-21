import { getBearerToken } from "../app/client/api";

describe("getBearerToken", () => {
  test("wraps the key with a 'Bearer ' prefix by default", () => {
    expect(getBearerToken("abc")).toBe("Bearer abc");
  });

  test("omits the prefix when noBearer is true", () => {
    expect(getBearerToken("abc", true)).toBe("abc");
  });

  test("preserves a Basic authorization scheme", () => {
    expect(getBearerToken("Basic dXNlcjpwYXNz")).toBe(
      "Basic dXNlcjpwYXNz",
    );
  });

  test("trims surrounding whitespace from the key", () => {
    expect(getBearerToken("  abc  ")).toBe("Bearer abc");
  });

  test("returns an empty string when the key is empty", () => {
    expect(getBearerToken("")).toBe("");
    expect(getBearerToken("", true)).toBe("");
  });
});
