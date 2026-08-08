/**
 * @vercel/kv → store 接口适配器
 * 让 lib/core.js 与测试内存 store 共用同一套方法签名。
 *
 * 注意（2026-08 实测 @vercel/kv@1.0.1 / @upstash/redis@1.25.1）：
 * - kv.get 默认自动 JSON 解析，返回对象而非字符串 → getJSON 需兼容两种形态
 * - kv.scan 返回 [cursor, keys] 数组（非 {cursor, keys} 对象）
 * - kv.hgetall 返回对象（SDK 已转换扁平数组）
 * - kv.set 支持 { nx, ex } 等 Redis 选项（实测 nx 返回 'OK'/null）
 */
import { kv } from '@vercel/kv';

export const kvStore = {
  getJSON: async (k) => {
    const v = await kv.get(k);
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') return v;              // 已被 SDK 自动 JSON 解析
    try { return JSON.parse(v); } catch (e) { return null; }
  },
  setJSON: (k, v) => kv.set(k, JSON.stringify(v)),
  get: (k) => kv.get(k),
  set: (k, v) => kv.set(k, v),
  del: (k) => kv.del(k),
  expire: (k, ttl) => kv.expire(k, ttl),
  setnx: (k, v, ttlSec) => kv.set(k, v, { nx: true, ex: ttlSec }),
  hgetall: (k) => kv.hgetall(k),
  hincrby: (k, f, n) => kv.hincrby(k, f, n),
  lpush: (k, v) => kv.lpush(k, v),
  lrange: (k, s, e) => kv.lrange(k, s, e),
  ltrim: (k, s, e) => kv.ltrim(k, s, e),
  scanKeys: async (pattern, count = 100) => {
    const keys = [];
    let cursor = 0;
    for (;;) {
      const r = await kv.scan(cursor, { match: pattern, count });
      // 实测 @vercel/kv@1.0.1 返回 [cursor, keys] 数组；兼容 {cursor, keys} 对象形态
      const arr = Array.isArray(r) ? r : [r.cursor, r.keys];
      keys.push(...(arr[1] || []));
      cursor = Number(arr[0]) || 0;
      if (!cursor) break;
      if (keys.length > 100000) break;   // 保险上限，防异常循环
    }
    return keys;
  }
};
