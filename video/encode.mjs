/**
 * 帧序列 → MP4（ffmpeg-static）
 */
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FRAME_DIR = path.resolve(process.cwd(), 'video/frames');
const OUT_DIR = path.resolve(process.cwd(), 'public/video');
const OUT = path.join(OUT_DIR, 'beijing-world.mp4');
const FPS = 30;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const args = [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(FRAME_DIR, 'f%05d.jpg'),
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    OUT,
  ];
  console.log('ffmpeg 编码中…');
  const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('close', async (code) => {
    if (code !== 0) { console.error(`ffmpeg 退出码 ${code}`); process.exit(1); }
    const s = await stat(OUT);
    console.log(`✓ 视频已生成 → ${OUT}（${(s.size / 1048576).toFixed(1)} MB）`);
    // 同步到 dist（如已构建）
    process.exit(0);
  });
}

main();
