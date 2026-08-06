/**
 * @vercel/kv → store 接口适配器
 * 让 lib/core.js 与测试内存 store 共用同一套方法签名。
 */
import { kv } from '@vercel/kv';

export const kvStore = {
  getJSON: (k) => kv.get(k, { type: 'json' }),
  setJSON: (k, v) => kv.set(k, v),
  get: (k) => kv.get(k),
  set: (k, v) => kv.set(k, v),
  del: (k) => kv.del(k),
  expire: (k, ttl) => kv.expire(k, ttl),
  hgetall: (k) => kv.hgetall(k),
  hincrby: (k, f, n) => kv.hincrby(k, f, n),
  lpush: (k, v) => kv.lpush(k, v),
  lrange: (k, s, e) => kv.lrange(k, s, e),
  ltrim: (k, s, e) => kv.ltrim(k, s, e)
};
