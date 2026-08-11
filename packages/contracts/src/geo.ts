export const GEO_MAX_DECIMALS = 2;

export function truncateTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.trunc(value * factor) / factor;
}

export function coarsenToWard(lat: number, lng: number): { lat: number; lng: number } {
  return {
    lat: truncateTo(lat, GEO_MAX_DECIMALS),
    lng: truncateTo(lng, GEO_MAX_DECIMALS),
  };
}

export function coarsenToCell(lat: number, lng: number, sizeM = 500): { lat: number; lng: number } {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = metersPerDegLat * Math.cos((lat * Math.PI) / 180);
  const latSizeDeg = sizeM / metersPerDegLat;
  const lngSizeDeg = sizeM / metersPerDegLng;
  const latCell = Math.floor(lat / latSizeDeg) * latSizeDeg;
  const lngCell = Math.floor(lng / lngSizeDeg) * lngSizeDeg;
  return {
    lat: truncateTo(latCell, GEO_MAX_DECIMALS),
    lng: truncateTo(lngCell, GEO_MAX_DECIMALS),
  };
}
