/**
 * EdgeOne Pages Function：POST /api/migrate（一次性数据迁移，迁移完成后删除本文件）
 *
 * 用法：curl -X POST 'https://<域名>/api/migrate' \
 *        -H 'Content-Type: application/json' \
 *        --data-binary @backup/backup-xxx.json
 *
 * 幂等保护：lzbzq:state 已存在时返回 409（加 ?force=1 可强制覆盖）
 * 兼容 scripts/backup.mjs 的导出格式：
 *   state     字符串（Redis GET 原始值）
 *   timeline  JSON 字符串数组（最新在前）
 *   events    JSON 字符串数组（最新在前）
 *   votes     { key: [field,count,...] 扁平数组 或 {field: count} 对象 }（HGETALL 两种形态）
 *   votedKeys 已投票 key 列表（值统一为 "1"）
 */
import { kvStore } from '../../lib/eo-kv-store.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/** HGETALL 两种形态 → { field: count } 对象 */
function normalizeHash(h) {
  if (!h) return {};
  if (Array.isArray(h)) {
    const o = {};
    for (let i = 0; i + 1 < h.length; i += 2) o[h[i]] = Number(h[i + 1]) || 0;
    return o;
  }
  const o = {};
  for (const [k, v] of Object.entries(h)) o[k] = Number(v) || 0;
  return o;
}

export async function onRequest({ request }) {
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get('force') === '1';

    if (!force && (await kvStore.get('lzbzq:state')) !== null) {
      return json({ ok: false, reason: 'already', hint: '已存在数据，如需覆盖请加 ?force=1' }, 409);
    }

    const data = await request.json();
    const summary = { timeline: 0, events: 0, votesKeys: 0, votedKeys: 0 };

    if (typeof data.state === 'string' && data.state) {
      JSON.parse(data.state);                       // 校验合法性
      await kvStore.set('lzbzq:state', data.state);
    }
    if (Array.isArray(data.timeline)) {
      await kvStore.set('lzbzq:timeline', JSON.stringify(data.timeline));
      summary.timeline = data.timeline.length;
    }
    if (Array.isArray(data.events)) {
      await kvStore.set('lzbzq:events', JSON.stringify(data.events));
      summary.events = data.events.length;
    }
    if (data.votes && typeof data.votes === 'object') {
      for (const [key, hash] of Object.entries(data.votes)) {
        await kvStore.setJSON(key, normalizeHash(hash));
        summary.votesKeys++;
      }
    }
    if (Array.isArray(data.votedKeys)) {
      for (const key of data.votedKeys) {
        await kvStore.set(key, '1');
        summary.votedKeys++;
      }
    }
    return json({ ok: true, summary });
  } catch (e) {
    return json({ ok: false, error: 'internal', message: String(e && e.message || e) }, 500);
  }
}
