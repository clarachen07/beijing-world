# 北京世界 · Beijing World

**🌐 在线体验：<https://clarachen07.github.io/beijing-world/>** ·
**🎬 漫游视频：<https://clarachen07.github.io/beijing-world/video/beijing-world.mp4>**（1080p/30fps · 105 秒）

[English](README.md) | 中文

基于 **OpenStreetMap 开放数据**构建的北京 3D 虚拟仿真城市 — 灵感来自 Matt Shumer 的 "Manhattan World"。

## ✨ 特性

- 🏙️ **真实数据**：约 3.6 万栋建筑（真实 OSM 轮廓+高度推断）、道路网、水系（护城河/什刹海/北海）、绿地公园与广场铺装
- 🏯 **20 个程序化精修地标**（Blender → glTF）：故宫（太和殿/午门/角楼/城门）、天坛、天安门、正阳门、永定门、钟鼓楼、中国尊（528m）、央视大楼、鸟巢、水立方、国家大剧院、国贸三期……
- 🌗 **昼夜切换**：黄昏金色电影光照 ↔ 夜景（程序化楼宇亮灯、路灯、车流光带、bloom 泛光）
- 🎬 **四种视角**：电影漫游（沿中轴线：永定门→天安门→故宫→景山→奥园→CBD）、自由飞行（WASD+QE）、第一人称街景、点击地标自动飞往
- 🚗 活的城市：主干道实例化车流、公园树木、街道路灯、广场铺装
- ⚡ 纯静态站点：数据构建期烘焙为 gzip 二进制，运行时零 API 依赖
- 📦 **性能**：顶点 Int16 量化、Service Worker 本地缓存（二次访问秒开）、jsDelivr CDN 镜像竞速加速首载

## 🚀 本地运行

```bash
npm install
npm run fetch:data   # 下载 OSM 数据（~15 分钟，可断点续传）
npm run bake         # 烘焙二进制（建筑/道路/水系/绿地/树木/地面纹理）
npm run dev          # http://localhost:5173
```

构建与部署：

```bash
npm run build        # 产物在 dist/
npm run video        # 渲染帧序列 + 编码 public/video/beijing-world.mp4（需本机 Chrome）
```

## 🗺️ 数据与致谢

- 建筑/道路/水系/绿地：© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors，ODbL 许可
- Overpass API：overpass-api.de 及各公共镜像
- 渲染：[Three.js](https://threejs.org/) · 构建：[Vite](https://vitejs.dev/) · 地标建模：Blender
- 灵感：[@mattshumer_ 的 Manhattan World](https://x.com/mattshumer_/status/2095609734845927525)

## 📐 覆盖范围

二环老城（故宫/中轴线/什刹海/天坛）+ 国贸 CBD + 奥林匹克公园，约 12.8 × 18.3 公里。
