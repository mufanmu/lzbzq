/**
 * EdgeOne Pages Function：POST /api/vote
 * 行为与 Vercel 版 api/vote.js 一致（409 已投过 / 400 参数无效 / 500 内部错误）
 */
import { kvStore } from '../../lib/eo-kv-store.js';
import { computeState, submitVote } from '../../lib/core.js';
import { invalidateCache } from './state.js';

function clientIp(request) {
  const eo = request.eo || {};
  if (eo.clientIp) return eo.clientIp;
  const fwd = request.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export async function onRequest({ request }) {
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  try {
    const ip = clientIp(request);
    const body = await request.json().catch(() => ({}));
    const result = await submitVote(kvStore, ip, body.value);
    invalidateCache(ip);   // 让 /api/state 进程内缓存立即反映投票结果
    const state = await computeState(kvStore, ip);
    if (!result.ok) {
      return json({ ok: false, reason: result.reason, state }, result.reason === 'already' ? 409 : 400);
    }
    return json({ ok: true, state });
  } catch (e) {
    return json({ error: 'internal' }, 500);
  }
}
