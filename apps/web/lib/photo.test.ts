// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const compressorMock = vi.hoisted(() => {
  const calls: Array<Record<string, unknown>> = [];
  const CompressorMock = class {
    constructor(_file: File | Blob, options: Record<string, unknown>) {
      calls.push(options);
      const success = options.success as ((result: Blob) => void) | undefined;
      queueMicrotask(() => {
        if (success) success(new Blob(["out"], { type: "image/webp" }));
      });
    }
  };
  return { calls, default: CompressorMock };
});

const exifrMock = vi.hoisted(() => {
  const state = { gps: undefined as { latitude: number; longitude: number } | undefined, orientation: undefined as number | undefined, failGps: false };
  return {
    state,
    // One-shot: the first gps() call models reading the ORIGINAL file (has
    // GPS); subsequent calls model re-reading the COMPRESSED output (must
    // have none) — that is exactly what assertExifFree guards against.
    gps: vi.fn(async () => {
      if (state.failGps) throw new Error("boom");
      const g = state.gps;
      state.gps = undefined;
      return g;
    }),
    orientation: vi.fn(async () => state.orientation),
  };
});

vi.mock("exifr", () => exifrMock);
vi.mock("compressorjs", () => compressorMock);

import {
  prepareFeedPhoto,
  compressPhoto,
  extractExifGeo,
  assertExifFree,
  supportsWebp,
} from "./photo";

describe("photo pipeline (enhancement stack §K.3/§K.4)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    compressorMock.calls.length = 0;
    exifrMock.state.gps = undefined;
    exifrMock.state.orientation = undefined;
    exifrMock.state.failGps = false;
  });

  describe("extractExifGeo", () => {
    it("coarsens photo GPS to ward level (<=2 decimals) via coarsenToWard", async () => {
      exifrMock.state.gps = { latitude: 19.07612345, longitude: 72.8776789 };
      const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
      const geo = await extractExifGeo(file);
      expect(geo).toEqual({ lat: 19.07, lng: 72.87 });
    });

    it("returns undefined when the photo has no GPS", async () => {
      const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
      const geo = await extractExifGeo(file);
      expect(geo).toBeUndefined();
    });

    it("never throws on an unreadable file", async () => {
      exifrMock.state.failGps = true;
      const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
      await expect(extractExifGeo(file)).resolves.toBeUndefined();
    });
  });

  describe("compressPhoto", () => {
    async function freshCompressor(webp: boolean) {
      vi.resetModules();
      const canvas = document.createElement("canvas");
      vi.spyOn(canvas, "toDataURL").mockReturnValue(
        webp ? "data:image/webp;base64,UklGR" : "data:image/png;base64,",
      );
      vi.spyOn(document, "createElement").mockReturnValue(canvas);
      return import("./photo");
    }

    it("strips EXIF (retainExif false) and falls back to JPEG without WebP", async () => {
      const { compressPhoto: compress } = await freshCompressor(false);
      const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
      const blob = await compress(file);
      expect(blob).toBeInstanceOf(Blob);
      const opts = compressorMock.calls[0];
      expect(opts).toMatchObject({
        quality: 0.8,
        retainExif: false,
        checkOrientation: true,
        strict: false,
        mimeType: "image/jpeg",
      });
    });

    it("uses WebP when the browser supports it", async () => {
      const { compressPhoto: compress } = await freshCompressor(true);
      const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
      await compress(file);
      expect(compressorMock.calls[0]).toMatchObject({ mimeType: "image/webp" });
    });
  });

  describe("assertExifFree", () => {
    it("resolves when the compressed output carries no metadata", async () => {
      const blob = new Blob(["out"], { type: "image/webp" });
      await expect(assertExifFree(blob)).resolves.toBeUndefined();
    });

    it("rejects when GPS survived compression", async () => {
      exifrMock.state.gps = { latitude: 19.07, longitude: 72.87 };
      const blob = new Blob(["out"], { type: "image/jpeg" });
      await expect(assertExifFree(blob)).rejects.toThrow("still carries EXIF metadata");
    });

    it("rejects when a non-identity orientation survived", async () => {
      exifrMock.state.orientation = 6;
      const blob = new Blob(["out"], { type: "image/jpeg" });
      await expect(assertExifFree(blob)).rejects.toThrow("still carries EXIF metadata");
    });
  });

  describe("prepareFeedPhoto", () => {
    it("returns the compressed blob and the coarsened GPS", async () => {
      exifrMock.state.gps = { latitude: 19.07612345, longitude: 72.8776789 };
      const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
      const prepared = await prepareFeedPhoto(file);
      expect(prepared.blob).toBeInstanceOf(Blob);
      expect(prepared.geo).toEqual({ lat: 19.07, lng: 72.87 });
    });

    it("returns no geo when the photo has no GPS", async () => {
      const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
      const prepared = await prepareFeedPhoto(file);
      expect(prepared.geo).toBeUndefined();
    });
  });

  it("supportsWebp is a cached boolean probe that never throws", () => {
    expect(typeof supportsWebp()).toBe("boolean");
    expect(supportsWebp()).toBe(supportsWebp());
  });
});
