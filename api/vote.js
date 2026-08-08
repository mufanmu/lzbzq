import { kvStore } from '../lib/kv-store.js';
import { computeState, submitVote } from '../lib/core.js';
import { invalidateCache } from './state.js';

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'] || '';
  return fwd.split(',')[0].trim() || req.headers['x-real-ip'] || 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const result = await submitVote(kvStore, clientIp(req), body.value);
    invalidateCache(clientIp(req));   // 让 /api/state 进程内缓存立即反映投票结果
    const state = await computeState(kvStore, clientIp(req));
    if (!result.ok) {
      return res.status(result.reason === 'already' ? 409 : 400).json({ ok: false, reason: result.reason, state });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, state });
  } catch (e) {
    res.status(500).json({ error: 'internal' });
  }
}
