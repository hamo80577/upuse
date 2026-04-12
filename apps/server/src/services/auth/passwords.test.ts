import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords.js";

describe("auth passwords", () => {
  it("hashes a password using the persisted scrypt payload format", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  });

  it("verifies a matching password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects a non-matching password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });
});
