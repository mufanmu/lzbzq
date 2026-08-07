/**
 * @vercel/kv → store 接口适配器
 * 让 lib/core.js 与测试内存 store 共用同一套方法签名。
 * 注意：不能用 kv.get(key, {type:'json'})——options 会被当作 Redis 命令参数，
 * 必须手动 JSON.parse。
 */
import { kv } from '@vercel/kv';

export const kvStore = {
  getJSON: async (k) => {
    const v = await kv.get(k);
    if (v === null || v === undefined) return null;
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
      keys.push(...(r.keys || []));
      cursor = Number(r.cursor) || 0;
      if (!cursor) break;
      if (keys.length > 100000) break;   // 保险上限，防异常循环
    }
    return keys;
  }
};
