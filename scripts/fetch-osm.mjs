/**
 * 北京世界 — OSM 数据下载脚本
 * 从 Overpass API 分块下载北京核心区数据（建筑/道路/水系/绿地/铁路/树木）
 * 输出到 raw/ 目录，供 bake-data.mjs 烘焙为运行时二进制。
 *
 * 全部数据 © OpenStreetMap contributors (ODbL)
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const RAW_DIR = path.resolve(process.cwd(), 'raw');

// 覆盖范围：二环老城 + 国贸CBD + 奥林匹克公园（含少量缓冲）
// south, west, north, east
export const BBOX = { s: 39.865, w: 116.340, n: 40.030, e: 116.480 };

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

const UA = 'beijing-world/1.0 (open-source city visualization; contact: local dev)';

function bboxStr(b) {
  return `${b.s},${b.w},${b.n},${b.e}`;
}

// 建筑下载子块（3×2 = 6 块，避免单次请求过大）
function buildingChunks() {
  const lons = [BBOX.w, 116.3867, 116.4333, BBOX.e];
  const lats = [BBOX.s, 39.9475, BBOX.n];
  const chunks = [];
  for (let i = 0; i < lons.length - 1; i++) {
    for (let j = 0; j < lats.length - 1; j++) {
      chunks.push({ s: lats[j], w: lons[i], n: lats[j + 1], e: lons[i + 1] });
    }
  }
  return chunks;
}

const QUERIES = [
  ...buildingChunks().map((b, i) => ({
    name: `buildings_${i}`,
    body: `[out:json][timeout:900];(way["building"](${bboxStr(b)});way["building:part"](${bboxStr(b)}););out geom qt;`,
    retry: 6,
  })),
  ...buildingChunks().map((b, i) => ({
    name: `roads_${i}`,
    body: `[out:json][timeout:900];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|pedestrian)$"](${bboxStr(b)});out geom qt;`,
    retry: 6,
  })),
  ...buildingChunks().map((b, i) => ({
    name: `water_green_${i}`,
    body: `[out:json][timeout:900];(way["natural"="water"](${bboxStr(b)});relation["natural"="water"](${bboxStr(b)});way["waterway"~"^(river|canal|stream|riverbank|dock)$"](${bboxStr(b)});way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|cemetery)$"](${bboxStr(b)});way["leisure"~"^(park|garden|pitch|golf_course)$"](${bboxStr(b)});relation["leisure"="park"](${bboxStr(b)});way["natural"~"^(wood|scrub|beach)$"](${bboxStr(b)}););out geom qt;`,
    retry: 6,
  })),
  {
    name: 'rail',
    body: `[out:json][timeout:600];way["railway"~"^(rail|light_rail)$"](${bboxStr(BBOX)});out geom qt;`,
    retry: 3,
  },
  {
    name: 'trees',
    body: `[out:json][timeout:300];node["natural"="tree"](${bboxStr(BBOX)});out skel qt;`,
    retry: 2,
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchQuery(query, endpointIdx = 0, attempt = 0) {
  const url = ENDPOINTS[endpointIdx % ENDPOINTS.length];
  console.log(`  → [${query.name}] POST ${new URL(url).host} (attempt ${attempt + 1})`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: 'data=' + encodeURIComponent(query.body),
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    if (res.status === 429 || res.status === 504 || res.status === 502 || res.status === 503) {
      throw new Error(`HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} (fatal)`);
    const text = await res.text();
    const json = JSON.parse(text);
    const n = json.elements?.length ?? 0;
    // Overpass 过载时可能返回 200+空结果 —— 对非截断查询视为失败重试
    if (n === 0 && !query.allowEmpty) throw new Error('空结果（服务器过载）');
    console.log(`  ✓ [${query.name}] ${n} elements, ${(text.length / 1e6).toFixed(1)} MB`);
    return json;
  } catch (err) {
    console.log(`  ✗ [${query.name}] ${err.message}`);
    if (attempt >= query.retry) throw err;
    // 指数退避 + 换镜像
    await sleep(5000 + attempt * 10000);
    return fetchQuery(query, endpointIdx + 1, attempt + 1);
  }
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  const only = process.argv[2]; // 可传单个任务名，如 buildings_3
  const tasks = only ? QUERIES.filter((q) => q.name === only || q.name.startsWith(only)) : QUERIES;
  console.log(`北京世界数据下载：${tasks.length} 个任务，bbox=${bboxStr(BBOX)}`);
  let failed = 0;
  for (const query of tasks) {
    const outFile = path.join(RAW_DIR, `${query.name}.json`);
    if (existsSync(outFile)) {
      try {
        const prev = JSON.parse(await readFile(outFile, 'utf8'));
        console.log(`↷ [${query.name}] 已存在（${prev.elements?.length ?? 0} elements），跳过`);
        continue;
      } catch {
        /* 重新下载 */
      }
    }
    try {
      const json = await fetchQuery(query);
      await writeFile(outFile, JSON.stringify(json));
      console.log(`  💾 raw/${query.name}.json`);
    } catch (err) {
      console.error(`✗✗ [${query.name}] 最终失败: ${err.message}`);
      failed++;
    }
    await sleep(3000); // 礼貌间隔
  }
  console.log(failed ? `完成，${failed} 个任务失败（可重跑 npm run fetch:data 补齐）` : '全部数据下载完成 ✓');
  process.exit(failed ? 1 : 0);
}

main();
