/**
 * EdgeOne Pages KV → store 接口适配器
 * 让 lib/core.js 在 EdgeOne Pages Functions 中运行，接口签名与 Vercel 版（lib/kv-store.js）一致。
 *
 * EdgeOne KV 约束与对策：
 * - 命名空间以「全局变量」形式注入函数，变量名 = 控制台绑定命名空间时填写的名称，本项目约定为 lzbzq_kv
 * - 仅提供 put / get / delete / list 四个方法，无 hash / list / setnx / TTL 原语
 *   → hash 与 list 均用「一个 key 存 JSON 字符串」模拟（低流量场景可接受）
 * - key 仅支持数字、字母、下划线 → encodeKey/decodeKey 可逆转换
 *   （: → _c_  - → _h_  . → _p_；现有 key 不含这些序列，转换无歧义）
 * - 无 TTL → expire 为 no-op（voted/settled key 名自带日期，跨天自然失效；
 *   遗留 key 靠 ensureNewDay 的自愈回放容忍）
 */

/* ---------- key 可逆编码（EdgeOne KV key 仅允许 [0-9A-Za-z_]） ---------- */

export function encodeKey(k) {
  return k.replace(/:/g, '_c_').replace(/-/g, '_h_').replace(/\./g, '_p_');
}
export function decodeKey(k) {
  return k.replace(/_p_/g, '.').replace(/_h_/g, '-').replace(/_c_/g, ':');
}

/* ---------- 命名空间访问 ----------
 * EdgeOne Pages 绑定命名空间后，以同名全局变量注入函数运行时。
 * 控制台绑定时变量名必须填 lzbzq_kv。
 */
function ns() {
  const kv = globalThis.lzbzq_kv || globalThis.LZBZQ_KV;
  if (!kv) throw new Error('EdgeOne KV 命名空间未绑定（绑定时变量名需为 lzbzq_kv）');
  return kv;
}

/* ---------- 内部工具 ---------- */

async function getRaw(k) {
  const v = await ns().get(encodeKey(k));
  return v === undefined ? null : v;
}

/** 读取并解析为数组（list 模拟），容错空值与非法 JSON */
async function getList(k) {
  const v = await getRaw(k);
  if (v === null) return [];
  const arr = typeof v === 'object' ? v : safeParse(v);
  return Array.isArray(arr) ? arr : [];
}

/** 读取并解析为对象（hash 模拟），容错空值与非法 JSON */
async function getObject(k) {
  const v = await getRaw(k);
  if (v === null) return null;
  const o = typeof v === 'object' ? v : safeParse(v);
  return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

/** Redis 风格负索引归一化 */
function normIndex(i, len) {
  const n = i < 0 ? len + i : i;
  return Math.max(0, Math.min(n, len));
}

/** 简单 glob 匹配（仅支持 * 通配，与 core.js 内存 store 的 scanKeys 语义一致） */
function matchGlob(pattern, key) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + esc(pattern).replace(/\\\*/g, '.*') + '$');
  return re.test(key);
}

/* ---------- store 接口实现 ---------- */

export const kvStore = {
  async getJSON(k) {
    const v = await getRaw(k);
    if (v === null) return null;
    if (typeof v === 'object') return v;
    return safeParse(v);
  },
  setJSON: (k, v) => ns().put(encodeKey(k), JSON.stringify(v)),
  get: async (k) => {
    const v = await getRaw(k);
    return v === null ? null : String(v);
  },
  set: (k, v) => ns().put(encodeKey(k), String(v)),
  del: (k) => ns().delete(encodeKey(k)),

  /** EdgeOne KV 无 TTL；voted/settled key 名自带日期，跨天自然失效，此处空实现 */
  expire: async () => {},

  /** 模拟 SETNX：先读后写（非原子，存在极小竞态窗口；幂等兜底逻辑 timelineHas 已覆盖最坏情况） */
  async setnx(k, v, ttlSec) {
    const cur = await getRaw(k);
    if (cur !== null) return null;
    await ns().put(encodeKey(k), String(v));
    return 'OK';
  },

  /* ---- hash 模拟（单 key 存 JSON 对象） ---- */
  hgetall: (k) => getObject(k),
  async hincrby(k, field, n) {
    const o = (await getObject(k)) || {};
    o[field] = (parseInt(o[field], 10) || 0) + n;
    await ns().put(encodeKey(k), JSON.stringify(o));
    return o[field];
  },

  /* ---- list 模拟（单 key 存 JSON 数组） ---- */
  async lpush(k, v) {
    const arr = await getList(k);
    arr.unshift(v);
    await ns().put(encodeKey(k), JSON.stringify(arr));
    return arr.length;
  },
  async lrange(k, start, stop) {
    const arr = await getList(k);
    return arr.slice(normIndex(start, arr.length), normIndex(stop, arr.length) + 1);
  },
  async ltrim(k, start, stop) {
    const arr = await getList(k);
    const kept = arr.slice(normIndex(start, arr.length), normIndex(stop, arr.length) + 1);
    await ns().put(encodeKey(k), JSON.stringify(kept));
    return 'OK';
  },

  /* ---- scan 模拟：仅支持「前缀 + 结尾 *」形式（core.js 只用 lzbzq:votes:*） ---- */
  async scanKeys(pattern) {
    const prefix = pattern.replace(/\*$/, '');
    const encPrefix = encodeKey(prefix);
    const keys = [];
    let cursor;
    for (;;) {
      const r = await ns().list({ prefix: encPrefix, limit: 256, ...(cursor ? { cursor } : {}) });
      for (const item of (r && r.keys) || []) {
        const raw = item && item.key !== undefined ? item.key : item;
        const orig = decodeKey(String(raw));
        if (matchGlob(pattern, orig)) keys.push(orig);
      }
      if (!r || r.complete || !r.cursor) break;
      cursor = r.cursor;
      if (keys.length > 100000) break;   // 保险上限，防异常循环
    }
    return keys;
  }
};
