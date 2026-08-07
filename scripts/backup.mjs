#!/usr/bin/env node
/**
 * 生产 KV 只读备份：把 state / timeline / votes / events / voted 全部导出到 backup/ 目录
 * 用法：KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/backup.mjs
 * （backup/ 已在 .gitignore 中排除，避免凭据/数据进仓库）
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { redis, redisScan, requireCreds } from './upstash.mjs';

async function main() {
  requireCreds();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync('backup', { recursive: true });

  const data = {};
  data.state = await redis('GET', 'lzbzq:state');
  data.timeline = await redis('LRANGE', 'lzbzq:timeline', '0', '-1');
  data.events = await redis('LRANGE', 'lzbzq:events', '0', '-1');
  const voteKeys = (await redisScan('lzbzq:votes:*')).sort();
  data.votes = {};
  for (const k of voteKeys) data.votes[k] = await redis('HGETALL', k);
  data.votedKeys = (await redisScan('lzbzq:voted:*')).sort();

  const file = 'backup/backup-' + ts + '.json';
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log('已备份到', file);
  console.log('  state        :', data.state);
  console.log('  timeline 条数 :', (data.timeline || []).length);
  console.log('  events 条数   :', (data.events || []).length);
  console.log('  votes        :', Object.entries(data.votes || {})
    .map(([k, v]) => {
      const sum = Array.isArray(v)
        ? v.filter((_, i) => i % 2 === 1).reduce((a, b) => a + Number(b), 0)   // 扁平数组 [field,value,...]
        : Object.values(v).reduce((a, b) => a + Number(b), 0);                 // 对象 { field: value }
      return k + '=' + sum;
    }).join(', '));
  console.log('  voted keys   :', (data.votedKeys || []).length);
}

main().catch((e) => { console.error('备份失败：', e.message); process.exit(1); });
