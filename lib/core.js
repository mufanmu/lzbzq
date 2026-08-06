/**
 * 梁子变祖器 · 后端核心逻辑（纯 JS，无框架依赖）
 * 存储通过 store 接口注入：Vercel 环境用 @vercel/kv，测试用内存实现。
 */

export const MIN_VOTES = 10;   // 低票保护：当日票数少于该值，电阻保持昨日终值
export const START_VALUE = 50; // 初始电阻
export const HOT_MIN = 10;     // 今日热评解锁所需当日票数
export const TIMELINE_MAX = 7;  // 一周风评：最多保留 7 条，循环覆盖
export const EVENTS_MAX = 40;  // 弹幕事件最多保留条数

export const TIERS = [
  { name: '梁神', value: 100, emoji: '😇', color: '#c2853b', memes: [
    '梁神！——核弹爆炸般的力量', '全网都在等一个梁神时刻', '梁神降临，美股震动', '封神之路，从此刻开始',
    '满格梁神，华尔街连夜改口叫爸爸', '这波不叫梁神，叫梁财神', '核弹已发射，梁神正在登基'
  ] },
  { name: '梁圣', value: 83, emoji: '🙏', color: '#cc785c', memes: [
    '梁圣的恩情还不完！', '感谢梁圣开源，AI 圈的反核导弹', '梁圣一出手，就知有没有', '圣人之恩，降价以报',
    '梁圣在上，散户顶礼膜拜', '开源圣人，降价的活菩萨', '今日梁圣，明天就是梁神'
  ] },
  { name: '梁叔', value: 67, emoji: '🧧', color: '#b0703c', memes: [
    '早上领国补，晚上领美股', '美股，就是梁叔的提款机', '量化一出手，散户两行泪', '国补美股两头吃，散户韭菜地里哭',
    '梁叔的镰刀，从不落空', '美股开盘，梁叔上班', '国补照领，美股照赚，散户照哭'
  ] },
  { name: '梁子', value: 50, emoji: '😐', color: '#8e8b82', memes: [
    '梁圣，还是梁子？——凭产品表现定称呼', '食言太多，吃成了梁子', '和网红良子撞名的男人', '梁子本子，说好的发布呢',
    '梁子不哭，说好的发布马上来', '今日份梁子，稳如老狗', '梁子：我再也不鸽了（下次一定）'
  ] },
  { name: '牢梁', value: 33, emoji: '🕳', color: '#5f6b7a', memes: [
    '牢字辈三幻神，恭迎牢梁归位', '牢大、牢张、牢梁，互联网三幻神', '牢里牢气，但还有机会翻案', '关于恢复梁叔名誉的决定（待发布）',
    '牢梁已就位，静候翻案', '牢字辈排面，牢梁永不缺席', '宁可风评崩，不可牢位空'
  ] },
  { name: '小难梁', value: 17, emoji: '🥀', color: '#5a4a42', memes: [
    '小难梁拿不出大赢鲸', '深陷时空裂缝，无法自拔', '跳票跳进了小难梁', '小难梁：我太难了',
    '大赢鲸还在深海，小难梁还在等待', '时间裂缝里，小难梁独自美丽', '赢鲸未至，难梁先行'
  ] },
  { name: '梁西皮', value: 0, emoji: '🖤', color: '#3d3a35', memes: [
    '互联网的尽头是抽象，抽象的尽头是梁西皮', '梁西皮：风评的下限，就是没有下限', '别人在谷底，梁西皮在盆地', '跌到梁西皮，风评直接注销',
    '抽象学终身教授，梁西皮本皮', '江浙沪唯一指定问候，听懂的都沉默了', '梁西皮：风评的隐藏关卡，掉进去就出不来'
  ] }
];

export function tierOf(v) {
  let best = TIERS[0], bd = Infinity;
  for (const t of TIERS) {
    const d = Math.abs(t.value - v);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

/** 简单字符串哈希（FNV-1a 风格），用于按日期稳定选梗 */
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 按日期稳定选梗：同一天永远选中同一条，7 条梗循环轮换 */
export function memeOf(dateStr, tier) {
  const memes = (tier && tier.memes) || [];
  if (!memes.length) return null;
  return memes[hashStr(dateStr) % memes.length];
}
export function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
export function round1(x) { return Math.round(x * 10) / 10; }

/** 北京时间日期串 YYYY-MM-DD（UTC+8） */
export function beijingDateStr(now) {
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  return bj.toISOString().slice(0, 10);
}

/** 北京时间 HH:MM */
export function beijingTimeStr(now) {
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  return bj.toISOString().slice(11, 16);
}

/** 距下一个北京时间 0 点的秒数 */
export function ttlToBeijingMidnight(now) {
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  const next = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() + 1, 0, 0, 0) - 8 * 3600 * 1000;
  return Math.max(1, Math.floor((next - now.getTime()) / 1000));
}

/* ================= 存储 key 约定 =================
 * lzbzq:state            JSON { lastDate, startValue }
 * lzbzq:votes:<date>     hash { 数值 -> 票数 }
 * lzbzq:timeline         list（每日总结记录，最新在前，最多 7 条循环覆盖）
 * lzbzq:events           list（弹幕事件 { t, v }，最新在前，最多 40 条）
 * lzbzq:voted:<ip>:<date>  "1"，TTL 至北京 0 点（每日一票）
 * ================================================= */

function expandVotes(hash) {
  const list = [];
  if (hash) {
    for (const [v, c] of Object.entries(hash)) {
      const n = parseInt(c, 10) || 0;
      for (let i = 0; i < n; i++) list.push(parseInt(v, 10));
    }
  }
  return list;
}

/** 容错解析：兼容 lrange 返回「字符串」或「已被解析的对象」两种形式 */
function parseJsonSafe(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch (e) { return null; }
}

/** 结算某日：返回记录（含档位变化 notes），不写入存储 */
export function settleDay(date, votes, startValue) {
  const end = votes.length ? avg(votes) : startValue;
  const tier = tierOf(end);
  const prevTier = tierOf(startValue);
  const notes = [];
  if (votes.length && end >= 100) notes.push('💥 满格「梁神」：核弹爆炸般的力量！！');
  else if (votes.length && end <= 0) notes.push('🕳 归零「梁西皮」：小难梁拿不出大赢鲸');
  if (tier.name !== prevTier.name) {
    notes.push((end > startValue ? '📈 升级：' : '📉 降级：') + prevTier.name + ' → ' + tier.name);
  }
  const dist = {};
  votes.forEach((v) => { const n = tierOf(v).name; dist[n] = (dist[n] || 0) + 1; });
  return {
    date, end: round1(end), tier: tier.name,
    tierEmoji: tier.emoji, tierColor: tier.color,
    votes: votes.length, notes, dist,
    meme: memeOf(date, tier)          // 按日期稳定的梗句（写库即定型）
  };
}

/** 惰性跨天结算：返回最新 state */
export async function ensureNewDay(store, now) {
  const today = beijingDateStr(now);
  let state = await store.getJSON('lzbzq:state');
  if (!state) {
    state = { lastDate: today, startValue: START_VALUE };
    await store.setJSON('lzbzq:state', state);   // 首次初始化必须写回
  }
  if (state.lastDate !== today) {
    const votes = expandVotes(await store.hgetall('lzbzq:votes:' + state.lastDate));
    const rec = settleDay(state.lastDate, votes, state.startValue);
    state.startValue = rec.end;
    state.lastDate = today;
    await store.setJSON('lzbzq:state', state);
    if (rec.votes > 0) {                      // 每日一条总结，无票日跳过
      await store.lpush('lzbzq:timeline', JSON.stringify(rec));
      await store.ltrim('lzbzq:timeline', 0, TIMELINE_MAX - 1);  // 循环覆盖：挤出最老一天
    }
  }
  return state;
}

/** 计算全站状态（GET /api/state 响应体） */
export async function computeState(store, ip, now) {
  now = now || new Date();
  const state = await ensureNewDay(store, now);
  const today = beijingDateStr(now);
  const list = expandVotes(await store.hgetall('lzbzq:votes:' + today));
  const todayValue = list.length >= MIN_VOTES ? avg(list) : state.startValue;
  const tier = tierOf(todayValue);
  const dist = {};
  list.forEach((v) => { const n = tierOf(v).name; dist[n] = (dist[n] || 0) + 1; });

  let hot = null;
  if (list.length >= HOT_MIN) {
    let bestName = null, bestN = 0;
    for (const k in dist) if (dist[k] > bestN) { bestN = dist[k]; bestName = k; }
    const bt = TIERS.find((t) => t.name === bestName);
    hot = { name: bt.name, emoji: bt.emoji, color: bt.color, votes: bestN };
  }

  const votedToday = !!(await store.get('lzbzq:voted:' + ip + ':' + today));
  const rawTimeline = await store.lrange('lzbzq:timeline', 0, TIMELINE_MAX - 1);
  const timeline = (rawTimeline || []).map(parseJsonSafe).filter(Boolean);
  const rawEvents = await store.lrange('lzbzq:events', 0, EVENTS_MAX - 1);
  const recentVotes = (rawEvents || []).map(parseJsonSafe).filter(Boolean).reverse();

  return {
    startValue: state.startValue,
    todayValue: round1(todayValue),
    tier: tier.name,
    tierEmoji: tier.emoji,
    tierColor: tier.color,
    todayVotes: list.length,
    voteDist: dist,
    timeline,
    recentVotes,
    votedToday,
    hot
  };
}

/** 提交投票（POST /api/vote） */
export async function submitVote(store, ip, value, now) {
  now = now || new Date();
  value = Math.round(Number(value));
  if (isNaN(value) || value < 0 || value > 100) return { ok: false, reason: 'invalid' };
  const today = beijingDateStr(now);
  await ensureNewDay(store, now);
  const votedKey = 'lzbzq:voted:' + ip + ':' + today;
  if (await store.get(votedKey)) return { ok: false, reason: 'already' };
  await store.hincrby('lzbzq:votes:' + today, String(value), 1);
  await store.set(votedKey, '1');
  await store.expire(votedKey, ttlToBeijingMidnight(now));
  // 弹幕事件：时间 + 投票选项
  await store.lpush('lzbzq:events', JSON.stringify({ t: beijingTimeStr(now), v: value }));
  await store.ltrim('lzbzq:events', 0, EVENTS_MAX - 1);
  return { ok: true };
}

/* ================= 内存存储（本地测试） ================= */
export function createMemoryStore() {
  const m = new Map();
  return {
    async getJSON(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async get(k) { const v = m.get(k); return v === undefined ? null : v; },
    async set(k, v) { m.set(k, String(v)); },
    async del(k) { m.delete(k); },
    async expire(k, ttl) { const v = m.get(k); if (v !== undefined) m.set(k, v); /* 内存版忽略 TTL */ },
    async hgetall(k) { const v = m.get(k); return v ? JSON.parse(v) : null; },
    async hincrby(k, field, n) {
      const v = m.get(k) ? JSON.parse(m.get(k)) : {};
      v[field] = (v[field] || 0) + n;
      m.set(k, JSON.stringify(v));
    },
    async lpush(k, val) {
      const v = m.get(k) ? JSON.parse(m.get(k)) : [];
      v.unshift(val);
      m.set(k, JSON.stringify(v));
    },
    async lrange(k, start, stop) {
      const v = m.get(k) ? JSON.parse(m.get(k)) : [];
      if (stop < 0) stop = v.length + stop;
      return v.slice(start, stop + 1);
    },
    async ltrim(k, start, stop) {
      const v = m.get(k) ? JSON.parse(m.get(k)) : [];
      if (stop < 0) stop = v.length + stop;
      m.set(k, JSON.stringify(v.slice(start, stop + 1)));
    },
    _raw: m
  };
}
