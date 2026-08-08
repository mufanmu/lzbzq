/**
 * Upstash Redis REST 客户端（零依赖，Node 18+ 内置 fetch）
 * 凭据从环境变量读取：KV_REST_API_URL / KV_REST_API_TOKEN
 * 供 scripts/kv-diag.mjs（只读）与 scripts/backfill.mjs（补偿）共用。
 */
const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;

export function requireCreds() {
  if (!url || !token) {
    console.error('缺少环境变量：KV_REST_API_URL / KV_REST_API_TOKEN');
    process.exit(2);
  }
  return { url, token };
}

/**
 * 解包 Upstash /pipeline 响应元素。
 * 实测（2026-08 生产 KV）单命令 pipeline 响应为 [{ result: <value> }, ...]，
 * 兼容旧格式 [["result", <value>], ...]。
 */
function unwrap(item) {
  if (item && typeof item === 'object' && 'result' in item) return item.result;
  if (Array.isArray(item) && item[0] === 'result') return item[1];
  return item;
}

/** 单命令执行，返回该命令的结果 */
export async function redis(cmd, ...args) {
  const { url, token } = requireCreds();
  const res = await fetch(url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify([[cmd, ...args]])
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
  const data = await res.json();
  return unwrap(Array.isArray(data) ? data[0] : data);
}

/** 批量命令（原子 pipeline），返回与输入顺序一致的结果数组 */
export async function redisBatch(commands) {
  const { url, token } = requireCreds();
  const res = await fetch(url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));
  const data = await res.json();
  return data.map(unwrap);
}

/** 分页 SCAN 收集匹配的 key（只读） */
export async function redisScan(pattern, count = 200) {
  let cursor = '0';
  const keys = [];
  for (;;) {
    // Redis 返回 [cursor, [keys...]]
    const r = await redis('SCAN', cursor, 'MATCH', pattern, 'COUNT', String(count));
    cursor = String(r[0]);
    keys.push(...(r[1] || []));
    if (cursor === '0' || keys.length > 10000) break;
  }
  return keys;
}
