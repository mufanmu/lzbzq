import { kvStore } from '../lib/kv-store.js';
import { computeState } from '../lib/core.js';

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'] || '';
  return fwd.split(',')[0].trim() || req.headers['x-real-ip'] || 'unknown';
}

export default async function handler(req, res) {
  try {
    const data = await computeState(kvStore, clientIp(req));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: 'internal' });
  }
}
