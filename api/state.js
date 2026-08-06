import { kvStore } from '../lib/kv-store.js';
import { computeState } from '../lib/core.js';

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'] || '';
  return fwd.split(',')[0].trim() || req.headers['x-real-ip'] || 'unknown';
}

/* 进程内短 TTL 缓存：同一 serverless 实例内的并发轮询合并为一次 KV 读，减免费层配额压力 */
const CACHE_TTL_MS = 2000;
const CACHE_MAX = 100;
const cache = new Map();   // ip -> { data, ts }

function cacheGet(ip) {
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  if (hit) cache.delete(ip);
  return null;
}
function cacheSet(ip, data) {
  if (cache.size >= CACHE_MAX) cache.clear();   // 简单防膨胀
  cache.set(ip, { data, ts: Date.now() });
}

/** 投票成功后调用：清掉该 IP 的缓存，避免 2s 窗口内旧状态（如 votedToday=false） */
export function invalidateCache(ip) {
  cache.delete(ip);
}

export default async function handler(req, res) {
  try {
    const ip = clientIp(req);
    let data = cacheGet(ip);
    if (!data) {
      data = await computeState(kvStore, ip);
      cacheSet(ip, data);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: 'internal' });
  }
}
