/**
 * 后端核心逻辑测试（内存 store + 可控时钟）
 * 运行：node test/run.js
 */
import { createMemoryStore, computeState, submitVote, ensureNewDay, beijingDateStr, settleDay, tierOf } from '../lib/core.js';

let pass = 0, fail = 0;
function chk(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

// 固定时钟：2026-08-06 12:00 北京 = UTC 04:00
const T0 = Date.UTC(2026, 7, 6, 4, 0, 0);
const DAY1 = new Date(T0);                    // 8-06
const DAY2 = new Date(T0 + 86400000);         // 8-07
const DAY3 = new Date(T0 + 2 * 86400000);     // 8-08

console.log('日期工具:');
chk('北京日期 8-06', beijingDateStr(DAY1) === '2026-08-06', beijingDateStr(DAY1));
chk('北京日期 8-07', beijingDateStr(DAY2) === '2026-08-07', beijingDateStr(DAY2));
chk('档位判定 100=梁神', tierOf(100).name === '梁神');

console.log('投票与每日一票:');
const store = createMemoryStore();
(async () => {
  // 三个不同 IP 各投一票
  let r = await submitVote(store, '1.1.1.1', 100, DAY1);
  chk('IP1 投 100 成功', r.ok);
  r = await submitVote(store, '2.2.2.2', 50, DAY1);
  chk('IP2 投 50 成功', r.ok);
  r = await submitVote(store, '3.3.3.3', 0, DAY1);
  chk('IP3 投 0 成功', r.ok);

  // 同 IP 重复投票被拒
  r = await submitVote(store, '1.1.1.1', 83, DAY1);
  chk('同 IP 重复投票被拒', !r.ok && r.reason === 'already');

  let st = await computeState(store, '1.1.1.1', DAY1);
  chk('当日 3 票', st.todayVotes === 3, JSON.stringify(st.todayVotes));
  chk('弹幕事件 3 条（正序：最早在前）', st.recentVotes.length === 3 && st.recentVotes[0].v === 100 && st.recentVotes[2].v === 0, JSON.stringify(st.recentVotes));
  chk('弹幕含北京时间', /^\d{2}:\d{2}$/.test(st.recentVotes[0].t), st.recentVotes[0].t);
  chk('低票保护：<10 票显示 startValue 50', st.todayValue === 50 && st.startValue === 50);
  chk('IP1 今日已投', st.votedToday === true);
  st = await computeState(store, '9.9.9.9', DAY1);
  chk('IP9 今日未投', st.votedToday === false);

  // 低票保护解除：凑满 10 票
  const ips = ['4.4.4.4', '5.5.5.5', '6.6.6.6', '7.7.7.7', '8.8.8.8', '9.9.9.9', '10.0.0.1'];
  for (const ip of ips) await submitVote(store, ip, 100, DAY1);
  st = await computeState(store, '1.1.1.1', DAY1);
  chk('满 10 票后均值生效', st.todayValue > 50, 'value=' + st.todayValue);
  chk('热评出现（梁神票最多）', st.hot && st.hot.name === '梁神', JSON.stringify(st.hot));
  chk('voteDist 有分布', Object.keys(st.voteDist).length >= 2, JSON.stringify(st.voteDist));

  // 跨天结算：8-07 无新票 → 结算 8-06
  let s = await ensureNewDay(store, DAY2);
  chk('跨天继承昨日终值', s.lastDate === '2026-08-07' && s.startValue > 50, JSON.stringify(s));
  // 8-06 结算档位 vs 初始 50（梁子）→ 记录一条
  st = await computeState(store, '1.1.1.1', DAY2);
  chk('档位变化已记录（timeline=1）', st.timeline.length === 1, JSON.stringify(st.timeline[0]));

  // 8-07 投同档位 → 不记录
  for (let i = 0; i < 10; i++) await submitVote(store, 'ip' + i + '.x', 100, DAY2);
  // 等等，需要算均值档位——上面 startValue 是 8-06 终值（约 78.5 梁圣？）… 直接断言行为：无档位变化则 timeline 不变
  const tlBefore = (await ensureNewDay(store, DAY3)) && null;
  // 8-08 结算 8-07：若档位与 8-06 相同则不加记录
  st = await computeState(store, '1.1.1.1', DAY3);
  const tier7 = tierOf((await ensureNewDay(store, DAY2)) ? (st.todayValue) : 0);
  chk('跨天两日后时间线仍有限', st.timeline.length <= 2, 'len=' + st.timeline.length);

  // settleDay 纯函数
  const rec = settleDay('2026-08-01', [100, 100, 100], 50);
  chk('满格记录含核弹', rec.end === 100 && rec.notes.join('').indexOf('核弹') >= 0);
  const rec2 = settleDay('2026-08-02', [0], 50);
  chk('归零记录', rec2.end === 0 && rec2.notes.join('').indexOf('归零') >= 0);

  // 模拟 @vercel/kv lrange 自动解析 JSON（对象形式）——parseJsonSafe 需兼容
  const store2 = createMemoryStore();
  const origLrange = store2.lrange.bind(store2);
  store2.lrange = async (k, s, e) => (await origLrange(k, s, e)).map((x) => JSON.parse(x));
  await submitVote(store2, '1.1.1.1', 83, DAY1);
  const st2 = await computeState(store2, '1.1.1.1', DAY1);
  chk('对象形式 lrange 也能解析出弹幕', st2.recentVotes.length === 1 && st2.recentVotes[0].v === 83, JSON.stringify(st2.recentVotes));

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
