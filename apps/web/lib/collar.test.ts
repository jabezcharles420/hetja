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

  it("accepts any letter plus digits 2 through 7", () => {
    expect(parseCollarCode("qwerty234")).toEqual({ ok: true, slug: "qwerty234" });
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

  it("rejects the ambiguous digits 0, 1, 8 and 9", () => {
    expect(parseCollarCode("abc234560")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/digits 2–7/),
    });
    expect(parseCollarCode("abc234561")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/digits 2–7/),
    });
    expect(parseCollarCode("abc234568")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/digits 2–7/),
    });
    expect(parseCollarCode("abc234569")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/digits 2–7/),
    });
  });

  it("rejects symbols and spaces inside the code", () => {
    expect(parseCollarCode("abc 23456")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/letters a–z/),
    });
    expect(parseCollarCode("abc-23456")).toMatchObject({ ok: false });
  });

  it("rejects a code with valid characters but a disallowed shape", () => {
    expect(parseCollarCode("aaaaaaaa9")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/digits 2–7/),
    });
  });
});
