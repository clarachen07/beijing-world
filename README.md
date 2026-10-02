# Beijing World

A static Three.js view of Beijing inside its verified Fourth Ring Road and a 500 m visual buffer, with an Olympic Park extension. Real OSM/Overture footprints, inferred heights with feature-level provenance, Sentinel surface imagery, filtered Copernicus DSM terrain, and reference-informed Blender landmarks.

[中文使用说明](README.zh-CN.md) · [Architecture](docs/architecture.md) · [Acceptance report](docs/acceptance.md)

Use Node.js 22.12 or newer for the complete workflow, including browser checks. Vite alone also supports Node.js 20.19 or newer.

```sh
npm ci
npm run dev
```

Start with controllable aerial browsing. Left drag pans, right drag rotates, wheel zooms; touch supports one-finger pan and two-finger zoom/rotate. Fly, walk and a finite cinematic tour are explicit modes. Manual input adopts the complete camera pose; blur clears input. Walking requires loaded collision and terrain.

```sh
npm run check
npm run preview
BJW_URL=http://localhost:4173 npm run check:browser
BJW_URL=http://localhost:4173 npm run check:performance
```

Production builds use existing static resources and require neither geographic downloads nor Blender. Independent data and model production steps are documented in the Chinese README. The release remains local until explicitly published. Browser mobile emulation does not establish physical iOS/Android performance or network access from China.

The release includes a separate `qa.html` page for physical phone measurements and local JSON export. See [mobile testing instructions](docs/mobile-testing.md).

Attribution: © OpenStreetMap contributors, ODbL; Overture Buildings and original feature sources; modified Copernicus Sentinel data 2026; Copernicus DEM under its free/open licence. Official photos/drawings inform landmark shapes; published PBR textures are original procedural bakes. Height inference and geographic precision limits are documented with the assets.
