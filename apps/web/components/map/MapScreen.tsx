"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { TabBar, TopNav } from "@/components/ds";
import { hasSession, mapApi, MapApiError, type Me, type WardDetail } from "@/app/map/api";
import {
  ALL_ON,
  bboxParam,
  markerMode,
  MUMBAI_LATLNG,
  mumbaiMinZoom,
  placeHtml,
  placeKinds,
  placeMini,
  showPlace,
  wardAria,
  wardFromHash,
  wardHash,
  wardHtml,
  type ClassMap,
  type Filter,
  type Filters,
  type MapPlace,
  type MapWard,
  type MarkerMode,
} from "./logic";
import { addBaseLayer } from "./tiles";
import { CityView, PlaceView, WardView, type FootState } from "./SheetViews";
import styles from "./MapScreen.module.css";

/**
 * /map, screen 19: every ward's dogs at a glance, vets and NGOs as pins, and
 * a bottom sheet (a 420px left panel from 900px) with the city, a ward or a
 * place. Leaflet is imported here only, lazily, on the client.
 */

const MARKER_CLASSES: ClassMap = {
  ward: styles.ward, sel: styles.sel, n: styles.n, wc: styles.wc, badge: styles.badge, bSos: styles.bSos,
  bHun: styles.bHun, bOk: styles.bOk, dot: styles.dot, dotm: styles.dotm, mini: styles.mini, place: styles.place,
  pin: styles.pin, stem: styles.stem, pVet: styles.pVet, pNgo: styles.pNgo, plus: styles.plus,
};

const START: [number, number] = [19.07, 72.87];
const CITY_FALLBACK: [[number, number], [number, number]] = [
  [18.918, 72.808],
  [19.254, 72.955],
];

type Selection = { type: "ward"; id: string } | { type: "place"; place: MapPlace } | null;

const CHIPS: Array<{ f: Filter; label: string; k: string; icon: React.ReactNode }> = [
  { f: "sos", label: "Needs help", k: styles.kSos, icon: "!" },
  { f: "hungry", label: "Not fed today", k: styles.kHun, icon: <Clock size={12} /> },
  { f: "vet", label: "Vets", k: styles.kVet, icon: "+" },
  { f: "ngo", label: "NGOs", k: styles.kNgo, icon: "N" },
];

export function Clock({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 5v3.2l2 1.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function isWide(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function MapScreen(): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markers = useRef(new Map<string, { m: Leaflet.Marker; html: string }>());
  const placesCache = useRef(new Map<string, MapPlace[]>());
  const pendingHash = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<MarkerMode>("mini");
  const [wards, setWards] = useState<MapWard[] | null>(null);
  const [wardsError, setWardsError] = useState(false);
  const [filters, setFilters] = useState<Filters>(ALL_ON);
  const [selection, setSelection] = useState<Selection>(null);
  const [detail, setDetail] = useState<WardDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [places, setPlaces] = useState<MapPlace[]>([]);
  const [peek, setPeekState] = useState(true);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [foot, setFoot] = useState<FootState>({ kind: "idle" });

  const setPeek = useCallback((p: boolean) => setPeekState(isWide() ? false : p), []);

  // The desktop panel is never a peek; the initial state has to learn that on the client.
  useEffect(() => {
    if (isWide()) setPeekState(false);
  }, []);

  // --- data ---------------------------------------------------------------

  const loadWards = useCallback(() => {
    setWardsError(false);
    mapApi
      .wards()
      .then((d) => setWards(d.wards))
      .catch(() => setWardsError(true));
  }, []);

  useEffect(() => {
    loadWards();
    if (!hasSession()) {
      setMe(null);
      return;
    }
    mapApi
      .me()
      .then(setMe)
      .catch(() => setMe(null));
  }, [loadWards]);

  const selectedWardId = selection?.type === "ward" ? selection.id : null;

  const loadDetail = useCallback((id: string) => {
    setDetailError(false);
    return mapApi
      .ward(id)
      .then((d) => setDetail(d))
      .catch(() => setDetailError(true));
  }, []);

  useEffect(() => {
    setDetail(null);
    if (selectedWardId) void loadDetail(selectedWardId);
  }, [selectedWardId, loadDetail]);

  // --- map ----------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    // Captured once: the cleanup must clear the same Map this effect filled.
    const markerSet = markers.current;
    let map: Leaflet.Map | null = null;
    void import("leaflet").then((mod) => {
      const L = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as unknown as typeof Leaflet);
      if (cancelled || !mapEl.current) return;
      LRef.current = L;
      map = L.map(mapEl.current, {
        zoomControl: false,
        attributionControl: true,
        minZoom: 10,
        zoomSnap: 0.25,
        maxZoom: 15,
        keyboard: true,
        // Mumbai only (see MUMBAI_BOUNDS): hard edges, no bounce past them.
        maxBounds: MUMBAI_LATLNG,
        maxBoundsViscosity: 1,
        worldCopyJump: false,
      }).setView(START, 12);
      const lockZoom = () => {
        const m = map!;
        const wide = isWide();
        const topH = wide ? 0 : (topRef.current?.offsetHeight ?? 0);
        const sh = wide ? 0 : (sheetRef.current?.offsetHeight ?? 0);
        const box = m.getBoundsZoom(L.latLngBounds(MUMBAI_LATLNG), false);
        const city = m.getBoundsZoom(L.latLngBounds(CITY_FALLBACK), false, L.point(56, topH + sh + 48));
        const floor = mumbaiMinZoom(box, city);
        m.setMinZoom(floor);
        // The pan limit is the Mumbai box plus whatever the nav and the sheet
        // cover, so Colaba can sit above the sheet instead of under it. Tiles
        // keep the plain box (tiles.ts), so nothing outside Mumbai is fetched.
        const sw = m.project([MUMBAI_LATLNG[0][0], MUMBAI_LATLNG[0][1]], floor).add([0, sh]);
        const ne = m.project([MUMBAI_LATLNG[1][0], MUMBAI_LATLNG[1][1]], floor).subtract([0, topH]);
        m.setMaxBounds(L.latLngBounds(m.unproject(sw, floor), m.unproject(ne, floor)));
      };
      lockZoom();
      map.on("resize", lockZoom);
      addBaseLayer(L, map, process.env.NEXT_PUBLIC_ESRI_API_KEY);
      L.control.zoom({ position: "topright" }).addTo(map);
      map.on("zoomend", () => setMode(markerMode(map!.getZoom())));
      mapRef.current = map;
      setMode(markerMode(map.getZoom()));
      setReady(true);
    });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markerSet.clear();
    };
  }, []);

  // Measure the nav + chips and the sheet: CSS uses them to keep Leaflet's
  // controls clear of both, and the fly-to uses them to centre in the gap.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      root.style.setProperty("--top-h", `${topRef.current?.offsetHeight ?? 0}px`);
      root.style.setProperty("--sheet-h", `${isWide() ? 0 : (sheetRef.current?.offsetHeight ?? 0)}px`);
      mapRef.current?.invalidateSize();
    });
    if (topRef.current) ro.observe(topRef.current);
    if (sheetRef.current) ro.observe(sheetRef.current);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const visible = useCallback(() => {
    const wide = isWide();
    return {
      topH: wide ? 0 : (topRef.current?.offsetHeight ?? 0),
      sh: wide ? 0 : (sheetRef.current?.offsetHeight ?? 0),
    };
  }, []);

  const fitCity = useCallback(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const { topH, sh } = visible();
    const bounds = wards?.length ? L.latLngBounds(wards.map((w) => [w.lat, w.lng])) : L.latLngBounds(CITY_FALLBACK);
    map.fitBounds(bounds, { paddingTopLeft: [28, topH + 24], paddingBottomRight: [28, sh + 24], animate: false });
  }, [visible, wards]);

  const flyTo = useCallback(
    (lat: number, lng: number) => {
      const map = mapRef.current;
      if (!map) return;
      const z = Math.max(map.getZoom(), 13);
      const { topH, sh } = visible();
      const H = map.getSize().y;
      const visC = (topH + (H - sh)) / 2;
      const pt = map.project([lat, lng], z).add([0, H / 2 - visC]);
      const target = map.unproject(pt, z);
      if (reducedMotion()) map.setView(target, z, { animate: false });
      else map.flyTo(target, z, { duration: 0.4 });
    },
    [visible],
  );

  const select = useCallback(
    (next: Selection) => {
      setSelection(next);
      setFoot({ kind: "idle" });
      if (!next) {
        setPeek(true);
        if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
        window.setTimeout(fitCity, 260);
        return;
      }
      setPeek(false);
      if (next.type === "ward") {
        const w = wards?.find((x) => x.id === next.id);
        if (w) {
          history.replaceState(null, "", wardHash(w.code));
          window.setTimeout(() => flyTo(w.lat, w.lng), 260);
        }
      } else {
        window.setTimeout(() => flyTo(next.place.lat, next.place.lng), 260);
      }
    },
    [fitCity, flyTo, setPeek, wards],
  );

  // First fit, and the #ward=K%2FW deep link, once the map and the wards exist.
  const didFit = useRef(false);
  useEffect(() => {
    if (!ready || didFit.current || (!wards && !wardsError)) return;
    didFit.current = true;
    requestAnimationFrame(fitCity);
    pendingHash.current = wardFromHash(window.location.hash);
  }, [ready, wards, wardsError, fitCity]);

  useEffect(() => {
    if (!ready || !wards) return;
    const openHash = (code: string | null) => {
      const w = code ? wards.find((x) => x.code === code || x.id === code) : null;
      if (w) window.setTimeout(() => select({ type: "ward", id: w.id }), 300);
    };
    if (pendingHash.current) {
      openHash(pendingHash.current);
      pendingHash.current = null;
    }
    const onHash = () => {
      const code = wardFromHash(window.location.hash);
      if (code && code !== (wards.find((w) => w.id === selectedWardId)?.code ?? null)) openHash(code);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [ready, wards, select, selectedWardId]);

  useEffect(() => {
    const onResize = () => {
      if (isWide()) setPeekState(false);
      if (!selection) fitCity();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitCity, selection]);

  // --- places (pins) ------------------------------------------------------

  const onlyPlaces = !filters.sos && !filters.hungry;
  const wantPlaces = (mode === "full" || onlyPlaces) && placeKinds(filters).fetch;

  const fetchPlaces = useCallback(() => {
    const map = mapRef.current;
    if (!map || !wantPlaces) return;
    const b = map.getBounds();
    const box = bboxParam({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    const { kind } = placeKinds(filters);
    const key = `${box}:${kind ?? ""}`;
    const hit = placesCache.current.get(key);
    if (hit) {
      setPlaces(hit);
      return;
    }
    mapApi
      .places(box, kind)
      .then((d) => {
        placesCache.current.set(key, d.places);
        setPlaces(d.places);
      })
      .catch(() => undefined); // Pins are a bonus; the map stays usable without them.
  }, [filters, wantPlaces]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    fetchPlaces();
    let t: number | undefined;
    const onMove = () => {
      window.clearTimeout(t);
      t = window.setTimeout(fetchPlaces, 250);
    };
    map.on("moveend", onMove);
    return () => {
      window.clearTimeout(t);
      map.off("moveend", onMove);
    };
  }, [ready, fetchPlaces]);

  // --- markers ------------------------------------------------------------

  const nearbyPins = useMemo(
    () => (detail?.nearby ?? []).filter((p) => p.geoPrecision !== "locality"),
    [detail],
  );

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    const zoom = map.getZoom();
    const selId = selection?.type === "place" ? selection.place.id : null;
    const nearbyIds = new Set(nearbyPins.map((p) => p.id));
    const want = new Map<string, { lat: number; lng: number; html: string; label: string; z: number; onSelect: () => void }>();

    for (const w of wards ?? []) {
      // A ward with no collared dogs and no case has nothing to say, and its
      // "All fed" tick would be a claim about dogs that are not there.
      if (w.dogs === 0 && w.sosOpen === 0 && selectedWardId !== w.id) continue;
      want.set(`w:${w.id}`, {
        lat: w.lat,
        lng: w.lng,
        html: wardHtml(w, mode, filters, selectedWardId === w.id, MARKER_CLASSES),
        label: wardAria(w, mode, filters),
        z: (w.sosOpen ? 500 : 0) + (selectedWardId === w.id ? 1000 : 0),
        onSelect: () => select({ type: "ward", id: w.id }),
      });
    }
    const allPlaces = new Map<string, MapPlace>();
    for (const p of [...places, ...nearbyPins]) allPlaces.set(p.id, p);
    if (selection?.type === "place") allPlaces.set(selection.place.id, selection.place);
    for (const p of allPlaces.values()) {
      if (!showPlace(p, zoom, filters, selId, nearbyIds)) continue;
      want.set(`p:${p.id}`, {
        lat: p.lat,
        lng: p.lng,
        html: placeHtml(p, placeMini(zoom), selId === p.id, MARKER_CLASSES),
        label: p.name,
        z: 300 + (selId === p.id ? 1000 : 0),
        onSelect: () => select({ type: "place", place: p }),
      });
    }

    const active = document.activeElement;
    let refocus: string | null = null;
    for (const [key, { m }] of markers.current) {
      if (!want.has(key)) {
        if (m.getElement() === active) refocus = null;
        map.removeLayer(m);
        markers.current.delete(key);
      }
    }
    for (const [key, spec] of want) {
      const existing = markers.current.get(key);
      const icon = L.divIcon({ className: styles.icon, html: spec.html, iconSize: [0, 0] });
      let m: Leaflet.Marker;
      if (existing) {
        m = existing.m;
        if (existing.html !== spec.html) {
          if (m.getElement() === active) refocus = key;
          m.setIcon(icon);
          existing.html = spec.html;
        }
        m.setZIndexOffset(spec.z);
        m.off("click");
      } else {
        m = L.marker([spec.lat, spec.lng], { icon, zIndexOffset: spec.z, keyboard: true, title: "" }).addTo(map);
        markers.current.set(key, { m, html: spec.html });
      }
      m.on("click", spec.onSelect);
      const el = m.getElement();
      if (el) {
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", spec.label);
        el.removeAttribute("title");
        el.tabIndex = 0;
        el.onkeydown = (e) => {
          // Enter and Space both activate, as on any role=button. preventDefault
          // also stops Leaflet's own keypress handler firing a second click.
          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
            e.preventDefault();
            spec.onSelect();
          }
        };
      }
      if (refocus === key) el?.focus();
    }
  }, [ready, wards, places, nearbyPins, filters, mode, selection, selectedWardId, select]);

  // --- actions ------------------------------------------------------------

  const loginHref = useCallback((code: string | null) => {
    const back = code ? `/map${wardHash(code)}` : "/map";
    return `/login?next=${encodeURIComponent(back)}`;
  }, []);

  const onHelp = useCallback(async () => {
    if (!detail) return;
    if (!hasSession() || me === null) {
      setFoot({ kind: "needSignIn" });
      return;
    }
    if (detail.sos.some((s) => s.mine)) {
      setFoot({ kind: "acked" });
      return;
    }
    const claimable = detail.sos.find((s) => s.caseId && s.state !== "acked");
    if (!claimable?.caseId) {
      if (!detail.viewer) setFoot({ kind: "needSignIn" });
      else setFoot({ kind: "notResponder", viewer: detail.viewer, severity: detail.sos[0]?.severity ?? "serious" });
      return;
    }
    setFoot({ kind: "busy" });
    try {
      await mapApi.ack(claimable.caseId);
      setFoot({ kind: "acked" });
      void loadDetail(detail.id);
    } catch (e) {
      if (e instanceof MapApiError && e.code === "SOS_ALREADY_ACKED") setFoot({ kind: "taken" });
      else if (e instanceof MapApiError && e.status === 401) setFoot({ kind: "needSignIn" });
      else setFoot({ kind: "error" });
    }
  }, [detail, me, loadDetail]);

  const onAlerts = useCallback(async () => {
    if (!detail) return;
    if (!hasSession() || me === null) {
      window.location.assign(loginHref(detail.code));
      return;
    }
    setFoot({ kind: "busy" });
    try {
      await mapApi.alerts(detail.id);
      setMe((m) => (m ? { ...m, homeWard: detail.id, sosOptIn: true } : m));
      setFoot({ kind: "alertsOn" });
    } catch (e) {
      if (e instanceof MapApiError && e.status === 401) window.location.assign(loginHref(detail.code));
      else setFoot({ kind: "error" });
    }
  }, [detail, me, loginHref]);

  // --- render -------------------------------------------------------------

  const toggle = (f: Filter) => setFilters((cur) => ({ ...cur, [f]: !cur[f] }));
  const selectedWard = selectedWardId ? (wards?.find((w) => w.id === selectedWardId) ?? null) : null;

  let view: React.ReactNode;
  if (selection?.type === "place") {
    view = <PlaceView place={selection.place} onBack={() => select(null)} />;
  } else if (selectedWard) {
    view = (
      <WardView
        ward={selectedWard}
        detail={detail}
        detailError={detailError}
        foot={foot}
        me={me}
        loginHref={loginHref(selectedWard.code)}
        onBack={() => select(null)}
        onHelp={onHelp}
        onAlerts={onAlerts}
        onRetry={() => void loadDetail(selectedWard.id)}
        onDismiss={() => setFoot({ kind: "idle" })}
      />
    );
  } else {
    view = (
      <CityView
        wards={wards}
        error={wardsError}
        peek={peek}
        onRetry={loadWards}
        onWard={(id) => select({ type: "ward", id })}
      />
    );
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.map} ref={mapEl} aria-label="Map of Mumbai wards" role="region" />
      <div className={styles.aurora} aria-hidden="true" />

      <div className={styles.top} ref={topRef}>
        <TopNav
          layout="mobile"
          sticky={false}
          links={[]}
          className={styles.nav}
          signInHref={me ? "/me" : loginHref(selectedWard?.code ?? null)}
          signInLabel={me ? me.displayName : "Sign in"}
        />
        <div className={styles.chips} role="toolbar" aria-label="Show on map">
          {CHIPS.map((c) => (
            <button
              key={c.f}
              type="button"
              className={styles.chip}
              aria-pressed={filters[c.f]}
              onClick={() => toggle(c.f)}
            >
              <span className={`${styles.k} ${c.k}`} aria-hidden="true">
                {c.icon}
              </span>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <section
        className={[styles.sheet, peek ? styles.peek : ""].filter(Boolean).join(" ")}
        ref={sheetRef}
        aria-label="Map details"
      >
        <button
          type="button"
          className={styles.grab}
          aria-label={peek ? "Show more" : "Show less"}
          aria-expanded={!peek}
          onClick={() => setPeek(!peek)}
        />
        {view}
        <TabBar position="static" active="map" className={styles.tabs} />
      </section>
    </div>
  );
}
