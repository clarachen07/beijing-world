# Beijing World · 北京世界

**🌐 Live demo: <https://clarachen07.github.io/beijing-world/>** ·
**🎬 Cinematic tour video: <https://clarachen07.github.io/beijing-world/video/beijing-world.mp4>** (1080p/30fps · 105s)

English | [中文](README.zh-CN.md)

A near-real-time 3D virtual simulation of Beijing built entirely from **OpenStreetMap open data** — inspired by Matt Shumer's "Manhattan World".

## ✨ Features

- 🏙️ **Real data**: ~36,000 buildings (real OSM footprints + inferred heights), road network, waterways (moats / Shichahai / Beihai), parks and plazas
- 🏯 **20 procedurally-modeled landmarks** (Blender → glTF): Forbidden City (Taihe Dian, Meridian Gate, corner towers, gates), Temple of Heaven, Tiananmen, Zhengyangmen, Yongdingmen, Drum & Bell Towers, China Zun (528 m), CCTV HQ, Bird's Nest, Water Cube, National Grand Theatre, China World Tower…
- 🌗 **Day / Night**: golden-hour cinematic lighting ↔ night mode (procedural window lights, street lamps, traffic light trails, bloom)
- 🎬 **Four camera modes**: cinematic tour (along the Central Axis: Yongdingmen → Tiananmen → Forbidden City → Jingshan → Olympic Park → CBD), free flight (WASD + QE), first-person street walk, click-a-landmark-to-fly
- 🚗 A living city: instanced traffic on arteries, park trees, street lamps, plaza paving
- ⚡ Pure static site: data is baked to gzipped binaries at build time — zero API calls at runtime
- 📦 **Performance**: Int16 vertex quantization, Service Worker caching (second visit loads in seconds), jsDelivr CDN mirror race for first loads

## 🚀 Run locally

```bash
npm install
npm run fetch:data   # download OSM data (~15 min, resumable)
npm run bake         # bake binaries (buildings/roads/water/green/trees/ground texture)
npm run dev          # http://localhost:5173
```

Build & deploy:

```bash
npm run build        # output in dist/
npm run video        # render frames + encode public/video/beijing-world.mp4 (needs local Chrome)
```

## 🗺️ Data & credits

- Buildings / roads / water / greenery: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL license
- Overpass API: overpass-api.de and public mirrors
- Rendering: [Three.js](https://threejs.org/) · Build: [Vite](https://vitejs.dev/) · Landmark models: Blender
- Inspiration: ["Manhattan World" by @mattshumer_](https://x.com/mattshumer_/status/2095609734845927525)

## 📐 Coverage

Second-Ring old city (Forbidden City / Central Axis / Shichahai / Temple of Heaven) + Guomao CBD + Olympic Park, ~12.8 × 18.3 km.
