'use client';
import { useEffect, useRef, useState } from 'react';
import type { DealDetail } from '@qafila/shared';
import { Card, CardBody } from '@/components/ui/card';
import 'maplibre-gl/dist/maplibre-gl.css';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/** Points along a great circle so the sea route reads as a curve, not a ruler line. */
function arc(a: [number, number], b: [number, number], n = 48): [number, number][] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const [lon1, lat1] = [toRad(a[0]), toRad(a[1])];
  const [lon2, lat2] = [toRad(b[0]), toRad(b[1])];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
  if (d === 0) return [a, b];
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return pts;
}

/** The route as a dark glass panel: the light basemap is inverted on the canvas, markers are teal and saffron. */
export function RouteMap({ route, vessel }: { route: DealDetail['route']; vessel?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const o = route.originLngLat;
  const d = route.destinationLngLat;

  useEffect(() => {
    if (!ref.current || !o || !d) return;
    let map: import('maplibre-gl').Map | null = null;
    let cancelled = false;
    (async () => {
      try {
        const maplibre = await import('maplibre-gl');
        // The worker ships as a static file: the bundler's chunk URL for maplibre's module worker fails in production.
        maplibre.setWorkerUrl('/maplibre-gl-worker.mjs');
        if (cancelled || !ref.current) return;
        map = new maplibre.Map({ container: ref.current, style: STYLE_URL, interactive: true, attributionControl: { compact: true }, cooperativeGestures: true });
        map.on('error', () => setFailed(true));
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
        const line = arc(o, d);
        map.on('load', () => {
          if (!map) return;
          map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } } });
          // The canvas is colour-inverted by CSS, so the line is drawn in the inverse of teal.
          map.addLayer({ id: 'route-glow', type: 'line', source: 'route', paint: { 'line-color': '#d21d3c', 'line-width': 8, 'line-opacity': 0.25, 'line-blur': 6 } });
          map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#d21d3c', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
          const mk = (ll: [number, number], label: string, accent: boolean) => {
            const el = document.createElement('div');
            el.className = 'flex items-center gap-1.5';
            const color = accent ? '#f2b23e' : '#2de2c3';
            el.innerHTML = `<span style="width:10px;height:10px;border-radius:9999px;background:${color};box-shadow:0 0 0 3px #0e1322,0 0 14px ${color}"></span><span style="font:600 11px/1 var(--font-jetbrains),ui-monospace,monospace;color:#eef2ff;background:rgba(14,19,34,.9);border:1px solid rgba(255,255,255,.14);padding:4px 7px;border-radius:999px;white-space:nowrap">${label}</span>`;
            new maplibre.Marker({ element: el, anchor: 'left' }).setLngLat(ll).addTo(map!);
          };
          mk(o, route.originPort, false);
          mk(d, route.destinationPort, true);
          const b = new maplibre.LngLatBounds(o, o);
          for (const p of line) b.extend(p);
          map.fitBounds(b, { padding: { top: 40, bottom: 40, left: 60, right: 120 }, duration: 0, maxZoom: 5 });
        });
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [o, d, route.originPort, route.destinationPort]);

  if (!o || !d || failed) {
    return (
      <Card>
        <CardBody className="text-sm">
          <p className="eyebrow">Route</p>
          <p className="mt-1 font-medium">
            {route.originPort}, {route.originCountry} to {route.destinationPort}, {route.destinationCountry}
          </p>
          {vessel ? <p className="text-ink-muted">Vessel {vessel}</p> : null}
          {failed ? <p className="mt-1 text-xs text-ink-muted">The map tiles could not load.</p> : null}
        </CardBody>
      </Card>
    );
  }
  return (
    <div className="glass hairline-top relative overflow-hidden rounded-card">
      <div ref={ref} className="route-map h-64 w-full sm:h-72" aria-label={`Map of the route from ${route.originPort} to ${route.destinationPort}`} />
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-card shadow-[inset_0_0_60px_rgba(7,10,18,0.7)]" />
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-full border border-line bg-surface/90 px-2.5 py-1 font-mono text-[11px] text-ink-muted backdrop-blur">
        {route.originPort} to {route.destinationPort}
        {vessel ? ` · ${vessel}` : ''}
      </div>
    </div>
  );
}
