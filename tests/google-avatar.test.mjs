import { test } from "node:test";
import assert from "node:assert/strict";
import { googleAvatarUrl } from "../src/lib/google-avatar.ts";

test("foto Google aceita somente HTTPS no domínio de imagens do Google", () => {
  const photo = "https://lh3.googleusercontent.com/a/photo";
  assert.equal(googleAvatarUrl({ avatar_url: photo }), photo);
  assert.equal(googleAvatarUrl({ picture: photo }), photo);
  assert.equal(googleAvatarUrl({ avatar_url: "invalid", picture: photo }), photo);
  for (const value of ["http://lh3.googleusercontent.com/a", "https://googleusercontent.com.evil.test/a", "javascript:alert(1)", "https://user:password@lh3.googleusercontent.com/a", null]) {
    assert.equal(googleAvatarUrl({ avatar_url: value }), null);
  }
  assert.equal(googleAvatarUrl({}), null);
});
