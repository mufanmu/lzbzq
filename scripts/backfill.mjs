#!/usr/bin/env node
/**
 * 数据补偿：把「有票但未写入一周风评」的历史日期补结算
 * - 找出所有日期 < 今天、有票、且 timeline 中没有总结的 lzbzq:votes:<date>
 * - 按日期升序逐个 settleDay 结算，startValue 链式继承（无票日跳过）
 * - 总结写入 timeline（最新在前，ltrim 7 条）
 * - 更新 lzbzq:state 的 startValue（lastDate 保持不动）
 *
 * 用法：
 *   node scripts/backfill.mjs --self-test  内存 store 自测（无需凭据）
 *   node scripts/backfill.mjs --dry-run    只读预览将写入什么（需只读凭据即可）
 *   node scripts/backfill.mjs --apply      真正写入（需读写凭据）
 */
import { createMemoryStore, settleDay, beijingDateStr } from '../lib/core.js';
import { redis, redisScan, requireCreds } from './upstash.mjs';

const TIMELINE_MAX = 7;

/** 兼容对象（内存/@vercel/kv）与数组（Upstash REST 原始格式）两种 hash 表示 */
export function expandVotes(hash) {
  const list = [];
  if (!hash) return list;
  const pairs = Array.isArray(hash)
    ? hash.filter((_, i) => i % 2 === 0).map((f, i) => [f, hash[i * 2 + 1]])
    : Object.entries(hash);
  for (const [v, c] of pairs) {
    const n = parseInt(c, 10) || 0;
    for (let i = 0; i < n; i++) list.push(parseInt(v, 10));
  }
  return list;
}

/** 找出未结算日期：有票、日期 < today、timeline 中尚无总结 */
export async function findUnsettled(store, today) {
  const keys = (await store.scanKeys('lzbzq:votes:*')).sort();
  const raw = (await store.lrange('lzbzq:timeline', 0, -1)) || [];
  const have = new Set(
    raw.map((x) => { try { return JSON.parse(x).date; } catch { return null; } }).filter(Boolean)
  );
  const unsettled = [];
  for (const k of keys) {
    const date = k.slice('lzbzq:votes:'.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= today || have.has(date)) continue;
    const votes = expandVotes(await store.hgetall(k));
    if (votes.length) unsettled.push({ date, votes });
  }
  return unsettled;
}

/** 补偿主逻辑：返回 { applied: [结算记录], startValue } */
export async function backfill(store, now) {
  const today = beijingDateStr(now);
  const state = await store.getJSON('lzbzq:state');
  if (!state) throw new Error('lzbzq:state 不存在：无继承基线，请先让线上首次访问初始化');
  const unsettled = await findUnsettled(store, today);
  let startValue = state.startValue;
  const applied = [];
  for (const { date, votes } of unsettled) {   // 升序 → 链式继承
    const rec = settleDay(date, votes, startValue);
    startValue = rec.end;
    applied.push(rec);
  }
  if (!applied.length) return { applied, startValue };
  // 注：这里不写 lzbzq:settled:<date> 幂等键——线上 ensureNewDay 的 timelineHas 兜底
  // 会识别已写入的总结。若与线上跨天结算并发执行，重复写入窗口极小且属一次性运维场景。
  for (const rec of applied) {                 // 升序 lpush → 最新在前
    await store.lpush('lzbzq:timeline', JSON.stringify(rec));
    await store.ltrim('lzbzq:timeline', 0, TIMELINE_MAX - 1);
  }
  if (Math.abs(state.startValue - startValue) > 1e-9) {
    await store.setJSON('lzbzq:state', { ...state, startValue });
  }
  return { applied, startValue };
}

/* ---------- Upstash REST store（生产） ---------- */
const restStore = {
  getJSON: async (k) => { const v = await redis('GET', k); return v === null ? null : JSON.parse(v); },
  setJSON: (k, v) => redis('SET', k, JSON.stringify(v)),
  hgetall: async (k) => {
    const r = await redis('HGETALL', k);
    if (Array.isArray(r)) { const o = {}; for (let i = 0; i + 1 < r.length; i += 2) o[r[i]] = r[i + 1]; return o; }
    return r;
  },
  lpush: (k, v) => redis('LPUSH', k, v),
  lrange: (k, s, e) => redis('LRANGE', k, String(s), String(e)),
  ltrim: (k, s, e) => redis('LTRIM', k, String(s), String(e)),
  scanKeys: (pattern) => redisScan(pattern)
};

/** 只读包装：把写操作拦截为记录，不真正执行 */
function dryStore(store) {
  const writes = [];
  return {
    ...store,
    lpush: async (k, v) => { writes.push(['LPUSH', k, v]); },
    ltrim: async (k, s, e) => { writes.push(['LTRIM', k, s, e]); },
    setJSON: async (k, v) => { writes.push(['SET', k, JSON.stringify(v)]); }
  };
}

function report(r, dry) {
  console.log((dry ? '[dry-run] 将写入：' : '[apply] 已写入：') + r.applied.length + ' 条总结');
  for (const rec of r.applied) {
    console.log('  ' + rec.date + ' · ' + rec.votes + ' 票 · 终值 ' + rec.end + '% · ' + rec.tierEmoji + ' ' + rec.tier +
      (rec.notes.length ? ' · ' + rec.notes.join('；') : ''));
  }
  console.log('startValue → ' + r.startValue + '%');
}

/* ---------- 内存自测 ---------- */
async function selfTest() {
  let ok = 0, fail = 0;
  const chk = (name, cond, detail) => { if (cond) { ok++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); } };

  const T = Date.UTC(2026, 7, 7, 4, 0, 0);   // 北京 2026-08-07
  // createMemoryStore 已内置 scanKeys（lib/core.js 加固版）
  const mkStore = () => createMemoryStore();

  console.log('场景 A：8-06 有 19 票未结算（0×6、83×3、100×3、17×5、50×2）');
  const s1 = mkStore();
  await s1.setJSON('lzbzq:state', { lastDate: '2026-08-07', startValue: 50 });
  for (const [v, c] of [['0', 6], ['83', 3], ['100', 3], ['17', 5], ['50', 2]]) for (let i = 0; i < c; i++) await s1.hincrby('lzbzq:votes:2026-08-06', v, 1);
  const r1 = await backfill(s1, new Date(T));
  const expectEnd = Math.round((0 * 6 + 83 * 3 + 100 * 3 + 17 * 5 + 50 * 2) / 19 * 10) / 10; // 38.6
  chk('补偿 1 条（8-06, 19 票）', r1.applied.length === 1 && r1.applied[0].date === '2026-08-06' && r1.applied[0].votes === 19);
  chk('startValue 链式 = 均值 ' + expectEnd, Math.abs(r1.startValue - expectEnd) < 1e-9, 'got ' + r1.startValue);
  const st1 = await s1.getJSON('lzbzq:state');
  chk('state.startValue 已更新且 lastDate 未动', st1.startValue === expectEnd && st1.lastDate === '2026-08-07');
  const tl1 = await s1.lrange('lzbzq:timeline', 0, -1);
  chk('timeline 1 条', tl1.length === 1);
  const r1b = await backfill(s1, new Date(T));
  chk('幂等：再次运行 applied=0 且不重复', r1b.applied.length === 0 && (await s1.lrange('lzbzq:timeline', 0, -1)).length === 1);

  console.log('场景 B：timeline 已有 8-05 总结 → 跳过不重复写');
  const s2 = mkStore();
  await s2.setJSON('lzbzq:state', { lastDate: '2026-08-07', startValue: 44.6 });
  await s2.lpush('lzbzq:timeline', JSON.stringify(settleDay('2026-08-05', [50], 50)));
  for (let i = 0; i < 3; i++) await s2.hincrby('lzbzq:votes:2026-08-05', '83', 1);
  for (let i = 0; i < 2; i++) await s2.hincrby('lzbzq:votes:2026-08-06', '100', 1);
  const r2 = await backfill(s2, new Date(T));
  chk('只补 8-06，跳过已有总结的 8-05', r2.applied.length === 1 && r2.applied[0].date === '2026-08-06');
  const tl2 = await s2.lrange('lzbzq:timeline', 0, -1);
  chk('timeline 2 条且 8-05 无重复', tl2.length === 2 && tl2.filter((x) => JSON.parse(x).date === '2026-08-05').length === 1);
  chk('最新在前（8-06 在 8-05 前面）', JSON.parse(tl2[0]).date === '2026-08-06');

  console.log('场景 C：无未结算日期 → 无操作');
  const s3 = mkStore();
  await s3.setJSON('lzbzq:state', { lastDate: '2026-08-07', startValue: 44.6 });
  const r3 = await backfill(s3, new Date(T));
  chk('applied=0 且 state 不变', r3.applied.length === 0);

  console.log(`\n结果: ${ok} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

const mode = process.argv[2] || '--dry-run';
if (mode === '--self-test') {
  await selfTest();
} else {
  requireCreds();
  const r = mode === '--apply'
    ? await backfill(restStore, new Date())
    : await backfill(dryStore(restStore), new Date());
  report(r, mode !== '--apply');
}
