import { colors } from '@sibimate/ui-tokens';

export interface MapPoints {
  pickup: { lat: number; lng: number };
  helper: { lat: number; lng: number };
}

/**
 * A small Leaflet map as one HTML page, shown in a web view on phones and an
 * iframe in the browser, so both use the same map. It shows where the helper
 * should come and where the helper is; `moveHelper(lat, lng)` moves the helper.
 * The tile source is set by EXPO_PUBLIC_MAP_TILE_URL and its credit line by
 * EXPO_PUBLIC_MAP_ATTRIBUTION. Without them it uses OpenStreetMap's public
 * tiles, which are fine for development but not for a launched app.
 */
const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = process.env.EXPO_PUBLIC_MAP_ATTRIBUTION ?? '&copy; OpenStreetMap contributors';

export function mapHtml({ pickup, helper }: MapPoints): string {
  const dot = (fill: string, ring: string) =>
    `L.divIcon({className:'',iconSize:[22,22],iconAnchor:[11,11],html:'<div style="width:22px;height:22px;border-radius:50%;box-sizing:border-box;background:${fill};border:4px solid ${ring};box-shadow:0 0 0 1px ${colors.ink}"></div>'})`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#map{height:100%;margin:0;background:${colors.mapGround}}.leaflet-control-attribution{font:11px sans-serif}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var pickup=[${pickup.lat},${pickup.lng}];
var map=L.map('map',{zoomControl:false,attributionControl:true});
L.tileLayer(${JSON.stringify(TILE_URL)},{maxZoom:19,attribution:${JSON.stringify(ATTRIBUTION)}}).addTo(map);
L.marker(pickup,{icon:${dot(colors.brand, colors.surface)},keyboard:false}).addTo(map);
var helper=L.marker([${helper.lat},${helper.lng}],{icon:${dot(colors.accent, colors.ink)},keyboard:false}).addTo(map);
function fit(){map.fitBounds(L.latLngBounds([pickup,helper.getLatLng()]).pad(0.35),{maxZoom:16});}
function moveHelper(lat,lng){helper.setLatLng([lat,lng]);fit();}
fit();
window.addEventListener('message',function(e){var d=e.data;if(d&&typeof d.lat==='number'&&typeof d.lng==='number'){moveHelper(d.lat,d.lng);}});
</script></body></html>`;
}
