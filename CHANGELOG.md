# Changelog

## 1.0.0 (2026-10-22)

First public release.

- **Live radar (2D):** every aircraft over India from adsb.fi, adsb.lol and OpenSky, merged and dead-reckoned between fixes.
  Aircraft silhouettes by type, altitude-coloured trails, squawk 7500/7600/7700 alerts, shareable URLs, keyboard shortcuts,
  and a 3-hour replay recorded on your device.
- **3D India:** terrain and imagery that sharpen around the camera, live satellite clouds, real sun position.
  Real layouts of 141 Indian airports from OpenStreetMap: runways with ICAO markings, taxiways, aprons, terminals.
- **Followed aircraft:** an articulated A320 with moving landing gear, flaps, spoilers, reversers and lights, driven by
  the live data, in about 20 airline liveries. Chase, cockpit (captain's view) and orbit cameras.
- **Landing and takeoff demos** on Delhi's real runway (`/3d?demo=landing`, `/3d?demo=takeoff`).
- **Airport boards** for 153 airports, flight history (last 30 days), estimated approaches where receivers can't see.
- **Live GPS sharing** from the cabin (`/share`), works in airplane mode and uploads on reconnect.
- Runs entirely on free tiers (Vercel Hobby, Cloudflare Workers Free + D1).
