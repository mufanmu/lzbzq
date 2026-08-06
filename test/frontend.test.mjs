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
const globalThis_ = globalThis;
globalThis_.document = {
  body: { classList: { add() {}, remove() {} }, style: {} },
  getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
  createElement() { return makeEl('el'); },
  createTextNode(t) { return { textContent: t }; },
  addEventListener(t, fn) { docHandlers[t] = fn; }
};

/* ---------- fetch stub：模拟服务端 ---------- */
let serverState = {
  startValue: 50, todayValue: 62, tier: '梁文锋叔叔', tierEmoji: '🧧', tierColor: '#b0703c',
  todayVotes: 15,
  voteDist: { '梁文锋叔叔': 9, '梁子': 6 },
  timeline: [{
    date: '2026-08-05', end: 83, tier: '梁圣', tierEmoji: '🙏', tierColor: '#cc785c',
    votes: 20, notes: ['📈 升级：梁子 → 梁圣'], dist: { '梁圣': 20 }
  }],
  votedToday: false,
  hot: { name: '梁文锋叔叔', emoji: '🧧', color: '#b0703c', votes: 9 }
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

/* ---------- rAF stub：有限帧（setTimeout/clearTimeout 用 node 原生异步） ---------- */
let rafCount = 0;
globalThis_.requestAnimationFrame = (fn) => { if (rafCount++ < 120) fn(); };

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
chk('状态栏档位 = 梁文锋叔叔', document.getElementById('tier-big').textContent.includes('梁文锋叔叔'), document.getElementById('tier-big').textContent);
chk('热评区显示', document.getElementById('hot-review').innerHTML.includes('今日热评') && document.getElementById('hot-review').innerHTML.includes('9 人'), document.getElementById('hot-review').innerHTML);
chk('时间线渲染 1 条', document.getElementById('timeline').children.length === 1 && document.getElementById('timeline').children[0].children.length >= 2, 'li children=' + document.getElementById('timeline').children[0].children.length);
chk('未投状态可拖动', document.getElementById('pick-msg').textContent.includes('拖动滑块'));
chk('滑块动画目标 62%', document.getElementById('slider-indicator').style.left.length > 0);

console.log('投票流程:');
sliderImg.handlers.mousedown(evt(0));    // 拖到左端 100
docHandlers.mousemove(evt(0));
docHandlers.mouseup();
chk('拖动选中 100% 梁神', document.getElementById('pick-msg').innerHTML.includes('100%') && document.getElementById('pick-msg').innerHTML.includes('梁神'));
chk('确认按钮可用', confirmBtn.disabled === false);
confirmBtn.handlers.click();
await new Promise((r) => setTimeout(r, 30));
chk('POST /api/vote 已调用', fetchCalls.includes('/api/vote'));
chk('已投提示', document.getElementById('vote-msg').textContent.includes('已投 100%'));
chk('投后服务端状态更新（今日票数 16）', serverState.todayVotes === 16);
chk('投后 votedToday 锁定', document.getElementById('pick-msg').textContent.includes('今日已投'));
chk('确认按钮禁用', confirmBtn.disabled === true);

console.log('已投后再拖动:');
sliderImg.handlers.mousedown(evt(700));   // 拖到右端 0
docHandlers.mousemove(evt(700));
docHandlers.mouseup();
chk('仍可预览但确认保持禁用', confirmBtn.disabled === true);
chk('toast 显示梁神梗句', document.getElementById('toast').textContent.includes('梁神') || document.getElementById('toast').textContent.length > 0);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
