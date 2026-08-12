import { describe, expect, it } from "vitest";
import { parseCollarCode } from "./collar";

describe("parseCollarCode", () => {
  it("accepts a 9-character lowercase code", () => {
    expect(parseCollarCode("abc234567")).toEqual({ ok: true, slug: "abc234567" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseCollarCode("  abc234567\n")).toEqual({ ok: true, slug: "abc234567" });
  });

  it("lowercases an uppercase code", () => {
    expect(parseCollarCode("ABC234567")).toEqual({ ok: true, slug: "abc234567" });
  });

  it("accepts the digits 8 and 9, which the slug generator emits", () => {
    // Regression: the parser used to demand /^[a-z2-7]{9}$/ and refused these,
    // so ~44% of generated collar codes could not be typed in.
    expect(parseCollarCode("abc234568")).toEqual({ ok: true, slug: "abc234568" });
    expect(parseCollarCode("abc234589")).toEqual({ ok: true, slug: "abc234589" });
  });

  it("accepts the real Phase-0 seed collar codes", () => {
    for (const slug of ["c3di5esh8", "md5wicnma", "jo23vpmg5", "5hreaphdq", "jtkkaece2"]) {
      expect(parseCollarCode(slug)).toEqual({ ok: true, slug });
    }
  });

  it("rejects a code shorter than 9 characters", () => {
    expect(parseCollarCode("abc23456")).toEqual({
      ok: false,
      error: "That code looks incomplete — it should be 9 characters",
    });
  });

  it("rejects a code longer than 9 characters", () => {
    expect(parseCollarCode("abc2345678")).toEqual({
      ok: false,
      error: "That code looks incomplete — it should be 9 characters",
    });
  });

  it("rejects an empty code", () => {
    expect(parseCollarCode("   ")).toEqual({
      ok: false,
      error: "That code looks incomplete — it should be 9 characters",
    });
  });

  it("accepts o, which the generator alphabet does include", () => {
    // The generator's comment claims "no l/1/o/0", but `o` is present in
    // ALPHABET and is emitted -- so rejecting it here would refuse real codes.
    expect(parseCollarCode("abco23456")).toEqual({ ok: true, slug: "abco23456" });
  });

  it("rejects the characters the alphabet omits: 0, 1 and l", () => {
    for (const code of ["abc234560", "abc234561", "abcl23456"]) {
      expect(parseCollarCode(code)).toMatchObject({
        ok: false,
        error: expect.stringMatching(/except l/),
      });
    }
  });

  it("rejects symbols and spaces inside the code", () => {
    expect(parseCollarCode("abc 23456")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/letters a–z/),
    });
    expect(parseCollarCode("abc-23456")).toMatchObject({ ok: false });
  });
});
