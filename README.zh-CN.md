# 北京世界 · Beijing World

以真实开放轮廓构建四环内及外围500米缓冲，保留奥林匹克公园扩展。默认进入故宫鸟瞰，可切换自由飞行、电影漫游与街景漫步。普通建筑缺失高度与立面采用有来源的推断；地标根据图纸、官方尺寸和照片重建。这不是全城街景级摄影测量。

[在线体验](https://clarachen07.github.io/beijing-world/) · [发布记录](docs/deployment.md) · [English](README.md) · [架构与数据生产](docs/architecture.md) · [本轮验收报告](docs/acceptance.md)

## 本地体验

完整开发与浏览器验证需要 Node.js 22.12 或更高版本；仅运行 Vite 也支持 Node.js 20.19 或更高版本。

```sh
npm ci
npm run dev
```

现有静态城市和模型已经包含在项目中；日常运行及网站构建无需重新下载或建模。

```sh
npm run check
npm run preview -- --host 127.0.0.1
BJW_URL=http://localhost:4173 npm run check:browser
BJW_URL=http://localhost:4173 npm run check:performance
```

浏览器验证使用现有 Chrome，可通过 `CHROME_PATH` 指定位置；`BJW_PROFILE=mobile` 是 Chrome 触控和视口模拟，不能证明手机 GPU 或 Safari 达标。完整性能流程需数分钟。

真实手机可以打开发布包内的 `qa.html`，记录设备和网络、连续路线及人工交互结果，并导出 JSON。连接方法见[手机实测说明](docs/mobile-testing.md)。

## 更新城市数据

```sh
python3.12 -m venv .venv-data
.venv-data/bin/pip install -r requirements-data.txt
npm run fetch:data
npm run bake
npm run check:data
```

数据环境需要 Python 3.12 或更高版本。数据快照、哈希及必需分片清单存于 `raw/geospatial/`。Overture 与 Sentinel 使用配置中的固定版本；BBBike 的首次 OSM 下载取当期快照，精确重烘焙使用本地保留的快照和哈希。Sentinel 为10米影像，Copernicus为30米DSM。缺片或范围内必需几何缺失会停止，数据生产不属于网站发布构建。

## 更新地标

`config/landmarks.json` 是位置、尺寸、标签、覆盖轮廓、OSM替代ID、模型细节档和来源的唯一注册表。所有 Blender 源资产位于 `assets-source/blend/`，原创材质位于 `assets-source/textures/`。

完整重建29份模型需要保留本轮 `raw/geospatial/osm.geojson` 和 `raw/geospatial/landmark-elevations.json`；这些本地快照不纳入 Git。缺少快照的新检出可以直接使用已保存的 Blender/GLB，不能把重新下载的当期地图当作本轮相同输入。注册表生成步骤保留鸟巢、水立方的工程来源及鸟巢朝向依据；照片索引只核对逐文件元数据，实际像素查看范围另记在地标资料中。

```sh
npm run models:build
npm run check:models
```

完整模型生产会依次生成注册表、Blender源文件、细节档和碰撞代理、压缩材质、内容哈希、来源记录与校验，最后拍摄样板。建模需 Blender，默认采用本机应用路径，其他系统可设置 `BLENDER_BIN`。压缩需要官方 [KTX-Software 4.4.2](https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2) 的 `toktx`；放入 `tools/bin/` 或设置 `TOKTX`。网站运行只需已导出的 GLB 和随项目附带的 Basis 解码器。

## 发布包与视频

`npm run build` 生成 `dist/`，包含资源哈希、来源页面和独立发布版本的离线缓存。沿用 GitHub Pages 目标；本轮发布包已上线；发布提交及线上检查见发布记录。`VITE_ASSET_BASE` 可指定静态资源根；源码镜像使用同一提交的 `public/` 路径，工作区有未提交变更时默认禁用旧提交回退。

`npm run video` 先捕获确定性帧再编码，临时文件在 `artifacts/video/`；现有视频继续保留，内容属于上一版，未声称是本轮模型的新演示。旧 `dist/` 的部署 Git 仓库已迁至 `.deployment/gh-pages/`，保留完整历史。

## 资料与许可

© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) / ODbL；[Overture Buildings](https://docs.overturemaps.org/guides/buildings/) 及原始特征来源随数据保留；Contains modified Copernicus Sentinel data 2026；Copernicus DEM 根据免费开放许可处理。地标官方图纸和照片用于考证，发布贴图使用原创烘焙材质。详细快照、许可及精度边界见站内 `sources.html` 和参考清单。
