/**
 * 前端运行时测试（node 环境 + DOM/fetch stub）
 * 运行：node test/frontend.test.mjs
 */
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

/* ---------- DOM stub ---------- */
const els = {};
function makeEl(id) {
  const el = {
    id, style: {}, width: 0, height: 0, textContent: '', disabled: false, src: '',
    children: [], handlers: {},
    classList: { add() {}, remove() {} },
    appendChild(c) { this.children.push(c); },
    addEventListener(t, fn) { this.handlers[t] = fn; },
    getContext() { return null; },
    getBoundingClientRect() { return { left: 0, width: 700 }; },
    clientWidth: 700, naturalWidth: 600, complete: true,
    setAttribute(k, v) { this[k] = v; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html || ''; },
    set(v) { this._html = v; this.children = []; }
  });
  return el;
}
const docHandlers = {};
const qsEls = {};
const globalThis_ = globalThis;
globalThis_.document = {
  body: { classList: { add() {}, remove() {} }, style: {} },
  getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
  createElement() { return makeEl('el'); },
  createTextNode(t) { return { textContent: t }; },
  addEventListener(t, fn) { docHandlers[t] = fn; },
  querySelector(sel) { if (!qsEls[sel]) qsEls[sel] = makeEl('qs-' + sel.replace(/[^a-z0-9]/gi, '')); return qsEls[sel]; }
};

/* ---------- fetch stub：模拟服务端 ---------- */
let serverState = {
  startValue: 50, todayValue: 62, tier: '梁叔', tierEmoji: '🧧', tierColor: '#b0703c',
  todayVotes: 15,
  voteDist: { '梁叔': 9, '梁子': 6 },
  timeline: [{
    date: '2026-08-05', end: 83, tier: '梁圣', tierEmoji: '🙏', tierColor: '#cc785c',
    votes: 20, notes: ['📈 升级：梁子 → 梁圣'], dist: { '梁圣': 20 }
  }],
  votedToday: false,
  hot: { name: '梁叔', emoji: '🧧', color: '#b0703c', votes: 9 },
  recentVotes: [
    { t: '14:02', v: 100 }, { t: '14:05', v: 50 }, { t: '14:08', v: 83 }
  ]
};
const fetchCalls = [];
globalThis_.fetch = async (url, opts) => {
  fetchCalls.push(url);
  if (url === '/api/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(serverState)) };
  if (url === '/api/vote') {
    const body = JSON.parse(opts.body);
    serverState.votedToday = true;
    serverState.todayVotes += 1;
    return { ok: true, json: async () => ({ ok: true, state: JSON.parse(JSON.stringify(serverState)) }) };
  }
  throw new Error('unknown url ' + url);
};

/* ---------- rAF stub：真实异步逐帧（16ms/帧） ---------- */
globalThis_.requestAnimationFrame = (fn) => { setTimeout(() => fn(), 16); };

/* ---------- 执行页面脚本 ---------- */
new Function(script)();

let pass = 0, fail = 0;
function chk(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

const sliderImg = document.getElementById('slider-img');
const confirmBtn = document.getElementById('confirm-btn');
const evt = (x) => ({ clientX: x, preventDefault() {} });

await new Promise((r) => setTimeout(r, 30));   // 等 fetchState 完成

console.log('初始渲染:');
chk('调用了 /api/state', fetchCalls.includes('/api/state'));
chk('状态栏档位 = 梁叔', document.getElementById('tier-big').textContent.includes('梁叔'), document.getElementById('tier-big').textContent);
chk('badge 数值标签 62%', document.getElementById('tier-badge').textContent === '62%', document.getElementById('tier-badge').textContent);
const indEl = document.getElementById('slider-indicator');
chk('大字与滑块气泡同步（初始）', document.getElementById('value').textContent === indEl['data-pct'], document.getElementById('value').textContent + ' vs ' + indEl['data-pct']);
chk('当日变动提示（梁子 → 梁叔 +12%）', document.getElementById('tier-change').innerHTML.includes('梁子') && document.getElementById('tier-change').innerHTML.includes('梁叔') && document.getElementById('tier-change').innerHTML.includes('+12.0'), document.getElementById('tier-change').innerHTML);
chk('热评区显示（今日热评条目）', document.querySelector('#hot-slide').textContent.includes('今日热评') && document.querySelector('#hot-slide').textContent.includes('9 人'), document.querySelector('#hot-slide').textContent);
await new Promise((r) => setTimeout(r, 6300));   // 等 6s 轮播
chk('热评轮播第 2 条（均值）', document.querySelector('#hot-slide').textContent.includes('今日均值'), document.querySelector('#hot-slide').textContent);
await new Promise((r) => setTimeout(r, 6000));
chk('热评轮播第 3 条（顶流/断层）', document.querySelector('#hot-slide').textContent.includes('🥇'), document.querySelector('#hot-slide').textContent);
await new Promise((r) => setTimeout(r, 6000));
chk('热评轮播第 4 条（无人投/参与人数）', document.querySelector('#hot-slide').textContent.includes('无人投') || document.querySelector('#hot-slide').textContent.includes('参与投票'), document.querySelector('#hot-slide').textContent);
chk('时间线渲染 1 条', document.getElementById('timeline').children.length === 1 && document.getElementById('timeline').children[0].children.length >= 2, 'li children=' + document.getElementById('timeline').children[0].children.length);
chk('未投状态可拖动', document.getElementById('pick-msg').textContent.includes('拖动滑块'));
chk('滑块动画目标 62%', document.getElementById('slider-indicator').style.left.length > 0);

console.log('投票流程:');
sliderImg.handlers.mousedown(evt(0));    // 拖到左端 100
docHandlers.mousemove(evt(0));
chk('拖动时大字跟手 100%', document.getElementById('value').textContent === '100%', document.getElementById('value').textContent);
chk('拖动时珊瑚标签不跟（仍 62%）', document.getElementById('tier-badge').textContent === '62%', document.getElementById('tier-badge').textContent);
docHandlers.mouseup();
chk('松开后大字保持预览 100%', document.getElementById('value').textContent === '100%');
chk('拖动选中 100% 梁神', document.getElementById('pick-msg').innerHTML.includes('100%') && document.getElementById('pick-msg').innerHTML.includes('梁神'));
chk('确认按钮可用', confirmBtn.disabled === false);
confirmBtn.handlers.click();
await new Promise((r) => setTimeout(r, 30));
chk('POST /api/vote 已调用', fetchCalls.includes('/api/vote'));
chk('已投提示', document.getElementById('vote-msg').textContent.includes('已投 100%'));
chk('确认后大字跟随滑块回落（同步）', document.getElementById('value').textContent === indEl['data-pct'] && parseInt(document.getElementById('value').textContent) < 100, document.getElementById('value').textContent);
chk('投后服务端状态更新（今日票数 16）', serverState.todayVotes === 16);
chk('投后 votedToday 锁定', document.getElementById('pick-msg').textContent.includes('今日已投'));
chk('确认按钮禁用', confirmBtn.disabled === true);

console.log('已投后再拖动:');
sliderImg.handlers.mousedown(evt(700));   // 拖到右端 0
docHandlers.mousemove(evt(700));
docHandlers.mouseup();
chk('仍可预览但确认保持禁用', confirmBtn.disabled === true);
chk('toast 显示梁神梗句', document.getElementById('toast').textContent.includes('梁神') || document.getElementById('toast').textContent.length > 0);

console.log('弹幕:');
const dmRow1 = document.querySelector('.dm-row.r1');
const dmRow2 = document.querySelector('.dm-row.r2');
const dmRow3 = document.querySelector('.dm-row.r3');
chk('第一行弹幕已播放（时间+选项）', dmRow1.children.length === 1 && dmRow1.children[0].textContent.includes('14:02') && dmRow1.children[0].textContent.includes('梁神'), JSON.stringify(dmRow1.children[0].textContent));
await new Promise((r) => setTimeout(r, 2700));   // 等第二行（2600ms 错开）播放
chk('第二行弹幕已播放（错开）', dmRow2.children.length === 1 && dmRow2.children[0].textContent.includes('14:05') && dmRow2.children[0].textContent.includes('梁子'));
await new Promise((r) => setTimeout(r, 1300));   // 等第三行（3.6s 错开）播放
chk('第三行弹幕已播放', dmRow3.children.length === 1 && dmRow3.children[0].textContent.includes('14:08'), JSON.stringify(dmRow3.children[0] && dmRow3.children[0].textContent));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
