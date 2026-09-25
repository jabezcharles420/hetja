import { describe, expect, it } from "vitest";
import {
  boxesFromCode,
  careLine,
  codeLine,
  destinationFor,
  diffPositions,
  isFullCode,
  knownCount,
  matchCountLabel,
  nearestWard,
  normaliseCode,
  normaliseCodeChar,
  prettyCode,
  queryFromBoxes,
  remainingLabel,
  telHref,
  withIntent,
} from "./scan-code";

describe("normaliseCodeChar", () => {
  it("lowercases letters in the collar alphabet", () => {
    expect(normaliseCodeChar("R")).toBe("r");
    expect(normaliseCodeChar("7")).toBe("7");
  });

  it("folds 0 to o, and 1 and l to i, as the lookup does", () => {
    expect(normaliseCodeChar("0")).toBe("o");
    expect(normaliseCodeChar("1")).toBe("i");
    expect(normaliseCodeChar("l")).toBe("i");
    expect(normaliseCodeChar("L")).toBe("i");
    expect(normaliseCodeChar("O")).toBe("o");
    expect(normaliseCodeChar("I")).toBe("i");
  });

  it("turns a skip into ?", () => {
    for (const ch of ["?", ".", "*", "_", "-", " ", "·"]) expect(normaliseCodeChar(ch)).toBe("?");
  });

  it("drops anything else", () => {
    expect(normaliseCodeChar("#")).toBeNull();
    expect(normaliseCodeChar("é")).toBeNull();
  });
});

describe("normaliseCode and the boxes", () => {
  it("normalises a printed code with spaces as skips only where typed", () => {
    expect(normaliseCode("RN1482PQ7")).toBe("rni482pq7");
    expect(normaliseCode("rn0 4?2")).toBe("rno?4?2");
    expect(normaliseCode("abcdefghijk")).toBe("abcdefghi");
  });

  it("splits into three boxes and builds the ? query", () => {
    expect(boxesFromCode("rni4")).toEqual(["rni", "4", ""]);
    expect(queryFromBoxes(["rni", "4", ""])).toBe("rni4?????");
    expect(queryFromBoxes(["r?i", "", "pq7"])).toBe("r?i???pq7");
  });

  it("counts known characters and spots a full code", () => {
    expect(knownCount("rni4?????")).toBe(4);
    expect(isFullCode("rni4?????")).toBe(false);
    expect(isFullCode("rni482pq7")).toBe(true);
    expect(isFullCode("rni48")).toBe(false);
  });
});

describe("display helpers", () => {
  it("formats the code line as the mock does", () => {
    expect(prettyCode("rni482pq7")).toBe("RNI 482 PQ7");
    expect(codeLine("rni482pq7", "K/W")).toBe("RNI 482 PQ7 · K/W");
    expect(codeLine("rni482pq7", null)).toBe("RNI 482 PQ7");
  });

  it("counts matches in plain English", () => {
    expect(matchCountLabel(2)).toBe("2 dogs match");
    expect(matchCountLabel(1)).toBe("1 dog matches");
  });

  it("describes a care provider like the SOS sent screen", () => {
    expect(
      careLine({ kind: "ngo", locality: "Andheri West", hasAmbulance: true, phoneE164: "+912200000000", phoneVerifiedAt: "x" }),
    ).toBe("NGO · Andheri West · ambulance");
    expect(careLine({ kind: "private_clinic", phoneE164: null })).toBe("Vet · no phone listed");
    expect(careLine({ kind: "govt", phoneE164: "+91", phoneVerifiedAt: null })).toBe("Govt vet · number not confirmed");
  });

  it("builds tel: links", () => {
    expect(telHref("+91 22 2413 7518")).toBe("tel:+912224137518");
  });
});

describe("nearestWard", () => {
  it("finds the ward whose centre is closest", () => {
    expect(nearestWard(19.132, 72.828)).toBe("K-West");
    expect(nearestWard(18.92, 72.83)).toBe("A");
  });

  it("is null outside Mumbai", () => {
    expect(nearestWard(28.6, 77.2)).toBeNull();
    expect(nearestWard(Number.NaN, 72.8)).toBeNull();
  });
});

describe("routing", () => {
  it("opens the profile app, or Log a feed with intent=feed", () => {
    expect(destinationFor({ slug: "rni482pq7", sig: null }, null)).toBe("/d/rni482pq7");
    expect(destinationFor({ slug: "rni482pq7", sig: null }, "feed")).toBe("/feed?dog=rni482pq7");
  });

  it("keeps intent=feed on fallback routes only when set", () => {
    expect(withIntent("/scan/code", null)).toBe("/scan/code");
    expect(withIntent("/scan/code", "feed")).toBe("/scan/code?intent=feed");
    expect(withIntent("/scan/code?code=abc", "feed")).toBe("/scan/code?code=abc&intent=feed");
  });
});

describe("V2 counter and V3 marking", () => {
  it("counts down in words", () => {
    expect(remainingLabel(0)).toBe("");
    expect(remainingLabel(8)).toBe("One more to go");
    expect(remainingLabel(5)).toBe("Four more to go");
    expect(remainingLabel(9)).toBe("That's all nine");
  });

  it("marks the characters a suggestion changes, one letter or a swap", () => {
    expect([...diffPositions("r4n7kw2ar", "r4n7kw2ab")]).toEqual([8]);
    expect([...diffPositions("rni428pq7", "rni482pq7")]).toEqual([4, 5]);
  });
});
