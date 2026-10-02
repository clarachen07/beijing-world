import { gunzip } from './decode';
export interface FetchOptions { signal?: AbortSignal; timeoutMs?: number; priority?: number; mirrors?: boolean }
interface QueueItem { priority: number; signal?: AbortSignal; start: () => void; reject: (error: unknown) => void; cleanup?: () => void }

/** One shared queue for city meshes, models and textures. */
export class AssetQueue {
  private active = 0; private pending: QueueItem[] = [];
  constructor(readonly concurrency = 6) {}
  run<T>(task: () => Promise<T>, options: FetchOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) { reject(options.signal.reason); return; }
      const item: QueueItem = { priority: options.priority ?? 0, signal: options.signal, reject,
        start: () => {
          item.cleanup?.();
          this.active++;
          task().then(resolve, reject).finally(() => { this.active--; this.drain(); });
        } };
      const cancel = () => {
        const index = this.pending.indexOf(item); if (index < 0) return;
        this.pending.splice(index,1); item.cleanup?.(); reject(options.signal?.reason);
      };
      item.cleanup = () => options.signal?.removeEventListener('abort',cancel);
      options.signal?.addEventListener('abort',cancel,{once:true});
      this.pending.push(item); this.pending.sort((a, b) => b.priority - a.priority); this.drain();
    });
  }
  private drain() {
    while (this.active < this.concurrency && this.pending.length) {
      const item = this.pending.shift()!;
      if (item.signal?.aborted) { item.cleanup?.(); item.reject(item.signal.reason); } else item.start();
    }
  }
}
export const assetQueue = new AssetQueue();
const assetRoot = import.meta.env?.VITE_ASSET_BASE?.replace(/\/$/, '') || '';
const revision = typeof __DEPLOY_SHA__ !== 'undefined' ? __DEPLOY_SHA__ : '';
const mirrorBases: string[] = revision ? [
  `https://cdn.jsdelivr.net/gh/clarachen07/beijing-world@${revision}/public`,
  `https://fastly.jsdelivr.net/gh/clarachen07/beijing-world@${revision}/public`,
] : [];

export function assetURL(base: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const clean = path.replace(/^(?:\.\/|\/)+/, '');
  return base ? `${base.replace(/\/$/, '')}/${clean}` : `./${clean}`;
}
export function resolveAsset(path: string): string { return assetURL(assetRoot, path); }

export async function assetDigest(bytes: ArrayBuffer): Promise<string> {
  // LAN HTTP previews on phones do not expose WebCrypto. Keep the same checksum there.
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))
    : (await import('@noble/hashes/sha2.js')).sha256(new Uint8Array(bytes));
  return [...digest].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export async function fetchComplete(url: string, options: FetchOptions = {}): Promise<ArrayBuffer> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const bytes = await response.arrayBuffer();
  const filename = url.split('/').pop()?.split('?')[0] ?? '';
  const hash = filename.match(/^([a-f0-9]{20})\./)?.[1] ?? filename.match(/-([a-f0-9]{10})\.glb$/)?.[1];
  // Some mirrors send .gz with Content-Encoding; the browser has already unpacked it.
  const magic = new Uint8Array(bytes);
  const transportDecoded = filename.endsWith('.gz') && response.headers.has('content-encoding') && !(magic[0] === 31 && magic[1] === 139 && magic[2] === 8);
  if (hash && !transportDecoded) {
    const actual = await assetDigest(bytes);
    if (!actual.startsWith(hash)) {
      if (typeof navigator !== 'undefined') navigator.serviceWorker?.controller?.postMessage({type:'invalidate-asset',url:new URL(url,location.href).href});
      throw new Error(`资源完整性校验失败：${filename}`);
    }
  }
  signal.throwIfAborted(); return bytes;
}
export function fetchAssetBytes(path: string, options: FetchOptions = {}): Promise<ArrayBuffer> {
  return assetQueue.run(async () => {
    const origin = resolveAsset(path);
    const candidates = options.mirrors === false || /^https?:/.test(path) || !import.meta.env?.PROD
      ? [origin] : [origin, ...mirrorBases.map(base => assetURL(base, path))];
    let lastError: unknown;
    for (const url of candidates) {
      options.signal?.throwIfAborted();
      try { return await fetchComplete(url, options); } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason;
        lastError = error;
      }
    }
    throw lastError;
  }, options);
}
export async function fetchAssetJSON<T>(path: string, options: FetchOptions = {}): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await gunzip(await fetchAssetBytes(path, options)))) as T;
}
