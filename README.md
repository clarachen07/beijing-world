# 北京世界 · Beijing World

**🌐 在线体验：<https://clarachen07.github.io/beijing-world/>** ·
**🎬 漫游视频：<https://clarachen07.github.io/beijing-world/video/beijing-world.mp4>**（1080p/30fps · 105s）

基于 **OpenStreetMap 开放数据**实时构建的北京 3D 虚拟城市 — 灵感来自 Matt Shumer 的 "Manhattan World"。

## ✨ 特性

- 🏙️ **真实数据**：约 3.6 万栋建筑（真实 OSM 轮廓+高度）、道路网、水系（护城河/什刹海/北海）、绿地公园
- 🏯 **17 个程序化地标**：故宫红墙金顶、天坛祈年殿、中国尊（528m）、央视"大裤衩"、鸟巢、水立方、国家大剧院、钟鼓楼、北海白塔……
- 🌗 **昼夜切换**：黄昏金色电影光照 ↔ 夜景（程序化楼宇亮灯、路灯、车流光带、bloom 泛光）
- 🎬 **四种视角**：电影漫游（沿中轴线：永定门→天安门→故宫→景山→钟鼓楼→奥园→CBD）、自由飞行（WASD+QE）、第一人称街景、点击地标自动飞往
- 🚗 活的城市：主干道实例化车流、公园树木、街道路灯
- ⚡ 纯静态站点：数据构建期烘焙为 gzip 二进制，运行时零 API 依赖

## 🚀 本地运行

```bash
npm install
npm run fetch:data   # 下载 OSM 数据（~15 分钟，可断点续传）
npm run bake         # 烘焙二进制
npm run dev          # http://localhost:5173
```

构建与部署：

```bash
npm run build        # 产物在 dist/
npm run video        # 生成 video/frames 帧序列 + public/video/beijing-world.mp4（需本机 Chrome）
```

## 🗺️ 数据与致谢

- 建筑/道路/水系/绿地：© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors，ODbL 许可
- Overpass API：overpass-api.de 及各公共镜像
- 渲染：[Three.js](https://threejs.org/) · 构建：[Vite](https://vitejs.dev/)
- 灵感：[@mattshumer_ 的 Manhattan World](https://x.com/mattshumer_/status/2095609734845927525)

## 📐 覆盖范围

二环老城（故宫/中轴线/什刹海/天坛）+ 国贸 CBD + 奥林匹克公园，约 12.8 × 18.3 km。
