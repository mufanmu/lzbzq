/**
 * EdgeOne KV 适配器测试：mock 一个只含 put/get/delete/list 的命名空间
 * （含 EdgeOne key 仅允许 [0-9A-Za-z_] 的约束），验证 kvStore 行为与 Vercel 版一致。
 * 运行：node test/eo-kv.test.mjs
 */
import { kvStore, encodeKey, decodeKey } from '../lib/eo-kv-store.js';
import { computeState, submitVote, ensureNewDay, settleDay, tierOf, memeOf } from '../lib/core.js';

/* ---- mock EdgeOne KV 命名空间 ---- */
function createMockNamespace() {
  const m = new Map();
  const assertKey = (k) => {
    if (!/^[0-9A-Za-z_]+$/.test(k)) throw new Error('非法 key（EdgeOne 约束）: ' + k);
  };
  return {
    async put(k, v) { assertKey(k); m.set(k, String(v)); },
    async get(k) { assertKey(k); const v = m.get(k); return v === undefined ? null : v; },
    async delete(k) { assertKey(k); m.delete(k); },
    async list({ prefix = '', limit = 256, cursor } = {}) {
      const all = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? all.indexOf(cursor) : 0;
      const keys = all.slice(start, start + limit).map((key) => ({ key }));
      const next = all[start + limit];
      return { complete: !next, cursor: next || null, keys };
    },
    _raw: m
  };
}
globalThis.lzbzq_kv = createMockNamespace();

let pass = 0, fail = 0;
function chk(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

const T0 = Date.UTC(2026, 7, 6, 4, 0, 0);
const DAY1 = new Date(T0);
const DAY2 = new Date(T0 + 86400000);
const DAY3 = new Date(T0 + 2 * 86400000);

(async () => {
  console.log('key 编码:');
  chk('含冒号/连字符/点可逆', decodeKey(encodeKey('lzbzq:voted:1.2.3.4:2026-08-06')) === 'lzbzq:voted:1.2.3.4:2026-08-06');
  chk('编码结果只含合法字符', /^[0-9A-Za-z_]+$/.test(encodeKey('lzbzq:voted:1.2.3.4:2026-08-06')));

  console.log('投票与每日一票（与 test/run.js 同款用例）:');
  let r = await submitVote(kvStore, '1.1.1.1', 100, DAY1);
  chk('IP1 投 100 成功', r.ok);
  await submitVote(kvStore, '2.2.2.2', 50, DAY1);
  await submitVote(kvStore, '3.3.3.3', 0, DAY1);
  r = await submitVote(kvStore, '1.1.1.1', 83, DAY1);
  chk('同 IP 重复投票被拒', !r.ok && r.reason === 'already');

  let st = await computeState(kvStore, '1.1.1.1', DAY1);
  chk('当日 3 票', st.todayVotes === 3, JSON.stringify(st.todayVotes));
  chk('弹幕正序且含时间', st.recentVotes.length === 3 && st.recentVotes[0].v === 100 && /^\d{2}:\d{2}$/.test(st.recentVotes[0].t));
  chk('低票保护显示 startValue 50', st.todayValue === 50);
  chk('IP1 已投 / IP9 未投', st.votedToday === true && (await computeState(kvStore, '9.9.9.9', DAY1)).votedToday === false);

  for (const ip of ['4.4.4.4', '5.5.5.5', '6.6.6.6', '7.7.7.7', '8.8.8.8', '9.9.9.9', '10.0.0.1']) {
    await submitVote(kvStore, ip, 100, DAY1);
  }
  st = await computeState(kvStore, '1.1.1.1', DAY1);
  chk('满 10 票均值生效 + 热评梁神', st.todayValue > 50 && st.hot && st.hot.name === '梁神');

  console.log('跨天结算（hash/list/setnx/scanKeys 全链路）:');
  await ensureNewDay(kvStore, DAY2);
  st = await computeState(kvStore, '1.1.1.1', DAY2);
  chk('8-06 总结写入 timeline', st.timeline.length === 1 && st.timeline[0].date === '2026-08-06');
  chk('总结带稳定梗', st.timeline[0].meme === memeOf('2026-08-06', tierOf(st.timeline[0].end)));

  // 自愈：删 state，保留投票，验证 scanKeys（含编码 key 的前缀遍历）
  await kvStore.del('lzbzq:state');
  const keys = await kvStore.scanKeys('lzbzq:votes:*');
  chk('scanKeys 找到投票 key（编码后仍匹配）', keys.includes('lzbzq:votes:2026-08-06'), JSON.stringify(keys));
  const s2 = await ensureNewDay(kvStore, DAY2);
  chk('自愈：state 丢失后从投票 key 回放（8-06 均值 85）', s2.lastDate === '2026-08-07' && s2.startValue === 85, JSON.stringify(s2));

  // 连续 8 天有票 → 循环覆盖只留 7 条
  for (let d = 0; d < 8; d++) {
    const storeN = kvStore;
    await storeN.del('lzbzq:state');   // 每天独立结算，避免与前面数据耦合
    await submitVote(storeN, 'a.b.c.d', 50, new Date(T0 + d * 86400000));
    await ensureNewDay(storeN, new Date(T0 + (d + 1) * 86400000));
  }
  st = await computeState(kvStore, '1.1.1.1', new Date(T0 + 8 * 86400000));
  chk('循环覆盖只留 7 条', st.timeline.length === 7, 'len=' + st.timeline.length);

  console.log('迁移函数数据形态:');
  // 模拟 backup 的 HGETALL 扁平数组 → normalizeHash
  const mig = await import('../functions/api/migrate.js');
  const backup = {
    state: JSON.stringify({ lastDate: '2026-08-07', startValue: 50 }),
    timeline: [JSON.stringify(settleDay('2026-08-06', [83], 50))],
    events: [JSON.stringify({ t: '09:13', v: 0 })],
    votes: { 'lzbzq:votes:2026-08-07': ['59', '1', '0', '2'] },
    votedKeys: ['lzbzq:voted:1.2.3.4:2026-08-07']
  };
  globalThis.lzbzq_kv = createMockNamespace();   // 全新命名空间
  const req = {
    method: 'POST',
    url: 'https://x.example/api/migrate',
    json: async () => backup
  };
  const resp = await mig.onRequest({ request: req });
  const body = JSON.parse(await resp.text());
  chk('迁移成功返回 summary', resp.status === 200 && body.ok === true && body.summary.votesKeys === 1, JSON.stringify(body));
  const h = await kvStore.hgetall('lzbzq:votes:2026-08-07');
  chk('votes 扁平数组→对象 hash', h && h['59'] === 1 && h['0'] === 2 && Object.keys(h).length === 2, JSON.stringify(h));
  chk('timeline/events 原样写入', (await kvStore.lrange('lzbzq:timeline', 0, -1)).length === 1 && (await kvStore.lrange('lzbzq:events', 0, -1)).length === 1);
  chk('幂等保护：二次迁移被拒 409', (await mig.onRequest({ request: req })).status === 409);

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试崩溃:', e); process.exit(1); });
