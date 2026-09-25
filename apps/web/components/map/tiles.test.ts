/**
 * Base map tiles: Esri with a key; otherwise no tile layer at all (CARTO's
 * keyless tiles now answer 200 with an "API KEY REQUIRED" image, and OSM's
 * own tiles are not for production apps).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Leaflet from "leaflet";
import { addBaseLayer } from "./tiles";

type Handler = () => void;

function fakeLeaflet() {
  const layers: Array<{ url: string; handlers: Record<string, Handler[]>; options: { attribution?: string } }> = [];
  const L = {
    tileLayer: vi.fn((url: string, options: { attribution?: string }) => {
      const handlers: Record<string, Handler[]> = {};
      const layer = {
        url,
        handlers,
        options,
        on(ev: string, fn: Handler) {
          (handlers[ev] ??= []).push(fn);
          return layer;
        },
        addTo: vi.fn(() => layer),
      };
      layers.push(layer);
      return layer;
    }),
  };
  const map = {
    removeLayer: vi.fn(),
    attributionControl: { addAttribution: vi.fn(), removeAttribution: vi.fn() },
  };
  return { L: L as unknown as typeof Leaflet, map: map as unknown as Leaflet.Map, layers, rawMap: map };
}

afterEach(() => vi.unstubAllGlobals());

describe("addBaseLayer", () => {
  it("without a key adds no tile layer and reports 'none'", () => {
    const { L, map, layers } = fakeLeaflet();
    const onSource = vi.fn();
    addBaseLayer(L, map, "  ", onSource);
    expect(layers).toHaveLength(0);
    expect(onSource).toHaveBeenCalledWith("none");
  });

  it("with a key adds Esri, credited, and never a CARTO or OSM layer", () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const { L, map, layers } = fakeLeaflet();
    const onSource = vi.fn();
    addBaseLayer(L, map, "k", onSource);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.url).toContain("static-map-tiles-api.arcgis.com");
    expect(layers[0]!.options.attribution).toContain("Powered by");
    expect(onSource).toHaveBeenCalledWith("esri");
  });

  it("when Esri refuses the first tiles, removes the layer (and its credit) and reports 'none'", () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const { L, map, layers, rawMap } = fakeLeaflet();
    const onSource = vi.fn();
    addBaseLayer(L, map, "k", onSource);
    for (let i = 0; i < 3; i++) layers[0]!.handlers.tileerror!.forEach((fn) => fn());
    expect(rawMap.removeLayer).toHaveBeenCalledWith(layers[0]);
    expect(onSource).toHaveBeenLastCalledWith("none");
    expect(layers).toHaveLength(1);
  });

  it("keeps Esri when some tiles loaded before errors", () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const { L, map, layers, rawMap } = fakeLeaflet();
    addBaseLayer(L, map, "k");
    layers[0]!.handlers.tileload!.forEach((fn) => fn());
    for (let i = 0; i < 5; i++) layers[0]!.handlers.tileerror!.forEach((fn) => fn());
    expect(rawMap.removeLayer).not.toHaveBeenCalled();
  });
});
