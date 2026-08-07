/**
 * 后端核心逻辑测试（内存 store + 可控时钟）
 * 运行：node test/run.js
 */
import { createMemoryStore, computeState, submitVote, ensureNewDay, beijingDateStr, settleDay, tierOf, memeOf } from '../lib/core.js';

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

  // 跨天结算：8-07 无新票 → 结算 8-06（8-06 有票 → 写入每日总结）
  let s = await ensureNewDay(store, DAY2);
  chk('跨天继承昨日终值', s.lastDate === '2026-08-07' && s.startValue > 50, JSON.stringify(s));
  st = await computeState(store, '1.1.1.1', DAY2);
  chk('每日一条：8-06 总结已记录（timeline=1）', st.timeline.length === 1, JSON.stringify(st.timeline[0]));
  chk('总结带稳定梗句', typeof st.timeline[0].meme === 'string' && st.timeline[0].meme.length > 0, st.timeline[0].meme);
  chk('同一天梗幂等', st.timeline[0].meme === memeOf('2026-08-06', tierOf(st.timeline[0].end)), st.timeline[0].meme);

  // 8-07 投 10 票（100）→ 8-08 结算 8-07：有票即写入（不论档位变不变，同档位场景由下方 8 天循环覆盖）
  for (let i = 0; i < 10; i++) await submitVote(store, 'ip' + i + '.x', 100, DAY2);
  await ensureNewDay(store, DAY3);
  st = await computeState(store, '1.1.1.1', DAY3);
  chk('同档位日也写入（timeline=2）', st.timeline.length === 2, 'len=' + st.timeline.length);

  // 8-08 无票 → 8-09 结算时跳过不占位
  const DAY4 = new Date(T0 + 3 * 86400000);
  await ensureNewDay(store, DAY4);
  st = await computeState(store, '1.1.1.1', DAY4);
  chk('无票日跳过（timeline 仍 2）', st.timeline.length === 2, 'len=' + st.timeline.length);

  // 连续 8 个有票日 → 循环覆盖只留 7 条，最旧一天被挤出
  const store3 = createMemoryStore();
  for (let d = 0; d < 8; d++) {
    await submitVote(store3, 'a.b.c.d', 50, new Date(T0 + d * 86400000));
    await ensureNewDay(store3, new Date(T0 + (d + 1) * 86400000));
  }
  st = await computeState(store3, '1.1.1.1', new Date(T0 + 8 * 86400000));
  chk('循环覆盖：只留 7 条', st.timeline.length === 7, 'len=' + st.timeline.length);
  chk('最旧一天被挤出（剩 8-07..8-13）', st.timeline[6].date === '2026-08-07', st.timeline.map((r) => r.date).join(','));

  // settleDay 纯函数
  const rec = settleDay('2026-08-01', [100, 100, 100], 50);
  chk('满格记录含核弹', rec.end === 100 && rec.notes.join('').indexOf('核弹') >= 0);
  chk('满格记录带梁神梗', rec.meme && rec.tier === '梁神' && rec.meme.indexOf('梁神') >= 0, rec.meme);
  const rec2 = settleDay('2026-08-02', [0], 50);
  chk('归零记录', rec2.end === 0 && rec2.notes.join('').indexOf('归零') >= 0);
  chk('归零记录带梁西皮梗', rec2.meme && rec2.tier === '梁西皮', rec2.meme);

  // 模拟 @vercel/kv lrange 自动解析 JSON（对象形式）——parseJsonSafe 需兼容
  const store2 = createMemoryStore();
  const origLrange = store2.lrange.bind(store2);
  store2.lrange = async (k, s, e) => (await origLrange(k, s, e)).map((x) => JSON.parse(x));
  await submitVote(store2, '1.1.1.1', 83, DAY1);
  const st2 = await computeState(store2, '1.1.1.1', DAY1);
  chk('对象形式 lrange 也能解析出弹幕', st2.recentVotes.length === 1 && st2.recentVotes[0].v === 83, JSON.stringify(st2.recentVotes));

  // ===== 加固：ensureNewDay 自愈 / 断档 / 幂等 / 冷启动 =====
  console.log('ensureNewDay 自愈与幂等:');
  // 1. state 丢失自愈：8-01 与 8-03 有票，8-02 无票，now=8-04
  {
    const s = createMemoryStore();
    await s.hincrby('lzbzq:votes:2026-08-01', '83', 2);
    await s.hincrby('lzbzq:votes:2026-08-01', '100', 1);
    await s.hincrby('lzbzq:votes:2026-08-03', '50', 1);
    let st = await ensureNewDay(s, new Date(T0 - 2 * 86400000)); // 8-04
    chk('自愈：从最早有票日回放（lastDate=8-04）', st.lastDate === '2026-08-04', JSON.stringify(st));
    chk('自愈：链式继承 8-01(88.7)→8-02 跳过→8-03(50)', st.startValue === 50, 'startValue=' + st.startValue);
    const tl = (await s.lrange('lzbzq:timeline', 0, -1)).map((y) => JSON.parse(y));
    chk('自愈：8-01/8-03 均补总结且无 8-02（最新在前）', tl.length === 2 && tl[0].date === '2026-08-03' && tl[0].end === 50 && tl[1].date === '2026-08-01' && tl[1].end === 88.7, JSON.stringify(tl.map((r) => r.date + ':' + r.end)));
  }
  // 2. 多天未访问断档：lastDate=8-01 有票、8-03 有票、8-02/8-04 无，now=8-05
  {
    const s = createMemoryStore();
    await s.setJSON('lzbzq:state', { lastDate: '2026-08-01', startValue: 50 });
    await s.hincrby('lzbzq:votes:2026-08-01', '60', 1);
    await s.hincrby('lzbzq:votes:2026-08-03', '100', 1);
    let st = await ensureNewDay(s, new Date(T0 - 1 * 86400000)); // 8-05
    chk('断档：中间有票日全部结算（startValue=100）', st.lastDate === '2026-08-05' && st.startValue === 100, JSON.stringify(st));
    const tl2 = (await s.lrange('lzbzq:timeline', 0, -1)).map((y) => JSON.parse(y));
    chk('断档：timeline 两条且 8-03 最新在前', tl2.length === 2 && tl2[0].date === '2026-08-03' && tl2[1].date === '2026-08-01');
  }
  // 3. 幂等：timeline 已有 8-06 总结 → 跨天不重复写
  {
    const s = createMemoryStore();
    await s.setJSON('lzbzq:state', { lastDate: '2026-08-06', startValue: 50 });
    await s.hincrby('lzbzq:votes:2026-08-06', '83', 1);
    await s.lpush('lzbzq:timeline', JSON.stringify(settleDay('2026-08-06', [83], 50)));
    let st = await ensureNewDay(s, DAY2); // 8-07
    const tl3 = await s.lrange('lzbzq:timeline', 0, -1);
    chk('幂等：已有总结不重复写，startValue 仍链式更新', tl3.length === 1 && st.startValue === 83, 'len=' + tl3.length + ' start=' + st.startValue);
  }
  // 4. 冷启动：无任何历史票 → startValue=50 且立即落库
  {
    const s = createMemoryStore();
    let st = await ensureNewDay(s, DAY1);
    chk('冷启动：无历史票 startValue=50', st.lastDate === '2026-08-06' && st.startValue === 50);
    chk('冷启动即落库（避免每请求重复扫描）', s._raw.has('lzbzq:state'));
  }
  // 5. 自愈 + timeline 已有部分总结：8-05 已总结、8-06 有票未总结
  {
    const s = createMemoryStore();
    await s.hincrby('lzbzq:votes:2026-08-05', '50', 2);
    await s.hincrby('lzbzq:votes:2026-08-06', '83', 1);
    await s.lpush('lzbzq:timeline', JSON.stringify(settleDay('2026-08-05', [50, 50], 50)));
    let st = await ensureNewDay(s, DAY2); // 8-07
    const tl5 = (await s.lrange('lzbzq:timeline', 0, -1)).map((y) => JSON.parse(y));
    chk('自愈+已有总结：8-05 不重复、8-06 补结算', tl5.length === 2 && tl5[0].date === '2026-08-06' && tl5[1].date === '2026-08-05' && st.startValue === 83, JSON.stringify(tl5.map((r) => r.date)));
  }
  // 6. 回放上限 MAX_SETTLE_DAYS：断档 >90 天时截断，下次继续，票不丢
  {
    const s = createMemoryStore();
    await s.setJSON('lzbzq:state', { lastDate: '2026-01-01', startValue: 50 }); // 距 8-06 约 217 天
    await s.hincrby('lzbzq:votes:2026-04-10', '67', 1);   // 第 100 天，超过单次 90 天上限
    let st = await ensureNewDay(s, DAY1); // 8-06：回放 90 天到 4-01，未到 4-10
    chk('上限截断：lastDate 停在截断点（非 today）', st.lastDate === '2026-04-01', st.lastDate);
    chk('截断时票未结算（timeline 空）', (await s.lrange('lzbzq:timeline', 0, -1)).length === 0);
    st = await ensureNewDay(s, DAY1); // 第二次：从 4-01 继续 90 天到 6-30，覆盖 4-10
    chk('继续回放：4-10 票已结算', (await s.lrange('lzbzq:timeline', 0, -1)).length === 1 && st.lastDate === '2026-06-30', st.lastDate);
    st = await ensureNewDay(s, DAY1); // 第三次：完成到 today
    chk('三次后完成且票不丢', st.lastDate === '2026-08-06' && st.startValue === 67, JSON.stringify(st));
  }
  // 7. SETNX 幂等：settled key 已存在（并发另一请求已抢占）→ 不重复写总结
  {
    const s = createMemoryStore();
    await s.setJSON('lzbzq:state', { lastDate: '2026-08-06', startValue: 50 });
    await s.hincrby('lzbzq:votes:2026-08-06', '83', 1);
    await s.set('lzbzq:settled:2026-08-06', '1');          // 模拟并发已抢占
    await s.lpush('lzbzq:timeline', JSON.stringify(settleDay('2026-08-06', [83], 50)));
    let st = await ensureNewDay(s, DAY2); // 8-07
    const tl7 = await s.lrange('lzbzq:timeline', 0, -1);
    chk('SETNX 幂等：并发抢占后不重复写，startValue 仍更新', tl7.length === 1 && st.startValue === 83, 'len=' + tl7.length + ' start=' + st.startValue);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
