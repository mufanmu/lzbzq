/**
 * EdgeOne Pages Function：GET /api/state
 * 行为与 Vercel 版 api/state.js 一致（含进程内 2s 短缓存，缓解轮询压力）
 */
import { kvStore } from '../../lib/eo-kv-store.js';
import { computeState } from '../../lib/core.js';

function clientIp(request) {
  // EdgeOne 注入真实客户端 IP；兜底取转发头
  const eo = request.eo || {};
  if (eo.clientIp) return eo.clientIp;
  const fwd = request.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}

/* 进程内短 TTL 缓存：同一边缘实例内的并发轮询合并为一次 KV 读 */
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export async function onRequest({ request }) {
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  try {
    const ip = clientIp(request);
    let data = cacheGet(ip);
    if (!data) {
      data = await computeState(kvStore, ip);
      cacheSet(ip, data);
    }
    return json(data);
  } catch (e) {
    return json({ error: 'internal' }, 500);
  }
}
