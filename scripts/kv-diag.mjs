#!/usr/bin/env node
/**
 * 生产 KV 只读诊断脚本（仅执行无副作用命令：GET / LRANGE / SCAN / HGETALL / HLEN / PING）
 * 用法：KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/kv-diag.mjs
 */
import { redis, redisBatch, redisScan, requireCreds } from './upstash.mjs';

function fmt(x) {
  return JSON.stringify(x, null, 2);
}

async function main() {
  requireCreds();
  console.log('=== 梁子变阻器 · 生产 KV 诊断 ===\n');

  // 1. 连通性
  const pong = await redis('PING');
  console.log('[PING]', pong);

  // 2. state
  const state = await redis('GET', 'lzbzq:state');
  console.log('\n--- lzbzq:state ---');
  if (state === null) console.log('⚠  key 不存在！—— 这会导致冷启动 50 且不结算历史票');
  else console.log(fmt(typeof state === 'string' ? JSON.parse(state) : state));
  const stateTtl = await redis('TTL', 'lzbzq:state');
  console.log('TTL:', stateTtl, '( -1 = 无过期 )');

  // 3. timeline 一周风评
  const timeline = await redis('LRANGE', 'lzbzq:timeline', '0', '-1');
  console.log('\n--- lzbzq:timeline（一周风评）共 ' + (timeline || []).length + ' 条 ---');
  if (!timeline || !timeline.length) console.log('（空）');
  for (const s of timeline || []) {
    const r = typeof s === 'string' ? JSON.parse(s) : s;
    console.log('  ' + r.date + ' · ' + r.votes + ' 票 · 终值 ' + r.end + '% · ' + (r.tierEmoji || '') + r.tier);
  }

  // 4. 各日投票数据
  console.log('\n--- lzbzq:votes:<date>（按日期）---');
  const voteKeys = (await redisScan('lzbzq:votes:*')).sort();
  if (!voteKeys.length) console.log('（无任何投票数据）');
  const dates = voteKeys.map((k) => k.slice('lzbzq:votes:'.length));
  const hls = await redisBatch(voteKeys.map((k) => ['HLEN', k]));
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  voteKeys.forEach((k, i) => {
    const d = dates[i];
    const flag = d === today ? '（今天）' : d < today ? '（历史未结算？）' : '（未来？）';
    console.log('  ' + d + ' 票数=' + (hls[i] || 0) + ' ' + flag);
  });

  // 5. 每日一票 key 计数
  const votedKeys = await redisScan('lzbzq:voted:*');
  console.log('\n--- lzbzq:voted:<ip>:<date> 共 ' + votedKeys.length + ' 个 ---');
  const byDate = {};
  for (const k of votedKeys) {
    const d = k.split(':').pop();
    byDate[d] = (byDate[d] || 0) + 1;
  }
  for (const [d, n] of Object.entries(byDate).sort()) console.log('  ' + d + ' · ' + n + ' 个已投 IP');

  // 6. 弹幕事件
  const events = await redis('LRANGE', 'lzbzq:events', '0', '9');
  console.log('\n--- lzbzq:events（最近 ' + (events || []).length + ' 条 / 最多 40）---');
  for (const s of (events || []).slice(0, 5)) {
    const r = typeof s === 'string' ? JSON.parse(s) : s;
    console.log('  ' + r.t + ' · ' + r.v);
  }

  // 7. 结论提示
  console.log('\n=== 诊断结论 ===');
  if (state === null) {
    console.log('▶ lzbzq:state 丢失 → 解释了「今天从 50 开始 + 昨天总结缺失」。');
    console.log('▶ 若存在日期 < 今天的 lzbzq:votes:* 且有票数，可用 scripts/backfill.mjs 补结算。');
  } else {
    const st = typeof state === 'string' ? JSON.parse(state) : state;
    const inTimeline = new Set((timeline || []).map((s) => (typeof s === 'string' ? JSON.parse(s) : s).date));
    const missing = dates.filter((d) => d < today && !inTimeline.has(d));
    if (missing.length) console.log('▶ state 存在，但以下日期有票且未进 timeline：' + missing.join(', ') + ' → 可补偿。');
    else console.log('▶ state 存在，未发现明显的孤儿票数据。');
  }
}

main().catch((e) => {
  console.error('诊断失败：', e.message);
  process.exit(1);
});
