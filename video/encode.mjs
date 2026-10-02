/**
 * 帧序列 → MP4（ffmpeg-static）
 */
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdir, stat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const FRAME_DIR = path.resolve(process.cwd(), 'artifacts/video/frames');
const LOG_DIR = path.resolve(process.cwd(), 'artifacts/video');
const OUT_DIR = path.resolve(process.cwd(), 'public/video');
const OUT = path.join(OUT_DIR, 'beijing-world.mp4');
const FPS = 30;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(LOG_DIR, { recursive: true });
  if (!(await readdir(FRAME_DIR).catch(()=>[])).some(file=>/^f\d+\.jpg$/.test(file))) throw new Error('No video frames; run video:record first');
  // 两遍编码：目标 6.5 Mbps（105s ≈ 86MB，满足 GH Pages 100MB 限制）
  const BITRATE = '6500k';
  const pass = (p, passNum) => spawn(ffmpegPath, [
    '-y', '-framerate', String(FPS),
    '-i', path.join(FRAME_DIR, 'f%05d.jpg'),
    '-c:v', 'libx264', '-preset', 'slow', '-b:v', BITRATE,
    '-pass', String(passNum), '-passlogfile', path.join(LOG_DIR, 'pass'),
    '-maxrate', '8M', '-bufsize', '16M',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    passNum === 1 ? '-f' : undefined, passNum === 1 ? 'null' : undefined,
    passNum === 1 ? '/dev/null' : OUT,
  ].filter(Boolean), { stdio: ['ignore', 'inherit', 'inherit'] });

  for (const n of [1, 2]) {
    console.log(`ffmpeg 第 ${n} 遍…`);
    const code = await new Promise((res) => pass(n, n).on('close', res));
    if (code !== 0) { console.error(`ffmpeg 退出码 ${code}`); process.exit(1); }
  }
  const s = await stat(OUT);
  for (const file of await readdir(LOG_DIR)) if (file.startsWith('pass')) await rm(path.join(LOG_DIR,file));
  console.log(`✓ 视频已生成 → ${OUT}（${(s.size / 1048576).toFixed(1)} MB）`);
  process.exit(0);
}

main();
