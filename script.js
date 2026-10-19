// =====================================================================
// 仲間GM 球団経営  STEP4：セーブ・ドラフト会議・はじめの設定
//
//   試合は結果とハイライトだけ表示する。GMがやることは次の4つ。
//   ・選手の調子を見てスタメンや先発ローテを決める（活躍すると成長する）
//   ・FA獲得・トレード・自由契約でチームを作る
//   ・試合の前に起きる出来事に、選択肢で答える
//   ・スタジアムや練習施設にお金を投資する
//   ・シーズン後のドラフト会議で新人を指名する（1巡目は入札・競合したら抽選）
//
//   進行はブラウザ（localStorage）に自動でセーブされる。
//
// 構成（あとから機能を足しやすいように役割ごとに分けている）
//   Util / Rand               … 共通の小道具・乱数
//   Player / Pitcher / Batter … 選手（能力値・調子・成長・年俸）
//   Team                      … 選手名簿・打順・ローテ・チーム力
//   PlayerFactory             … 相手球団やFAの選手を自動で作る
//   STADIUMS                  … 本拠地にできる球場（学校のグラウンド〜最新ボールパーク）
//   FACILITIES / Finance      … 投資できる施設と、お金・ファン・1試合の精算
//   League                    … 6球団の日程と順位表（自分のリーグと、もう1つの架空リーグ）
//   POSTSEASON                … プレーオフ・日本一決定シリーズのルール
//   SPONSOR_CATALOG           … 営業できるスポンサー企業
//   GameEngine                … 1試合を内部で1打席ずつ計算し、成績を返す
//   EVENTS                    … 試合前に起きる出来事と選択肢
//   GameState                 … ゲーム全体の状態と「出来事→試合→精算→成長→ドラフト」のサイクル
//   Save                      … セーブ（保存・読み込み）
//   UI / Tabs / StartScreen   … 画面の描画・タブ切り替え・タイトルと設定画面
//
// お金の単位はすべて「万円」。（例：10000 = 1億円）
// 選手・球団・スポンサーはすべて架空。
// =====================================================================

// ---------- 共通の小道具 ----------
const Util = {
  clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
  rankOf(v) {
    if (v >= 85) return 'S';
    if (v >= 75) return 'A';
    if (v >= 65) return 'B';
    if (v >= 50) return 'C';
    return 'D';
  },
  money(man) {
    const sign = man < 0 ? '-' : '';
    man = Math.abs(Math.round(man));
    const oku = Math.floor(man / 10000);
    const rest = man % 10000;
    if (oku === 0) return `${sign}${rest.toLocaleString()}万円`;
    return `${sign}${oku}億${rest ? rest.toLocaleString() + '万' : ''}円`;
  },
  signedMoney: man => (man > 0 ? '+' : '') + Util.money(man),
  signed: v => (v > 0 ? '+' : '') + v.toLocaleString(),
  yenToMan: yen => Math.round(yen / 10000),
  esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  rankBadge: (v, size = '') => `<b class="rk rk-${Util.rankOf(v)} ${size}" title="${v}">${Util.rankOf(v)}</b>`,
  winRate: (w, l) => (w + l ? (w / (w + l)).toFixed(3).replace(/^0/, '') : '---'),
  clone: obj => JSON.parse(JSON.stringify(obj)),
  // 能力から年俸の目安（万円）
  salaryFor: ovr => Math.max(400, Math.round(((ovr - 45) ** 2) * 4 / 100) * 100),
  innings: outs => `${Math.floor(outs / 3)}回${outs % 3 ? `${outs % 3}/3` : ''}`,
};

const Rand = {
  range: (a, b) => a + Math.random() * (b - a),
  int: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: arr => arr[Math.floor(Math.random() * arr.length)],
  chance: p => Math.random() < p,
  shuffle: arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
};

// 調子（-2 絶不調 〜 +2 絶好調）
const CONDITION = { 2: '絶好調', 1: '好調', 0: '普通', '-1': '不調', '-2': '絶不調' };
// 調子の顔アイコン（絶好調＝赤の満面の笑み 〜 絶不調＝紫の泣き顔）
const FACE_PARTS = {
  2:    '<path d="M6.3 10.2l1.7-2.1 1.7 2.1M14.3 10.2l1.7-2.1 1.7 2.1" class="fl"/><path d="M6.5 13h11a5.5 5.5 0 0 1-11 0z" class="fm"/><path d="M9.5 16.6a3 2 0 0 0 5 0" class="ft"/>',
  1:    '<circle cx="8.3" cy="9.6" r="1.3" class="fe"/><circle cx="15.7" cy="9.6" r="1.3" class="fe"/><path d="M7.4 13.6q4.6 4.6 9.2 0" class="fl"/>',
  0:    '<circle cx="8.3" cy="9.8" r="1.3" class="fe"/><circle cx="15.7" cy="9.8" r="1.3" class="fe"/><path d="M8.2 15.4h7.6" class="fl"/>',
  '-1': '<circle cx="8.3" cy="10.2" r="1.3" class="fe"/><circle cx="15.7" cy="10.2" r="1.3" class="fe"/><path d="M8 17.2q4-3.6 8 0" class="fl"/>',
  '-2': '<path d="M6.6 8.6l3 1.6M17.4 8.6l-3 1.6" class="fl"/><path d="M7.6 17.8q4.4-4.6 8.8 0" class="fl"/><path d="M19.4 3.2q2 3 0 4.2q-2-1.2 0-4.2z" class="fs"/>',
};
const condIcon = c => `<span class="face f${c}" title="調子：${CONDITION[c]}" role="img" aria-label="調子 ${CONDITION[c]}"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.6" class="fc"/>${FACE_PARTS[c]}</svg></span>`;

// ---------- 選手 ----------
let nextPlayerId = 1;
class Player {
  constructor(d) {
    this.id = d.id || `x${nextPlayerId++}`;
    Object.assign(this, {
      number: d.number, name: d.name, position: d.position, age: d.age, salary: d.salary,
      throws: d.throws || '右', bats: d.bats || '右',
    });
    this.potential = d.potential ?? 75;   // 能力はここまで伸びる
    this.service = d.service ?? Math.max(0, Math.min(15, (d.age || 22) - 22));   // 支配下での在籍年数（FA権に使う）
    this.faSeason = d.faSeason ?? null;    // FAで加入した年（現役ドラフトのリストに載せられない）
    this.condition = d.condition ?? 0;
    this.exp = d.exp ?? 0;                 // 10 たまると能力が1上がる
    this.injured = d.injured ?? 0;         // ケガで休む残り試合
    this.rest = d.rest ?? 0;               // 登板を飛ばす残り試合（投手）
    this.starter = d.starter ?? false;     // スタメン（野手）
    this.origin = d.origin || null;        // ドラフト候補の区分（高校・大学・社会人）
    this.school = d.school || null;        // 出身校・所属
    this.draft = d.draft || null;          // 例：「2026年 1位」
    this.conv = d.conv ?? 0;               // コンバートした位置への不慣れ（守備力のマイナス）。試合や練習で0に近づく
    this.formerPos = d.formerPos || null;  // コンバート前の守備位置
    this.active = d.active ?? true;        // 出場選手登録（1軍）。false なら2軍
    this.benchOut = d.benchOut ?? false;   // GMが「ベンチ外」にした（1軍登録のまま試合には出ない）
    this.down = d.down ?? 0;               // 登録抹消後、再登録できるまでの残り試合
    this.away = d.away ?? 0;               // 日本代表で離れている残り試合
    this.ss = d.ss || null;                // 今シーズンの成績（自分の球団の選手だけ数える）
    this.career = d.career || null;        // 自分の球団での通算成績
    this.story = d.story || null;          // 自分がドラフトで指名した選手の成長の記録
    this.peak = d.peak ?? 0;               // 自分の球団でいちばん高かった総合力
    this.retiring = d.retiring || null;    // 今季限りで引退（'ceremony' 引退試合あり / 'plain'）
    this.stayYear = d.stayYear ?? null;    // 引退をひきとめた年（その年はもう申し出ない）
  }
  get isPitcher() { return false; }
  toJSON() { return { ...this, type: this.isPitcher ? 'P' : 'B' }; }
  get overall() { return 0; }
  get rank() { return Util.rankOf(this.overall); }
  get shortName() { return this.name.split(' ')[0]; }
  get available() { return this.injured === 0 && !(this.away > 0); }
  changeCondition(d) {
    const before = this.condition;
    this.condition = Util.clamp(this.condition + d, -2, 2);
    return this.condition !== before;
  }
  // 経験値を足し、上がった能力の名前を返す
  gainExp(n) {
    this.exp += n;
    const grown = [];
    while (this.exp >= 10) {
      this.exp -= 10;
      const k = this.growStat();
      if (k) grown.push(k);
    }
    return grown;
  }
  // トレード相手の評価（若さ・伸びしろ・年俸・調子）
  get value() {
    return this.overall + (this.age <= 25 ? (this.potential - this.overall) * 0.3 : 0)
      - Math.max(0, this.age - 30) * 1.5 - this.salary / 500 + this.condition;
  }
}

class Pitcher extends Player {
  static STAT_NAMES = { velocity: '球速', control: '制球', stamina: 'スタミナ', breaking: '変化球' };
  constructor(d) {
    super(d);
    this.role = d.role;                  // 先発 / 中継ぎ / 抑え
    this.stats = { ...d.stats };
  }
  get isPitcher() { return true; }
  get velocityScore() { return Util.clamp(Math.round((this.stats.velocity - 117) * 2.3), 1, 100); }
  get overall() {
    const s = this.stats;
    return Math.round(this.velocityScore * 0.3 + s.control * 0.25 + s.breaking * 0.25 + s.stamina * 0.2);
  }
  // 試合での強さ（調子込み）
  get stuff() {
    const s = this.stats;
    return this.velocityScore * 0.35 + s.control * 0.3 + s.breaking * 0.35 + this.condition * 3;
  }
  get controlNow() { return this.stats.control + this.condition * 2; }
  get pitchLimit() { return Math.round(this.stats.stamina * 1.2 + 15); }
  growStat() {
    const cap = this.potential;
    const keys = ['control', 'stamina', 'breaking', 'velocity'].filter(k =>
      k === 'velocity' ? this.stats.velocity < 140 + (cap - 50) * 0.5 : this.stats[k] < cap);
    if (!keys.length) return null;
    const k = Rand.pick(keys);
    this.stats[k]++;
    return Pitcher.STAT_NAMES[k];
  }
}

class Batter extends Player {
  static STAT_NAMES = { contact: 'ミート', power: 'パワー', speed: '走力', defense: '守備' };
  constructor(d) {
    super(d);
    this.stats = { ...d.stats };
  }
  get overall() {
    const s = this.stats;
    return Math.round(s.contact * 0.35 + s.power * 0.3 + s.speed * 0.15 + s.defense * 0.2);
  }
  // 試合での打力（調子込み）
  now(k) {
    const bonus = (k === 'contact' || k === 'power') ? this.condition * 3 : 0;
    return Util.clamp(this.stats[k] + bonus, 1, 99);
  }
  growStat() {
    const keys = Object.keys(this.stats).filter(k => this.stats[k] < this.potential);
    if (!keys.length) return null;
    const k = Rand.pick(keys);
    this.stats[k]++;
    return Batter.STAT_NAMES[k];
  }
}

// 守備位置の略称
const POS_ABBR = { '投手': '投', '捕手': '捕', '一塁手': '一', '二塁手': '二', '三塁手': '三', '遊撃手': '遊', '左翼手': '左', '中堅手': '中', '右翼手': '右', '外野手': '外', '指名打者': 'DH', '控え': '控' };
const FIELD_POS = ['捕手', '一塁手', '二塁手', '三塁手', '遊撃手', '左翼手', '中堅手', '右翼手', '指名打者'];
const OF_POS = ['左翼手', '中堅手', '右翼手'];
// 守備位置ごとの色（バッジ・守備図・一覧で共通）
const POS_KEY = { '投手': 'P', '捕手': 'C', '一塁手': '1B', '二塁手': '2B', '三塁手': '3B', '遊撃手': 'SS', '左翼手': 'LF', '中堅手': 'CF', '右翼手': 'RF', '外野手': 'OF', '指名打者': 'DH' };
const posCls = pos => `pc-${POS_KEY[pos] || 'X'}`;
// 守備位置のバッジ（投手は役割も添える）
const posBadge = p => `<span class="pos-badge ${posCls(p.isPitcher ? '投手' : p.position)}">${p.isPitcher ? '投' : POS_ABBR[p.position] || '?'}</span>`;
const posLabel = p => `${posBadge(p)}${p.isPitcher ? `投手（${E(p.role)}）` : E(p.position)}`;
const IF_POS = ['一塁手', '二塁手', '三塁手', '遊撃手'];
// 本職でない位置を守ると守備力が下がる（同じ内野・外野どうしなら少し、捕手や内外野の入れ替えは大きく）
const isNatural = (p, pos) => pos === '指名打者' || p.position === pos || (p.position === '外野手' && OF_POS.includes(pos));
function offPositionPenalty(p, pos) {
  if (pos === '指名打者') return 0;
  if (isNatural(p, pos)) return p.conv || 0;   // コンバートしたばかりなら、まだ不慣れ
  if (pos === '捕手') return 18;
  const same = (IF_POS.includes(pos) && IF_POS.includes(p.position)) || (OF_POS.includes(pos) && (OF_POS.includes(p.position) || p.position === '外野手'));
  return same ? 5 : 12;
}

// ポジションの区分（投手・捕手・内野手・外野手）
const POS_GROUPS = { P: '投手', C: '捕手', IF: '内野手', OF: '外野手' };
const POS_DEPTH = { P: 5, C: 1, IF: 4, OF: 3 };   // 層の厚さを見るときに数える人数（主力の人数）
const posGroup = p => (p.isPitcher ? 'P' : p.position === '捕手' ? 'C'
  : ['一塁手', '二塁手', '三塁手', '遊撃手', '指名打者'].includes(p.position) ? 'IF' : 'OF');

const makePlayer = d => (d.type === 'P' || d.role ? new Pitcher(d) : new Batter(d));

// ---------- 球団 ----------
class Team {
  // players は支配下（試合に出られる）、farm は育成選手（2軍。試合には出ず練習で育つ）
  constructor({ id, name, short, color, players, farm = [], isMine = false, battingOrder = null }) {
    Object.assign(this, { id, name, short, color, players, farm, isMine });
    this.battingOrder = battingOrder;    // 自分で決めた打順（選手idの並び）。null なら自動
  }
  get pitchers() { return this.players.filter(p => p.isPitcher); }
  get batters() { return this.players.filter(p => !p.isPitcher); }
  // 1軍（出場選手登録）の選手。相手球団は全員が1軍
  get active() { return this.isMine ? this.players.filter(p => p.active) : this.players; }
  // 試合に出られる選手（1軍登録・ベンチ外でない）
  get playable() { return this.active.filter(p => !p.benchOut); }
  // その試合のベンチ入り（最大 benchMax 人）。あふれた分は、その日に投げない先発投手から「上がり」でベンチ外
  benchFor(gameNo, max = 26) {
    const list = this.playable;
    if (list.length <= max) return list;
    const sp = this.starterFor(gameNo), nine = this.lineup;
    const prio = p => (p === sp ? 3000 : nine.includes(p) ? 2000 : p.isPitcher && p.role === '先発' ? p.overall : 1000 + p.overall);
    return [...list].sort((a, b) => prio(b) - prio(a)).slice(0, max);
  }
  get payroll() { return [...this.players, ...this.farm].reduce((sum, p) => sum + p.salary, 0); }
  get closer() { return this.playable.find(p => p.isPitcher && p.role === '抑え' && p.available) || null; }
  get rotation() {
    const pit = this.playable.filter(p => p.isPitcher);
    const r = pit.filter(p => p.role === '先発' && p.available && p.rest === 0);
    return r.length ? r : pit.filter(p => p.available);
  }
  starterFor(gameNo) { const r = this.rotation; return r[gameNo % r.length] || this.pitchers[0]; }

  // 試合に出る9人。自チームはスタメン指定を優先し、足りなければ控えから補う
  get lineup() {
    const healthy = this.playable.filter(p => !p.isPitcher && p.available);
    let st = this.isMine ? healthy.filter(p => p.starter) : healthy;
    if (st.length < 9) {
      const bench = healthy.filter(p => !st.includes(p)).sort((a, b) => b.overall - a.overall);
      st = [...st, ...bench.slice(0, 9 - st.length)];
    }
    st = st.slice(0, 9);
    while (st.length < 9) st.push(Team.filler(st.length));
    const auto = Team.order(st);
    if (!this.isMine || !this.battingOrder) return auto;
    // 手動の打順を優先し、そこにいない選手（新しくスタメンにした人など）は後ろへ
    const key = p => { const i = this.battingOrder.indexOf(p.id); return i >= 0 ? i : 100 + auto.indexOf(p); };
    return [...st].sort((a, b) => key(a) - key(b));
  }
  // 打順：出塁しやすい人→長打の人
  static order(list) {
    const bs = [...list];
    const take = f => bs.splice(bs.indexOf([...bs].sort((a, b) => f(b) - f(a))[0]), 1)[0];
    const o = [];
    o.push(take(p => p.stats.speed + p.stats.contact));
    o.push(take(p => p.stats.contact));
    o.push(take(p => p.stats.contact + p.stats.power));
    o.push(take(p => p.stats.power));
    while (bs.length) o.push(take(p => p.overall));
    return o;
  }
  // 人数が足りないときの穴埋め（2軍から呼ぶ）
  static filler(i) {
    return new Batter({ id: `filler${i}`, number: 90 + i, name: `育成 選手${i + 1}`, position: '控え', age: 19, salary: 0,
      stats: { contact: 38, power: 32, speed: 45, defense: 40 }, potential: 40 });
  }

  // スタメン9人の守備位置を決める。本職を優先し、空いた位置には守備のうまい人から入る（DHは守備が苦手な人）
  // 守る人が少ない（大事な）位置から順に決める
  static FILL_ORDER = ['捕手', '遊撃手', '二塁手', '中堅手', '三塁手', '右翼手', '左翼手', '一塁手'];
  // その位置での守備の評価：本職でなければ大きくマイナス（本職を強く優先する）
  static fieldScore(p, pos) { return p.stats.defense - offPositionPenalty(p, pos) * 2.5; }
  // 打力の評価（調子込み）
  static batScore(p) { return p.now('contact') * 0.45 + p.now('power') * 0.4 + p.stats.speed * 0.15; }
  // 位置ごとに選手を割り当てる共通処理。1周目は本職の選手だけで埋め、2周目で空いた位置に
  // 「本職外のマイナスが小さい人（同じ内野・外野）」→「評価が高い人」の順で入れる
  static assign(pool, score) {
    const rest = [...pool], slots = {};
    const take = (pos, cands) => {
      if (!cands.length) return;
      const best = cands.reduce((a, b) => (score(b, pos) > score(a, pos) ? b : a));
      slots[pos] = best;
      rest.splice(rest.indexOf(best), 1);
    };
    for (const pos of Team.FILL_ORDER) take(pos, rest.filter(p => isNatural(p, pos)));
    for (const pos of Team.FILL_ORDER) {
      if (slots[pos] || !rest.length) continue;
      const min = Math.min(...rest.map(p => offPositionPenalty(p, pos)));
      take(pos, rest.filter(p => offPositionPenalty(p, pos) === min));
    }
    return { slots, rest };
  }
  // スタメン9人の守備位置を決める。本職を最優先し、その中で守備のうまい人。残った1人がDH
  fieldAssign(lineup = this.lineup) {
    const { slots, rest } = Team.assign(lineup, (p, pos) => Team.fieldScore(p, pos));
    if (rest.length) slots['指名打者'] = rest[0];
    return Object.fromEntries(FIELD_POS.filter(pos => slots[pos]).map(pos => [pos, { p: slots[pos], penalty: offPositionPenalty(slots[pos], pos) }]));
  }
  // おまかせオーダー：控えも含めた全野手から、各守備位置に「本職の選手」の中で打力＋守備がいちばんの選手を選ぶ
  // （本職がいない位置だけ近い位置の選手で埋める）。DHには残りでいちばん打てる選手。打順は自動
  autoLineup() {
    const pool = this.playable.filter(p => !p.isPitcher && p.available);
    const { slots, rest } = Team.assign(pool, (p, pos) => Team.batScore(p) * 0.5 + Team.fieldScore(p, pos) * 0.5);
    const chosen = Object.values(slots);
    const dh = rest.sort((a, b) => Team.batScore(b) - Team.batScore(a))[0];
    if (dh) chosen.push(dh);
    this.batters.forEach(p => { p.starter = chosen.includes(p); });
    this.battingOrder = null;
    return chosen;
  }
  get power() {
    const avg = (list, f) => list.length ? Math.round(list.reduce((s, p) => s + f(p), 0) / list.length) : 0;
    const b = this.lineup, pt = this.pitchers.filter(p => p.available);
    const fielders = Object.entries(this.fieldAssign(b)).filter(([pos]) => pos !== '指名打者').map(([, v]) => v);
    return {
      pitching: avg(pt, p => p.overall),
      contact:  avg(b, p => p.stats.contact),
      power:    avg(b, p => p.stats.power),
      speed:    avg(b, p => p.stats.speed),
      defense:  avg(fielders, v => v.p.stats.defense - v.penalty),   // 本職外の守備はマイナス
    };
  }
  get overall() {
    const p = this.power;
    return Math.round(p.pitching * 0.45 + p.contact * 0.2 + p.power * 0.15 + p.speed * 0.05 + p.defense * 0.15);
  }
  get defense() { return this.power.defense; }
}

// ---------- 選手を自動で作る ----------
const PlayerFactory = {
  // 実在の選手・OBの名字と名前をばらして、ランダムに組み合わせる（元の組み合わせ＝実在の本人は出さない）
  REAL: [
    '長嶋 茂雄',
    '王 貞治',
    '野茂 英雄',
    '松井 秀喜',
    '鈴木 一朗',
    '大谷 翔平',
    '田中 将大',
    '山本 由伸',
    '佐々木 朗希',
    '村上 宗隆',
    '岡本 和真',
    '坂本 勇人',
    '菅野 智之',
    '柳田 悠岐',
    '山田 哲人',
    '千賀 滉大',
    '筒香 嘉智',
    '前田 健太',
    '黒田 博樹',
    '落合 博満',
    '原 辰徳',
    '江川 卓',
    '桑田 真澄',
    '清原 和博',
    '古田 敦也',
    '宮本 慎也',
    '高橋 由伸',
    '金本 知憲',
    '阿部 慎之助',
    '小笠原 道大',
    '中田 翔',
    '浅村 栄斗',
    '秋山 翔吾',
    '森 友哉',
    '吉田 正尚',
    '近藤 健介',
    '今宮 健太',
    '甲斐 拓也',
    '源田 壮亮',
    '外崎 修汰',
    '山川 穂高',
    '中村 剛也',
    '栗山 巧',
    '涌井 秀章',
    '岸 孝之',
    '則本 昂大',
    '松坂 大輔',
    '斉藤 和巳',
    '和田 毅',
    '杉内 俊哉',
    '新庄 剛志',
    '稲葉 篤紀',
    '糸井 嘉男',
    '青木 宣親',
    '石井 一久',
    '岩隈 久志',
    '上原 浩治',
    '藤川 球児',
    '岩瀬 仁紀',
    '山崎 武司',
    '立浪 和義',
    '福留 孝介',
    '井端 弘和',
    '荒木 雅博',
    '川上 憲伸',
    '野村 克也',
    '衣笠 祥雄',
    '山本 浩二',
    '掛布 雅之',
    '江夏 豊',
    '村田 修一',
    '内川 聖一',
    '今永 昇太',
    '牧 秀悟',
    '宮崎 敏郎',
    '戸郷 翔征',
    '佐藤 輝明',
    '近本 光司',
    '中野 拓夢',
    '大山 悠輔',
    '森下 暢仁',
    '菊池 涼介',
    '丸 佳浩',
    '栗林 良吏',
    '大瀬良 大地',
    '宮城 大弥',
    '紅林 弘太郎',
    '杉本 裕太郎',
    '平良 海馬',
    '清宮 幸太郎',
    '万波 中正',
    '伊藤 大海',
    '東浜 巨',
    '小園 海斗',
    '根尾 昂',
    '岡林 勇希',
    '細川 成也',
    '石川 雅規',
    '種市 篤暉',
    '荻野 貴司',
    '藤原 恭大',
    '島内 宏明',
    '炭谷 銀仁朗',
    '小久保 裕紀',
    '城島 健司',
    '工藤 公康',
    '武田 翔太',
    '松中 信彦',
    '井口 資仁',
    '川崎 宗則',
    '摂津 正',
    '山本 昌',
    '星野 仙一',
    '金田 正一',
    '張本 勲',
    '福本 豊',
    '山田 久志',
    '東尾 修',
    '秋山 幸二',
    '清水 隆行',
    '二岡 智宏',
    '仁志 敏久',
    '赤星 憲広',
    '鳥谷 敬',
    '矢野 燿大',
    '下柳 剛',
    '谷繁 元信',
    '和田 一浩',
    '森野 将彦',
    '浅尾 拓也',
    '吉見 一起',
    '前田 智徳',
    '緒方 孝市',
    '新井 貴浩',
    '田口 壮',
    '谷 佳知',
    '長谷川 滋利',
    '佐々木 主浩',
    '高津 臣吾',
    '石井 琢朗',
    '鈴木 尚典',
    '三浦 大輔',
    '村田 兆治',
    '伊東 勤',
    '渡辺 久信',
    '中島 宏之',
    '岩村 明憲',
  ],
  get SURN() { return this._surn || (this._surn = [...new Set(this.REAL.map(n => n.split(' ')[0]))]); },
  get GIVEN() { return this._given || (this._given = [...new Set(this.REAL.map(n => n.split(' ')[1]))]); },
  get BLOCK() { return this._block || (this._block = new Set(this.REAL)); },
  POSITIONS: ['捕手', '一塁手', '二塁手', '三塁手', '遊撃手', '左翼手', '中堅手', '右翼手', '指名打者'],
  usedNames: new Set(),

  name() {
    let n;
    do { n = `${Rand.pick(this.SURN)} ${Rand.pick(this.GIVEN)}`; } while (this.usedNames.has(n) || this.BLOCK.has(n));
    this.usedNames.add(n);
    return n;
  },
  pitcher({ level, role, age = Rand.int(21, 34) }) {
    const v = (s = 10) => Util.clamp(Math.round(level + Rand.range(-s, s)), 25, 95);
    const p = new Pitcher({
      number: Rand.int(11, 69), name: this.name(), position: '投手', role, age, salary: 0,
      throws: Rand.chance(0.3) ? '左' : '右',
      stats: {
        velocity: Util.clamp(Math.round(138 + (level - 50) * 0.45 + Rand.range(-4, 5)), 132, 160),
        control: v(), breaking: v(),
        stamina: role === '先発' ? Util.clamp(v(8) + 12, 55, 95) : Util.clamp(v(8) - 25, 25, 55),
      },
      potential: Util.clamp(Math.round(level + (age <= 24 ? Rand.range(10, 25) : Rand.range(2, 8))), 50, 95),
    });
    p.salary = Util.salaryFor(p.overall);
    return p;
  },
  batter({ level, position = Rand.pick(this.POSITIONS), age = Rand.int(20, 35) }) {
    const v = (s = 12) => Util.clamp(Math.round(level + Rand.range(-s, s)), 25, 95);
    const b = new Batter({
      number: Rand.int(0, 69), name: this.name(), position, age, salary: 0,
      bats: Rand.chance(0.35) ? '左' : '右',
      stats: { contact: v(), power: v(15), speed: v(15), defense: position === '指名打者' ? v() - 15 : v() },
      potential: Util.clamp(Math.round(level + (age <= 24 ? Rand.range(10, 25) : Rand.range(2, 8))), 50, 95),
    });
    b.salary = Util.salaryFor(b.overall);
    return b;
  },
  team({ id, name, short, color, strength }) {
    const players = [];
    ['先発', '先発', '先発', '中継ぎ', '抑え'].forEach(role => players.push(this.pitcher({ level: strength, role })));
    this.POSITIONS.forEach(position => players.push(this.batter({ level: strength, position })));
    return new Team({ id, name, short, color, players });
  },
  // FA（自由契約）市場の選手。年俸は少し高め、契約金あり
  freeAgent() {
    const level = Rand.int(56, 76);
    const p = Rand.chance(0.45)
      ? this.pitcher({ level, role: Rand.pick(['先発', '先発', '中継ぎ', '抑え']) })
      : this.batter({ level });
    p.salary = Math.round(p.salary * 1.15 / 100) * 100;
    if (Rand.chance(0.3)) p.condition = Rand.pick([-1, 1, 2]);
    return p;
  },
  // ドラフト候補。高校生は弱いが伸びしろが大きく、社会人はすぐ使える
  SCHOOLS: {
    '高校':   ['港南学園高', '北斗学院高', '桜ヶ丘高', '青葉学院高', '函館港北高', '浪速実業高', '博多明星高', '盛岡北陵高'],
    '大学':   ['北都大', '東日本体育大', '関東総合大', '京洛大', '九州国際大'],
    '社会人': ['北星ガス', 'ハマ鉄工', '帝都自動車', '中部電機'],
    '独立L':  ['北陸ブルーウェーブ', '道南シャチーズ', '四国オリーブス'],
  },
  // 育成ドラフト向き：今はまだ弱いが、伸びしろの幅が大きい
  ikuseiProspect(bonus = 0) {
    const origin = Rand.pick(['高校', '高校', '大学', '独立L']);
    const age = { '高校': 18, '大学': 22, '独立L': Rand.int(19, 24) }[origin];
    const level = Rand.int(34, 46) + bonus;
    const p = Rand.chance(0.45)
      ? this.pitcher({ level, role: Rand.pick(['先発', '中継ぎ']), age })
      : this.batter({ level, age, position: Rand.pick(this.POSITIONS.slice(0, 8)) });
    p.potential = Math.min(99, Rand.int(58, 94) + bonus);
    p.origin = origin;
    p.school = Rand.pick(this.SCHOOLS[origin]);
    p.salary = 0;
    return p;
  },
  draftProspect(bonus = 0) {
    const origin = Rand.pick(['高校', '高校', '大学', '大学', '社会人']);
    const age = { '高校': 18, '大学': 22, '社会人': Rand.int(23, 26) }[origin];
    const level = Rand.int(...{ '高校': [40, 52], '大学': [47, 60], '社会人': [55, 66] }[origin]) + bonus;
    const p = Rand.chance(0.45)
      ? this.pitcher({ level, role: Rand.pick(['先発', '先発', '中継ぎ']), age })
      : this.batter({ level, age, position: Rand.pick(this.POSITIONS.slice(0, 8)) });
    p.potential = Math.min(99, Rand.int(...{ '高校': [76, 96], '大学': [70, 90], '社会人': [62, 80] }[origin]) + bonus);
    p.origin = origin;
    p.school = Rand.pick(this.SCHOOLS[origin]);
    p.salary = 0;
    return p;
  },
  // 掘り出し物（若くて伸びしろが大きい）
  prospect() {
    const p = Rand.chance(0.5)
      ? this.pitcher({ level: 48, role: '中継ぎ', age: Rand.int(19, 22) })
      : this.batter({ level: 48, age: Rand.int(19, 22) });
    p.potential = Rand.int(82, 94);
    p.salary = 400;
    return p;
  },
};

// ---------- 本拠地にできる球場 ----------
// capacity: 収容人数 / op: 1試合の運営費（万円） / goods: 来場者1人あたりのグッズ・飲食（円）
// sponsor: スポンサー収入の倍率 / appeal: 観客の集まりやすさ / fan: 1試合ごとのファン増加
// rain: 雨で客が減る確率 / homeAdv: ホームでの強さ / cost: 移転費（万円） / need: 移転できる条件
const STADIUMS = [
  { id: 'school', type: '学校のグラウンド', suffix: '高校グラウンド', capacity: 3000, op: 650, goods: 300, sponsor: 0.5,
    appeal: 1.0, fan: 0.006, rain: 0.15, homeAdv: 0, cost: 0, need: null,
    desc: '仮設スタンドの手づくり球場。観客は少ないが、地域の子どもたちとの距離が近くファンが増えやすい。' },
  { id: 'river', type: '河川敷球場', suffix: '河川敷球場', capacity: 8000, op: 1300, goods: 500, sponsor: 0.7,
    appeal: 1.0, fan: 0.003, rain: 0.15, homeAdv: 0, cost: 1000, need: null,
    desc: '川沿いの開放的な球場。運営費が安く、ファンが少ないときは市民球場より赤字が小さい。雨に弱い。' },
  { id: 'city', type: '市民球場', suffix: '市民球場', capacity: 24000, op: 3200, goods: 800, sponsor: 1.0,
    appeal: 1.0, fan: 0, rain: 0.1, homeAdv: 0, cost: 5000, need: null,
    desc: '地元に愛される標準的な球場。ここからスタート。' },
  { id: 'stadium', type: 'スタジアム（天然芝）', suffix: 'スタジアム', capacity: 32000, op: 4500, goods: 1100, sponsor: 1.3,
    appeal: 1.05, fan: 0.003, rain: 0.1, homeAdv: 0, cost: 30000, need: { fans: 25000 },
    desc: '天然芝の本格スタジアム。お客さんもスポンサーも増える。' },
  { id: 'dome', type: 'ドーム球場', suffix: 'ドーム', capacity: 40000, op: 6400, goods: 1400, sponsor: 1.6,
    appeal: 1.1, fan: 0.005, rain: 0, homeAdv: 1, cost: 80000, need: { fans: 35000, owner: 70 },
    desc: '屋根つきで雨の心配なし。運営費は高いが、大きく稼げる。' },
  { id: 'ballpark', type: '最新ボールパーク', suffix: 'ボールパーク', capacity: 45000, op: 7500, goods: 1800, sponsor: 2.0,
    appeal: 1.15, fan: 0.008, rain: 0, homeAdv: 2, cost: 150000, need: { fans: 45000, titles: 1 },
    desc: '開閉式屋根の夢の球場。ファンの声援でホームではさらに強くなる。' },
];
const stadiumDef = id => STADIUMS.find(x => x.id === id) || STADIUMS[2];

// ---------- 投資できる施設 ----------
const FACILITIES = {
  goods:    { name: 'グッズショップ',       desc: '来場者1人あたりの売上が増える',     cost: lv => facilityCost(3000, lv),
              effect: lv => `1人 ${(800 + (lv - 1) * 200).toLocaleString()}円` },
  training: { name: '練習施設',             desc: '選手が早く成長する',               cost: lv => facilityCost(4000, lv),
              effect: lv => `成長 +${(lv - 1) * 30}%` },
  pr:       { name: '広報・ファンサービス', desc: '毎試合ファンが増えやすくなる',     cost: lv => facilityCost(2500, lv),
              effect: lv => `ファン +${((lv - 1) * 0.6).toFixed(1)}%/試合` },
  medical:  { name: 'メディカル',           desc: 'ケガをしても早く治る',             cost: lv => facilityCost(3000, lv),
              effect: lv => (lv > 1 ? `ケガ -${lv - 1}試合` : '効果なし') },
  scout:    { name: 'スカウト網',           desc: 'ドラフト候補の力と伸びしろが上がる', cost: lv => facilityCost(3500, lv),
              effect: lv => (lv > 1 ? `候補の力 +${(lv - 1) * 2}` : '効果なし') },
  sales:    { name: '営業部',               desc: 'スポンサー営業の成功率と回数が上がる', cost: lv => facilityCost(3000, lv),
              effect: lv => `成功率 +${(lv - 1) * 5}%・${2 + lv}回/年` },
};
// ---------- 難易度（ゲームの途中でも球団タブで変えられる） ----------
// game: 試合での自チームの後押し / grow: 成長の倍率 / lose: 負けたときのオーナー評価 / tax: 法人税率 / offFixed: オフの固定費
// support: オフに親会社から入る支援金 / payroll: 球団が払う年俸の割合（残りは親会社が負担）
// start: 新しく始めるときの戦力・資金・ファン
const DIFFICULTY = {
  easy:   { name: 'やさしい',   desc: '試合で自チームを強く後押し・選手がぐんぐん育つ・お金にも余裕。はじめての人向け',
            game: 2, grow: 1.8, lose: -2, tax: 0.1, offFixed: 2000, support: 15000, payroll: 0.7, start: { stat: 5, funds: 30000, fans: 24000 } },
  normal: { name: 'ふつう',     desc: '少し後押しあり。頑張れば十分勝てる',
            game: 1, grow: 1.4, lose: -3, tax: 0.2, offFixed: 4000, support: 8000, payroll: 0.85, start: { stat: 2, funds: 20000, fans: 21000 } },
  hard:   { name: 'むずかしい', desc: '後押しなし。戦力も資金もぎりぎり。腕に自信のあるGM向け',
            game: 0, grow: 1.1, lose: -4, tax: 0.3, offFixed: 6000, support: 0, payroll: 1, start: { stat: -2, funds: 12000, fans: 19000 } },
};

// ---------- 資金繰り ----------
const MEDIA_PER_FAN = 0.025;     // 放映権・配信収入（ファン1人あたり・1試合ごと、万円）
// 球団公式のYouTube・SNS（出来事で始められる）。level 1＝広報が兼任 / 2＝専任チーム
const CHANNEL = {
  1: { name: '広報が兼任', fan: 0.002, grow: 0.05, upkeep: 0 },
  2: { name: '専任チーム', fan: 0.004, grow: 0.1,  upkeep: 80 },
};
const CHANNEL_PER_SUB = 0.003;   // 広告・メンバーシップ収入（登録者1人あたり・1試合ごと、万円）
// 興行経費：チケット・グッズ・放映権の売上にかかる原価・手数料・警備など（15試合制で20%。10試合制の古いセーブは0）
const showCostRate = games => Util.clamp((games - 10) * 0.04, 0, 0.4);
// 法人税率とオフの固定費（春季キャンプ・2軍運営・球団職員）は難易度で決まる（DIFFICULTY の tax / offFixed）
const LOAN_MAX = 30000;        // 銀行から借りられる上限（万円）
const LOAN_RATE = 0.0035;      // 借入金の利息（1試合ごと。15試合で約5%）
const FAN_COOL = 0.07;         // オフにファンの熱が冷める割合
const FACILITY_MAX = 5;
const FACILITY_UPKEEP = 200;   // 施設1レベルあたり、1試合ごとの維持費（万円）
const FACILITY_BUILD = 2;      // 工事にかかる試合数（その間は効果なし。工事は1つずつ）
// 上のレベルほど割高になる（Lv1→2 が基本の値段。Lv4→5 は約8倍）
function facilityCost(base, lv) { return Math.round(base * lv * (1 + (lv - 1) * 0.35) / 100) * 100; }
// 高いレベルへの投資はオーナーの承認がいる
const FACILITY_OWNER = { 4: 50, 5: 65 };   // 次のレベル → 必要なオーナー評価

// ---------- 最新設備（出来事で導入をすすめられる。一度入れればずっと効く） ----------
const EQUIPMENT_UPKEEP = 100;   // 最新設備1つあたり、1試合ごとの保守費（万円）
const EQUIPMENT = {
  tracking: { name: 'ボール追跡システム', cost: 6500, effect: '投手の成長 +20%',
              pitch: '球の回転数や変化量をミリ単位で測る最新システム。投手の練習が見える化される。' },
  vr:       { name: 'VR打撃トレーニング', cost: 6000, effect: '野手の成長 +20%',
              pitch: '相手投手の球をVRで何度でも体験できる。大学発のスタートアップが開発した注目の装置。' },
  ai:       { name: 'AI作戦分析',         cost: 9000, effect: '試合で打者・投手の力 +1',
              pitch: '相手の配球や守備位置をAIが分析し、試合前に作戦を出してくれる。' },
  app:      { name: '公式アプリ＆キャッシュレス', cost: 4500, effect: 'グッズ・飲食 1人+150円',
              pitch: 'スマホで注文・決済できる球場アプリ。売店の行列が減って、売上が伸びる。' },
  vision:   { name: '大型ビジョン＆LED照明', cost: 8000, effect: 'ファン増加 +0.3%/試合',
              pitch: '試合の演出が一気に派手に。夜の試合が「映える」と評判になる。' },
};

// ---------- 首脳陣（監督・コーチ）。GMが選んで招へいし、解任もできる ----------
// ability（指導力 40〜90）が高いほど効果が大きい。60で効果なし、空席は代行がつとめるのでマイナス
const STAFF_ROLES = {
  manager:  { name: '監督',           desc: '采配で打者・投手の力が上がる。得意な方針とチームの方針が同じだとさらに効く' },
  batting:  { name: '打撃コーチ',     desc: '試合で打者の力が上がり、野手が早く育つ' },
  pitching: { name: '投手コーチ',     desc: '試合で投手の力が上がり、投手が早く育つ' },
  fielding: { name: '守備走塁コーチ', desc: '守備のミスが減る。指導力70以上なら走塁もうまくなる' },
  farm:     { name: '2軍コーチ',      desc: '育成選手と24歳以下の若手が早く育つ' },
};
const STAFF_TRAITS = ['理論派', '熱血漢', '人情派', 'データ派', '名伯楽', '鬼軍曹', '褒めて伸ばす', '職人肌'];
const STAFF_CAREERS = [
  '地元出身・元プロの名選手', '元・社会人野球の監督', '元メジャーリーガー', '高校野球で全国大会に導いた名将',
  'IT企業出身・データ分析のプロ', '元・独立リーグの監督', '元・ホームラン王', '元・盗塁王の韋駄天',
  '元・実業団のエース', '元・日本代表のコーチ', '元・名キャッチャー', '野球解説者として人気',
];
const staffLevel = st => (st ? (st.ability - 60) / 10 : -1.5);   // 効果の強さ（-2〜+3）。空席は-1.5
const staffSalary = (role, ability) => Math.round((800 + (ability - 40) * 60) * (role === 'manager' ? 1.5 : 1) / 100) * 100;
const StaffFactory = {
  make(role, { ability = Rand.int(48, 88), age = Rand.int(38, 66), years = Rand.int(1, 3) } = {}) {
    return {
      id: `st${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      role, name: PlayerFactory.name(), age, ability, years,
      salary: staffSalary(role, ability),
      trait: Rand.pick(STAFF_TRAITS), career: Rand.pick(STAFF_CAREERS),
      style: role === 'manager' ? Rand.pick(Object.keys(STRATEGIES)) : null,   // 監督の得意な方針
    };
  },
  // 就任中の首脳陣の候補（監督1〜2人＋コーチ）
  market() {
    const roles = ['manager', ...Rand.shuffle(['batting', 'pitching', 'fielding', 'farm', 'manager', 'batting', 'pitching', 'farm'])].slice(0, 6);
    return roles.map(r => this.make(r));
  },
  initial() {
    return Object.fromEntries(Object.keys(STAFF_ROLES).map(r => [r, this.make(r, { ability: r === 'manager' ? 58 : Rand.int(50, 60), years: 2 })]));
  },
};

// ---------- ユニフォーム（球団タブでデザインを変えられる） ----------
const UNI_PATTERNS = { plain: '無地', pin: 'ピンストライプ', stripe: '太ストライプ', raglan: 'ラグラン袖', sash: 'たすき', gradient: 'グラデーション', happi: 'はっぴ風' };
const UNI_FONTS = { script: '筆記体', block: 'ブロック体' };
const UNI_COLORS = ['#ffffff', '#efe9dc', '#f3e6c4', '#c8ccd2', '#9aa0a8', '#111111', '#c9a227', '#1f366a', '#0055a5', '#38a7e0', '#006298', '#1f7a45', '#7cc242',
  '#ffd400', '#f97709', '#e60012', '#860010', '#ff6fa8', '#6b2fa0'];
const UNI_PARTS = { body: '生地の色', main: 'メインカラー（文字・模様）', accent: 'ふち取りの色' };
// 細かい作り（野球ユニフォームの定番。値は文字列で持つ）
const UNI_DETAILS = {
  style:  { name: '型',             opts: { button: 'ボタン式', pullover: 'プルオーバー' } },
  piping: { name: 'パイピング（ふち取りライン）', opts: { '0': 'なし', '1': 'あり' } },
  sleeve: { name: '袖のライン',     opts: { none: 'なし', one: '1本', two: '2本' } },
  panel:  { name: '切り替え（メインカラー）', opts: { none: 'なし', shoulder: '肩', side: 'わき', sleeve: '袖' } },
  swoosh: { name: '胸文字の下線（テールスウッシュ）', opts: { '0': 'なし', '1': 'あり' } },
  shadow: { name: '影付き文字',     opts: { '0': 'なし', '1': 'あり' } },
};
const UNI_DEFAULT_DETAIL = { style: 'button', piping: '0', sleeve: 'none', panel: 'none', swoosh: '0', shadow: '0' };
// テンプレート（特定の球団ではなく、よくある雰囲気のデザイン）。T はチームカラー
const UNI_TEMPLATES = [
  { id: 'home',    name: '伝統のホーム',   make: T => ({ body: '#ffffff', main: T, accent: '#111111', pattern: 'pin', font: 'script', swoosh: '1' }) },
  { id: 'visitor', name: 'ビジター',       make: T => ({ body: '#c8ccd2', main: T, accent: '#ffffff', pattern: 'plain', font: 'block', piping: '1', sleeve: 'two', shadow: '1' }) },
  { id: 'retro',   name: '復刻ユニ',       make: T => ({ body: '#f3e6c4', main: T, accent: '#111111', pattern: 'plain', font: 'script', style: 'pullover', piping: '1', sleeve: 'two', swoosh: '1' }) },
  { id: 'matsuri', name: '夏祭りユニ',     make: T => ({ body: T, main: '#ffffff', accent: '#e60012', pattern: 'happi', font: 'block', shadow: '1' }) },
  { id: 'sunset',  name: 'サンセット',     make: () => ({ body: '#ffd400', main: '#e60012', accent: '#6b2fa0', pattern: 'gradient', font: 'block', sleeve: 'one', shadow: '1' }) },
  { id: 'gold',    name: '優勝記念ゴールド', make: () => ({ body: '#111111', main: '#c9a227', accent: '#ffffff', pattern: 'pin', font: 'script', piping: '1', swoosh: '1', shadow: '1' }) },
  { id: 'black',   name: 'ブラック',       make: T => ({ body: '#111111', main: T, accent: '#ffffff', pattern: 'plain', font: 'block', panel: 'side', sleeve: 'one' }) },
  { id: 'sky',     name: 'スカイブルー',   make: () => ({ body: '#38a7e0', main: '#ffffff', accent: '#1f366a', pattern: 'plain', font: 'block', piping: '1', panel: 'shoulder' }) },
];
// テンプレートをチームカラーで作る（色が生地とかぶるときは紺にする）
const uniTemplate = (id, T, text) => {
  const t = UNI_TEMPLATES.find(x => x.id === id) || UNI_TEMPLATES[0];
  const u = { ...UNI_DEFAULT_DETAIL, ...t.make(T), text };
  if (u.main === u.body) u.main = u.body === '#1f366a' ? '#ffffff' : '#1f366a';
  return u;
};
const UNIFORM_COST = 1000;   // 新ユニフォームの発表にかかるお金（万円）
const UNIFORM_HYPE = 5;      // 発表後、グッズが売れやすい試合数
const defaultUniform = (color, text) => uniTemplate('home', color || '#1f366a', text || 'TEAM');
// 胸の文字：選んだ球団の略称のままならローマ字（Hiroshima など）、自分で変えた略称ならそれを使う
const chestText = pf => { const t = teamDef(pf.pick); return t && t.en && pf.short === t.short ? t.en : pf.short; };
let uniSeq = 0;
// ユニフォームの絵（前から見た形）。num は背番号（胸の左下に小さく入る）
function uniformSVG(u, num = 18) {
  u = { ...UNI_DEFAULT_DETAIL, ...u };
  const id = `uni${++uniSeq}`;
  const shape = 'M62 22 L86 12 Q100 26 114 12 L138 22 L186 52 L168 86 L146 74 L146 190 L54 190 L54 74 L32 86 L14 52 Z';
  const both = d => d + ' ' + d.replace(/(-?\d+(\.\d+)?) (-?\d+(\.\d+)?)/g, (m, x, _, y) => `${200 - Number(x)} ${y}`);   // 左右対称にする
  const pat = {
    pin: Array.from({ length: 17 }, (_, i) => `<rect x="${14 + i * 10.5}" y="0" width="1.6" height="200" fill="${u.main}" opacity=".55"/>`).join(''),
    stripe: Array.from({ length: 6 }, (_, i) => `<rect x="${8 + i * 32}" y="0" width="14" height="200" fill="${u.main}" opacity=".85"/>`).join(''),
    raglan: `<path d="${both('M86 12 L62 22 L14 52 L32 86 L54 74 L54 60 Z')}" fill="${u.main}"/>`,
    sash: `<path d="M40 40 L70 20 L170 170 L140 195 Z" fill="${u.main}" opacity=".9"/>`,
    gradient: `<rect x="0" y="0" width="200" height="200" fill="url(#${id}g)"/>`,
    happi: `<path d="M86 12 L100 26 L114 12 L118 14 L108 190 L92 190 L82 14 Z" fill="${u.main}"/>`
      + Array.from({ length: 10 }, (_, i) => `<rect x="${54 + i * 9.2}" y="${i % 2 ? 172 : 181}" width="9.2" height="9" fill="${u.main}"/>`).join('')
      + Array.from({ length: 10 }, (_, i) => `<rect x="${54 + i * 9.2}" y="${i % 2 ? 181 : 172}" width="9.2" height="9" fill="${u.accent}"/>`).join(''),
    plain: '',
  }[u.pattern] || '';
  const panel = {
    shoulder: `<rect x="0" y="0" width="200" height="34" fill="${u.main}"/>`,
    side: `<rect x="54" y="74" width="11" height="120" fill="${u.main}"/><rect x="135" y="74" width="11" height="120" fill="${u.main}"/>`,
    sleeve: `<path d="${both('M62 22 L14 52 L32 86 L54 74 Z')}" fill="${u.main}"/>`,
    none: '',
  }[u.panel] || '';
  // 袖のライン（袖口に平行）
  const sl = n => both(`M${14 + n * 7} ${52 - n * 3.5} L${32 + n * 7} ${86 - n * 3.5}`);
  const sleeve = u.sleeve === 'one' ? `<path d="${sl(1.4)}" stroke="${u.main}" stroke-width="4"/>`
    : u.sleeve === 'two' ? `<path d="${sl(1.2)}" stroke="${u.main}" stroke-width="3"/><path d="${sl(2.2)}" stroke="${u.accent}" stroke-width="3"/>` : '';
  // 前立て：ボタン式は下まで、プルオーバーは胸まで
  const pull = u.style === 'pullover', placketEnd = pull ? 58 : 190;
  const buttons = (pull ? [40, 52] : [42, 66, 112, 136, 160, 182]).map(y => `<circle cx="104" cy="${y}" r="2.2" fill="${u.body}" stroke="${u.accent}" stroke-width="1"/>`).join('');
  const piping = u.piping === '1'
    ? `<path d="${shape}" fill="none" stroke="${u.accent}" stroke-width="6"/><path d="M100 26 L100 ${placketEnd}" stroke="${u.accent}" stroke-width="3"/>`
    : `<path d="M100 26 L100 ${placketEnd}" stroke="${u.accent}" stroke-width="1.5" opacity=".6"/>`;
  const t = String(u.text || '').slice(0, 10);
  const fs = Math.max(11, Math.min(18, Math.round(120 / Math.max(4, t.length))));   // 胸におさまる大きさ（短い文字でも大きくしすぎない）
  const font = u.font === 'block' ? `font-family="Impact,'Arial Black',sans-serif" font-weight="900"` : `font-family="'Brush Script MT','Segoe Script',cursive" font-style="italic" font-weight="700"`;
  const ty = 70 + fs / 3;   // 胸の高さ
  const shadow = u.shadow === '1' ? `<text x="102.5" y="${ty + 2.5}" text-anchor="middle" font-size="${fs}" ${font} fill="${u.accent}">${E(t)}</text>` : '';
  const swoosh = u.swoosh === '1' ? `<path d="M66 ${ty + 7} Q108 ${ty + 2} 142 ${ty - 9}" fill="none" stroke="${u.accent}" stroke-width="5" stroke-linecap="round"/><path d="M66 ${ty + 7} Q108 ${ty + 2} 142 ${ty - 9}" fill="none" stroke="${u.main}" stroke-width="2.6" stroke-linecap="round"/>` : '';
  return `<svg class="uni-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="ユニフォーム">
    <defs><clipPath id="${id}c"><path d="${shape}"/></clipPath>
      <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${u.body}"/><stop offset="1" stop-color="${u.main}"/></linearGradient></defs>
    <path d="${shape}" fill="${u.body}"/>
    <g clip-path="url(#${id}c)">${pat}${panel}${sleeve}${piping}${buttons}</g>
    <path d="M86 12 Q100 26 114 12" fill="none" stroke="${u.accent}" stroke-width="5"/>
    <path d="M32 86 L14 52 M168 86 L186 52" stroke="${u.accent}" stroke-width="6"/>
    <path d="${shape}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
    <g transform="rotate(-6 100 70)">${swoosh}${shadow}
      <text x="100" y="${ty}" text-anchor="middle" font-size="${fs}" ${font} fill="${u.main}" stroke="${u.accent}" stroke-width="1.4" paint-order="stroke">${E(t)}</text></g>
    <text x="74" y="150" text-anchor="middle" font-size="24" font-family="Impact,'Arial Black',sans-serif" fill="${u.main}" stroke="${u.accent}" stroke-width="1.2" paint-order="stroke">${num}</text>
  </svg>`;
}

// ---------- 経営（お金・ファン） ----------
class Finance {
  constructor({ funds, fans, ticketPrice, sponsors, stadiumId = 'city', channel = null, uniformHype = 0 }, facilities, equipment = []) {
    Object.assign(this, { funds, fans, ticketPrice, sponsors, stadiumId, uniformHype });   // uniformHype：新ユニフォームでグッズが売れる残り試合
    this.channel = channel || { level: 0, subs: 0 };   // 球団公式のYouTube・SNS
    this.facilities = facilities;
    this.equipment = equipment;          // 導入した最新設備（GameState と同じ配列）
    this.lastReport = null;
  }
  get park() { return stadiumDef(this.stadiumId); }
  get capacity() { return this.park.capacity; }
  hasPerk(k) { return this.sponsors.some(sp => sponsorPerk(sp) === k); }   // スポンサーの特典
  get operatingCost() { return Math.round(this.park.op * (this.hasPerk('travel') ? 0.95 : 1)); }
  get goodsPerFan() { return this.park.goods + (this.facilities.goods - 1) * 200 + (this.equipment.includes('app') ? 150 : 0) + (this.hasPerk('goods') ? 100 : 0) + (this.uniformHype > 0 ? 300 : 0); }
  get prBonus() { return (this.facilities.pr - 1) * 0.006 + this.park.fan + (this.equipment.includes('vision') ? 0.003 : 0) + (this.hasPerk('fans') ? 0.003 : 0) + (this.channel.level ? CHANNEL[this.channel.level].fan : 0); }
  // 施設の維持費：投資したレベルの合計 × 150万円 / 試合
  get upkeep() { return Object.values(this.facilities).reduce((s, lv) => s + (lv - 1), 0) * FACILITY_UPKEEP + this.equipment.length * EQUIPMENT_UPKEEP + (this.channel.level ? CHANNEL[this.channel.level].upkeep : 0); }
  get sponsorBase() { return this.sponsors.reduce((s, x) => s + x.amount, 0); }
  get sponsorTotal() { return Math.round(this.sponsorBase * this.park.sponsor); }

  // 需要率：5,000円までは値段に比例して下がり、それより高いとプレミア価格として急に売れなくなる
  demandRate(price = this.ticketPrice) {
    const base = price <= 5000 ? 1.55 - price / 4000 : 0.3 * (5000 / price) ** 2.5;
    return Util.clamp(base * this.park.appeal, 0, 1.4);
  }
  estimateAttendance(price = this.ticketPrice) { return Math.min(this.capacity, Math.round(this.fans * this.demandRate(price))); }
  estimateTicketIncome(price = this.ticketPrice) { return Util.yenToMan(this.estimateAttendance(price) * price); }
  breakdown({ payroll, gamesPerSeason }) {
    const attendance = this.estimateAttendance();
    const income = {
      ticket: this.estimateTicketIncome(),
      goods: Util.yenToMan(attendance * this.goodsPerFan),
      sponsor: Math.round(this.sponsorTotal / gamesPerSeason),
      media: Math.round(this.fans * MEDIA_PER_FAN),   // 放映権・配信。球場に入りきらないファンもお金になる
      channel: this.channel.level ? Math.round(this.channel.subs * CHANNEL_PER_SUB) : 0,   // 公式チャンネルの広告収入
    };
    const expense = { salary: Math.round(payroll / gamesPerSeason), operation: this.operatingCost, facility: this.upkeep,
      show: Math.round((income.ticket + income.goods + income.media + income.channel) * showCostRate(gamesPerSeason)) };
    const net = income.ticket + income.goods + income.sponsor + income.media + income.channel - expense.salary - expense.operation - expense.facility - expense.show;
    return { attendance, income, expense, net, sellout: attendance >= this.capacity };
  }
  fanRateByPrice(price = this.ticketPrice) { return Math.max(-0.1, 0.015 - ((price - 2000) / 2000) * 0.03) + this.prBonus; }   // 1試合で減るのは最大10%
  reaction(price = this.ticketPrice) {
    const r = this.fanRateByPrice(price);
    if (r >= 0.012) return { text: 'お得！ファンが増えそう', cls: 'good' };
    if (r >= 0) return { text: 'ちょうどいい値段', cls: '' };
    if (r >= -0.03) return { text: '少し高いという声も（ファン減少）', cls: 'bad' };
    if (price >= 20000) return { text: 'プレミア価格！ほとんど売れず、ファンが大きく離れる', cls: 'bad' };
    return { text: '高すぎる！ファンが離れていく', cls: 'bad' };
  }
  settle({ payroll, gamesPerSeason, outcome, home }) {
    const b = this.breakdown({ payroll, gamesPerSeason });
    // 屋外の球場では、雨の日はお客さんが4割減る
    if (home && Rand.chance(this.park.rain)) {
      const lost = Math.round(b.attendance * 0.4);
      const lostMoney = Util.yenToMan(lost * this.ticketPrice) + Util.yenToMan(lost * this.goodsPerFan);
      b.attendance -= lost;
      b.income.ticket = Util.yenToMan(b.attendance * this.ticketPrice);
      b.income.goods = Util.yenToMan(b.attendance * this.goodsPerFan);
      b.net -= lostMoney;
      const showBack = Math.round(lostMoney * showCostRate(gamesPerSeason));   // 売上が減った分、興行経費も減る
      b.expense.show -= showBack; b.net += showBack;
      b.rain = true;
      b.sellout = false;
    }
    this.funds += b.net;
    const before = this.fans;
    const rate = this.fanRateByPrice() + (outcome === 'win' ? 0.01 : outcome === 'lose' ? -0.012 : 0);
    this.fans = Util.clamp(Math.round(this.fans * (1 + rate)), 3000, 90000);
    // 公式チャンネルの登録者は試合のたびに増える（勝つと伸びやすい）
    if (this.uniformHype > 0) this.uniformHype--;
    if (this.channel.level) this.channel.subs += Math.round(before * CHANNEL[this.channel.level].grow * (outcome === 'win' ? 1.3 : 1));
    this.lastReport = { ...b, price: this.ticketPrice, fansBefore: before, fansAfter: this.fans };
    return this.lastReport;
  }
}

// ---------- リーグ（日程と順位表） ----------
class League {
  constructor({ teams, myTeamId, gamesPerSeason }) {
    Object.assign(this, { teams, myTeamId, gamesPerSeason });
    this.reset();
  }
  get opponents() { return this.teams.filter(t => t.id !== this.myTeamId); }
  team(id) { return this.teams.find(t => t.id === id); }
  reset() {
    const opp = this.opponents;
    this.schedule = Array.from({ length: this.gamesPerSeason }, (_, i) => ({ no: i + 1, opponentId: opp[i % opp.length].id, home: i % 2 === 0 }));
    this.table = Object.fromEntries(this.teams.map(t => [t.id, { w: 0, l: 0, d: 0 }]));
  }
  record(id, outcome) {
    const r = this.table[id];
    if (outcome === 'win') r.w++; else if (outcome === 'lose') r.l++; else r.d++;
  }
  playOtherGames(excludeIds) {
    const rest = Rand.shuffle(this.teams.filter(t => !excludeIds.includes(t.id)));
    for (let i = 0; i + 1 < rest.length; i += 2) {
      const a = rest[i], b = rest[i + 1];
      if (Rand.chance(0.05)) { this.record(a.id, 'draw'); this.record(b.id, 'draw'); continue; }
      const aWin = Rand.chance(1 / (1 + Math.exp(-(a.overall - b.overall) / 8)));
      this.record(a.id, aWin ? 'win' : 'lose');
      this.record(b.id, aWin ? 'lose' : 'win');
    }
  }
  get standings() {
    const rows = this.teams.map(t => ({ team: t, ...this.table[t.id] }));
    const rate = r => (r.w + r.l ? r.w / (r.w + r.l) : 0.5);
    rows.sort((a, b) => rate(b) - rate(a) || b.w - a.w);
    const top = rows[0];
    rows.forEach(r => { r.gb = ((top.w - r.w) + (r.l - top.l)) / 2; });
    return rows;
  }
  rankOf(id) { return this.standings.findIndex(r => r.team.id === id) + 1; }
}

// ---------- 1試合の計算（画面には結果と成績だけ出す） ----------
class GameEngine {
  static MAX_INNINGS = 12;
  constructor({ home, away, gameNo, homeAdv = 0, styles = {}, bonus = {} }) { Object.assign(this, { home, away, gameNo, homeAdv, styles, bonus }); }

  simulate() {
    this.sides = { away: this.makeSide(this.away, this.bonus.away || 0, this.styles.away), home: this.makeSide(this.home, this.homeAdv + (this.bonus.home || 0), this.styles.home) };
    this.board = { away: [], home: [] };
    this.totals = { away: { R: 0, H: 0, E: 0 }, home: { R: 0, H: 0, E: 0 } };
    this.bat = {};                       // 打者成績 id → {pa,h,hr,rbi,k}
    this.pit = {};                       // 投手成績 id → {outs,r,k}
    this.walkOff = false;
    const starters = { away: this.sides.away.pitcher, home: this.sides.home.pitcher };

    let inning = 1;
    for (;;) {
      let ended = false;
      for (const half of ['away', 'home']) {
        if (half === 'home' && inning >= 9 && this.totals.home.R > this.totals.away.R) { this.board.home.push('X'); ended = true; break; }
        this.playHalf(inning, half);
        if (this.walkOff) { ended = true; break; }
      }
      if (ended) break;
      if (inning >= 9 && this.totals.home.R !== this.totals.away.R) break;
      if (inning >= GameEngine.MAX_INNINGS) break;
      inning++;
    }
    const h = this.totals.home.R, a = this.totals.away.R;
    return {
      board: this.board, totals: this.totals, innings: inning, walkOff: this.walkOff,
      winner: h > a ? 'home' : a > h ? 'away' : null,
      bat: this.bat, pit: this.pit, starters,
      lineups: { away: this.sides.away.order, home: this.sides.home.order },
    };
  }
  makeSide(team, bonus, style = NO_STYLE) {
    const bench = team.benchFor(this.gameNo);
    return { team, bonus, style, bench, order: team.lineup, next: 0, pitcher: team.starterFor(this.gameNo), pitches: 0, inningsByPitcher: 0, used: new Set() };
  }
  managePitcher(side, inning, lead) {
    const t = side.team, p = side.pitcher;
    side.used.add(p.id);
    const change = to => { if (!to || to === p) return; side.pitcher = to; side.pitches = 0; side.inningsByPitcher = 0; side.used.add(to.id); };
    const closer = t.closer && side.bench.includes(t.closer) ? t.closer : null;
    if (inning >= 9 && lead > 0 && lead <= 3 && closer && !side.used.has(closer.id)) return change(closer);
    const tired = side.pitches >= p.pitchLimit;
    const relieverDone = p.role !== '先発' && side.inningsByPitcher >= 2;
    if (!tired && !relieverDone) return;
    const fresh = side.bench.filter(x => x.isPitcher && x.available && !side.used.has(x.id));
    change(fresh.find(x => x.role === '中継ぎ') || (inning >= 8 ? fresh.find(x => x.role === '抑え') : null) || fresh.find(x => x.role === '先発') || fresh[0]);
  }
  line(map, id, init) { return map[id] || (map[id] = { ...init }); }

  playHalf(inning, half) {
    const bat = this.sides[half];
    const fieldKey = half === 'away' ? 'home' : 'away';
    const field = this.sides[fieldKey];
    this.managePitcher(field, inning, this.totals[fieldKey].R - this.totals[half].R);
    this.board[half].push(0);
    const idx = this.board[half].length - 1;
    this.state = { outs: 0, bases: [null, null, null] };
    this.batSide = bat;

    while (this.state.outs < 3) {
      const batter = bat.order[bat.next++ % bat.order.length];
      const pitcher = field.pitcher;
      const bl = this.line(this.bat, batter.id, { pa: 0, h: 0, hr: 0, rbi: 0, k: 0 });
      const pl = this.line(this.pit, pitcher.id, { outs: 0, r: 0, k: 0 });
      const outsBefore = this.state.outs;
      const r = this.atBat(batter, field);
      field.pitches += r.pitches;
      const scored = this.apply(r, batter);
      bl.pa++;
      pl.outs += this.state.outs - outsBefore;
      if (r.kind === 'k') { bl.k++; pl.k++; }
      if (r.kind === 'hit') { bl.h++; this.totals[half].H++; if (r.bases === 4) bl.hr++; }
      if (r.kind === 'error') this.totals[fieldKey].E++;
      if (scored.length) {
        this.totals[half].R += scored.length;
        this.board[half][idx] += scored.length;
        pl.r += scored.length;
        if (r.kind !== 'error') bl.rbi += scored.length;
      }
      if (half === 'home' && inning >= 9 && this.totals.home.R > this.totals.away.R) { this.walkOff = true; return; }
    }
    field.inningsByPitcher++;
  }
  atBat(batter, field) {
    const p = field.pitcher;
    const fatigue = Math.max(0, field.pitches - p.pitchLimit) * 0.5;
    const bat = field === this.sides.home ? this.sides.away : this.sides.home;
    const styleBat = bat.style.bat + (bat.style.run && batter.stats.speed >= 70 ? 3 : 0);
    const d = (batter.now('contact') + bat.bonus * 2 + styleBat - (p.stuff + field.bonus * 2 + field.style.pitch - fatigue)) / 100;
    const pK = Util.clamp(0.2 - d * 0.22, 0.07, 0.34);
    const pBB = Util.clamp(0.085 - (p.controlNow - fatigue - 60) / 100 * 0.08, 0.03, 0.16);
    const pHit = Util.clamp(0.235 + d * 0.22, 0.14, 0.37);
    const pErr = (1 - (field.team.defense + (field.style.def || 0)) / 100) * 0.035;
    const r = Math.random();
    if (r < pK) return { kind: 'k', pitches: Rand.int(4, 7) };
    if (r < pK + pBB) return { kind: 'walk', pitches: Rand.int(4, 7) };
    if (r < pK + pBB + pHit) {
      const pw = batter.now('power') + bat.style.bat;
      const pHR = Util.clamp(0.03 + (pw - 50) / 100 * 0.22, 0.01, 0.28);
      const p3B = batter.stats.speed >= 80 ? 0.04 : 0.01;
      const p2B = Util.clamp(0.16 + (pw - 50) / 100 * 0.1, 0.1, 0.25);
      const h = Math.random();
      const bases = h < pHR ? 4 : h < pHR + p3B ? 3 : h < pHR + p3B + p2B ? 2 : 1;
      return { kind: 'hit', bases, pitches: Rand.int(1, 6) };
    }
    if (r < pK + pBB + pHit + pErr) return { kind: 'error', pitches: Rand.int(1, 5) };
    const t = Math.random();
    return { kind: t < 0.45 ? 'ground' : t < 0.85 ? 'fly' : 'liner', pitches: Rand.int(1, 6) };
  }
  apply(r, batter) {
    const s = this.state, b = s.bases, scored = [];
    const fast = p => p && p.stats.speed >= (this.batSide && this.batSide.style.run ? 60 : 70);
    if (r.kind === 'k' || r.kind === 'liner') { s.outs++; return scored; }
    if (r.kind === 'walk') {
      if (b[0]) { if (b[1]) { if (b[2]) scored.push(b[2]); b[2] = b[1]; } b[1] = b[0]; }
      b[0] = batter;
      return scored;
    }
    if (r.kind === 'hit' || r.kind === 'error') {
      const n = r.kind === 'error' ? 1 : r.bases;
      if (n === 4) { scored.push(...b.filter(Boolean), batter); s.bases = [null, null, null]; return scored; }
      if (n === 3) { scored.push(...b.filter(Boolean)); s.bases = [null, null, batter]; return scored; }
      if (n === 2) {
        if (b[2]) scored.push(b[2]);
        if (b[1]) scored.push(b[1]);
        let third = null;
        if (b[0]) { if (Rand.chance(fast(b[0]) ? 0.6 : 0.35)) scored.push(b[0]); else third = b[0]; }
        s.bases = [null, batter, third];
        return scored;
      }
      if (b[2]) scored.push(b[2]);
      let second = null, third = null;
      if (b[1]) { if (r.kind === 'hit' && Rand.chance(fast(b[1]) ? 0.75 : 0.5)) scored.push(b[1]); else third = b[1]; }
      if (b[0]) { if (!third && r.kind === 'hit' && Rand.chance(fast(b[0]) ? 0.4 : 0.2)) third = b[0]; else second = b[0]; }
      s.bases = [batter, second, third];
      return scored;
    }
    if (r.kind === 'ground') {
      if (b[0] && s.outs < 2 && Rand.chance(0.45 - batter.stats.speed / 400)) {
        s.outs += 2; b[0] = null;
        if (s.outs < 3) { if (b[2]) scored.push(b[2]); b[2] = b[1]; b[1] = null; }
        return scored;
      }
      s.outs++;
      if (s.outs < 3 && Rand.chance(0.5)) { if (b[2]) scored.push(b[2]); s.bases = [null, b[0], b[1]]; }
      return scored;
    }
    s.outs++;
    if (b[2] && s.outs < 3 && Rand.chance(0.65)) { scored.push(b[2]); b[2] = null; }
    return scored;
  }
}

// ---------- 試合前の出来事（GMの決断） ----------
// cond: 起きる条件 / make: 誰に起きるか / choices: 選択肢（run が結果の文章を返す。label・desc は関数でもよい）
const addOwner = (g, n) => { g.ownerRating = Util.clamp(g.ownerRating + n, 0, 100); };
const evText = (v, g, d) => (typeof v === 'function' ? v(g, d) : v);
// 支配下からランダムに n 人（名前を返す）の調子を変える
// ---------- 選手のドラマ（成績・引退・永久欠番・宿敵） ----------
const blankSS = () => ({ g: 0, pa: 0, h: 0, hr: 0, rbi: 0, pg: 0, outs: 0, r: 0 });
const addSS = (a, b) => { const o = { ...blankSS(), ...a }; Object.keys(blankSS()).forEach(k => { o[k] += (b && b[k]) || 0; }); return o; };
const ssLine = (p, s) => (p.isPitcher ? `${s.pg}試合 ${Util.innings(s.outs)} ${s.r}失点` : `${s.h}安打 ${s.hr}本塁打 ${s.rbi}打点`);
// 引退を申し出そうなベテラン（35歳以上で衰えてきた選手、38歳以上は必ず）
const retireCands = g => g.team.players.filter(p => !p.retiring && p.stayYear !== g.season && (p.age >= 38 || (p.age >= 35 && p.overall < 64)))
  .sort((a, b) => b.age - a.age);
// 永久欠番にふさわしい選手（主力として活躍した／長く在籍した）
const isLegend = p => Math.max(p.peak || 0, p.overall) >= 74 || p.service >= 12;
const careerText = p => { const c = p.career; if (!c) return ''; return p.isPitcher ? `（通算 ${Util.innings(c.outs)}・${c.pg}登板）` : `（通算 ${c.h}安打・${c.hr}本塁打）`; };
// スポンサーの出来事用：契約中（ネーミングライツ以外）／まだ契約していない会社
const spList = g => g.finance.sponsors.filter(sp => !sp.naming);
const spOpen = g => SPONSOR_CATALOG.filter(c => !c.naming && !g.finance.sponsors.some(sp => sp.name === c.name) && !g.salesLock(c));
const spRaise = (sp, r) => { const up = Math.max(100, Math.round(sp.amount * r / 100) * 100); sp.amount += up; return up; };
const spSign = (g, c, amount) => {
  g.finance.sponsors.push({ name: c.name, tier: c.tier, amount, years: c.years, perk: c.perkKey || null });
  const o = (g.offers || []).find(x => x.name === c.name); if (o) o.status = 'ok';
  g.gmCount('sponsor');
  return `${c.name}とスポンサー契約！（${c.tier}・年${Util.money(amount)}×${c.years}年）${c.perk ? `特典：${c.perk}。` : ''}`;
};
// 地域の出来事で使う地名（都道府県や地方の呼び方）
const REGION_NAME = { bib: '東京', jin: '東京', tom: '横浜', spr: '名古屋', tky: '兵庫', nnw: '広島', yok: '福岡', ngy: '北海道', hir: '宮城', kob: '千葉', snd: '埼玉', hkt: '大阪' };
// 地域の出来事：まだ今シーズン出ていないもの
const regionLeft = g => (REGION_EVENTS[g.profile.pick] || []).filter(r => !(g.flags.regionUsed || []).includes(r.name));
// 地域の出来事の選択肢（種類ごと）
const REGION_CHOICES = {
  fest: [
    { label: '球団をあげて参加する（500万円）', desc: 'ファン+1,500人。参加した選手の調子が上がる', cost: 500,
      run: (g, d) => { g.finance.funds -= 500; g.finance.fans += 1500; const n = moodSome(g, 3, 1); return `「${d.name}」を地元の人たちと一緒に楽しんだ！ ${n.join('・')}の調子が上がった（ファン+1,500人）。`; } },
    { label: '選手だけ参加する', desc: 'ファン+600人', run: (g, d) => { g.finance.fans += 600; return `「${d.name}」に参加した選手が大人気だった（ファン+600人）。`; } },
  ],
  season: [
    { label: (g, d) => `球場で「${d.name}ナイト」を開く（400万円）`, desc: 'ファン+1,300人。限定グッズが売れることも', cost: 400,
      run: (g, d) => { g.finance.funds -= 400; g.finance.fans += 1300; if (Rand.chance(0.5)) { g.finance.funds += 700; return `「${d.name}ナイト」は大盛況！ 限定グッズも売れて+700万円・ファン+1,300人。`; } return `「${d.name}ナイト」で球場が季節ムードに（ファン+1,300人）。`; } },
    { label: '選手がSNSで紹介する', desc: 'ファン+400人', run: (g, d) => { g.finance.fans += 400; return `選手の「${d.name}」の投稿にたくさんの「いいね」（ファン+400人）。`; } },
  ],
  food: [
    { label: '共同開発する（800万円）', desc: '当たれば大きい。外れても少しは売れる', cost: 800,
      run: (g, d) => { g.finance.funds -= 800;
        if (Rand.chance(0.55)) { g.finance.funds += 2800; g.finance.fans += 500; return `球場限定の「ホームラン${d.name}」が大ヒット！ 売上+2,800万円・ファン+500人。`; }
        g.finance.funds += 500; return `「${d.name}」メニューはそこそこ売れた（売上+500万円）。`; } },
    { label: '選手が食レポ動画に出る', desc: 'ファン+500人。食べた選手はご機嫌',
      run: (g, d) => { g.finance.fans += 500; const n = moodSome(g, 1, 1); return `${n.join('')}の「${d.name}」食レポが「おいしそう！」と話題に（ファン+500人）。`; } },
  ],
  spot: [
    { label: '選手を観光PR大使にする', desc: 'ファン+1,000人・オーナー評価+1。撮影で少し疲れる',
      run: (g, d) => { g.finance.fans += 1000; addOwner(g, 1); const n = moodSome(g, 2, -1); return `${n.join('・')}が「${d.name}」をPR！ ポスターが街中に貼られた（ファン+1,000人）。撮影で少しお疲れ…。`; } },
    { label: '球場に観光案内ブースを出す', desc: '+300万円・ファン+300人', run: (g, d) => { g.finance.funds += 300; g.finance.fans += 300; return `「${d.name}」のブースに行列。協賛金+300万円・ファン+300人。`; } },
  ],
  craft: [
    { label: '記念グッズを作る（600万円）', desc: '6割で大ヒット', cost: 600,
      run: (g, d) => { g.finance.funds -= 600;
        if (Rand.chance(0.6)) { g.finance.funds += 1800; g.finance.fans += 300; return `「${d.name}」の球団記念グッズが完売！ +1,800万円・ファン+300人。`; }
        g.finance.funds += 300; return `職人技は好評だったが、数は売れなかった（+300万円）。`; } },
    { label: '選手たちに贈ってもらう', desc: '3人の調子が上がる', run: (g, d) => { const n = moodSome(g, 3, 1); return `「${d.name}」をもらった${n.join('・')}は大感激（調子アップ）。`; } },
  ],
};
const moodSome = (g, n, dc) => Rand.shuffle(g.team.players.filter(p => p.available)).slice(0, n).map(p => { p.changeCondition(dc); return p.shortName; });
// ---------- 地域の出来事（担当する球団の地元のものだけが出る。各球団10個） ----------
// kind：fest お祭り / season 季節の行事 / food 名物グルメ / spot 名所 / craft 伝統工芸・名産
const REGION_EVENTS = {
  bib: [
    { kind: 'fest', name: '神田祭', note: '2年に1度の江戸三大祭り' },
    { kind: 'fest', name: '三社祭', note: '浅草の初夏を彩るお祭り' },
    { kind: 'season', name: '上野公園のお花見', note: '上野の山の桜が満開' },
    { kind: 'spot', name: '東京スカイツリー', note: '高さ634mの電波塔' },
    { kind: 'spot', name: '浅草の雷門', note: '大ちょうちんで有名な浅草寺の門' },
    { kind: 'food', name: 'もんじゃ焼き', note: '月島の下町グルメ' },
    { kind: 'food', name: '江戸前寿司', note: '東京湾の魚を使った握り寿司' },
    { kind: 'craft', name: '江戸切子', note: '色ガラスに細かな模様を刻む工芸' },
    { kind: 'food', name: '深川めし', note: 'あさりたっぷりの下町の味' },
    { kind: 'season', name: '酉の市', note: '熊手を買って商売繁盛を願う11月の行事' },
  ],
  jin: [
    { kind: 'season', name: '隅田川花火大会', note: '夏の夜空を彩る大花火' },
    { kind: 'season', name: '神宮外苑花火大会', note: '球場のすぐそばで上がる花火' },
    { kind: 'season', name: '神宮外苑のいちょう並木', note: '秋に黄金色に染まる並木道' },
    { kind: 'fest', name: '明治神宮の初詣', note: '毎年多くの人が訪れる新年の参拝' },
    { kind: 'fest', name: '高円寺阿波おどり', note: '東京の夏の踊りの祭典' },
    { kind: 'spot', name: '東京タワー', note: '赤と白の東京のシンボル' },
    { kind: 'spot', name: '渋谷スクランブル交差点', note: '世界的に有名な交差点' },
    { kind: 'food', name: '原宿のクレープ', note: '食べ歩きの定番スイーツ' },
    { kind: 'craft', name: '江戸風鈴', note: '夏を涼しく彩るガラスの風鈴' },
    { kind: 'food', name: '谷中銀座のメンチカツ', note: '下町の食べ歩きグルメ' },
  ],
  tom: [
    { kind: 'fest', name: '横浜開港祭', note: '港の開港を祝う初夏のお祭り' },
    { kind: 'spot', name: 'みなとみらいの夜景', note: '観覧車が光る港の夜景' },
    { kind: 'spot', name: '横浜中華街', note: '約600もの店が並ぶ日本最大級の中華街' },
    { kind: 'food', name: '家系ラーメン', note: '横浜生まれの豚骨しょうゆラーメン' },
    { kind: 'food', name: 'シウマイ', note: '横浜みやげの定番' },
    { kind: 'spot', name: '赤レンガ倉庫', note: '港を見守る明治の倉庫' },
    { kind: 'season', name: '横浜港の花火', note: '夏の港をいろどる花火' },
    { kind: 'fest', name: 'ザよこはまパレード', note: '街をねり歩く国際仮装行列' },
    { kind: 'craft', name: '横浜スカーフ', note: '港町が育てた絹のスカーフ' },
    { kind: 'food', name: 'サンマーメン', note: '横浜生まれのあんかけ麺' },
  ],
  spr: [
    { kind: 'fest', name: '名古屋まつり', note: '三英傑の行列が街を進む秋の祭り' },
    { kind: 'spot', name: '名古屋城の金のしゃちほこ', note: '天守に輝く名古屋のシンボル' },
    { kind: 'food', name: '味噌カツ', note: '濃厚な赤みそだれのとんかつ' },
    { kind: 'food', name: 'ひつまぶし', note: 'うなぎを3通りで味わう名物' },
    { kind: 'food', name: '手羽先', note: '甘辛くてスパイシーな名古屋めし' },
    { kind: 'food', name: '小倉トースト', note: '喫茶店モーニングの定番' },
    { kind: 'craft', name: '有松・鳴海絞り', note: '400年続く絞り染め' },
    { kind: 'fest', name: 'にっぽんど真ん中祭り', note: '全国から踊り子が集まる祭り' },
    { kind: 'season', name: '熱田まつり', note: '献灯まきわらと花火の初夏の祭り' },
    { kind: 'spot', name: '名古屋港水族館', note: 'シャチやイルカに会える水族館' },
  ],
  tky: [
    { kind: 'fest', name: '十日えびす', note: '西宮神社の「福男選び」で知られる祭り' },
    { kind: 'season', name: '夏の高校野球', note: '聖地・甲子園に球児が集まる夏' },
    { kind: 'season', name: '夙川公園の桜', note: '川沿いに続く桜並木' },
    { kind: 'food', name: '明石焼き', note: 'だしにつけて食べるふわふわの玉子焼き' },
    { kind: 'food', name: '神戸ビーフ', note: '世界に知られるブランド牛' },
    { kind: 'craft', name: '灘の日本酒', note: '名水「宮水」で仕込む酒どころの酒' },
    { kind: 'spot', name: '六甲山の夜景', note: '1000万ドルの夜景' },
    { kind: 'fest', name: '神戸ルミナリエ', note: '光の芸術で街を照らす冬の行事' },
    { kind: 'food', name: 'いかなごのくぎ煮', note: '春を告げる家庭の味' },
    { kind: 'spot', name: '有馬温泉', note: '日本最古級の名湯' },
  ],
  nnw: [
    { kind: 'fest', name: 'ひろしまフラワーフェスティバル', note: '花と音楽でにぎわう初夏の祭り' },
    { kind: 'food', name: '広島風お好み焼き', note: 'そばを重ねて焼く広島の味' },
    { kind: 'food', name: '広島かき', note: '生産量日本一の牡蠣' },
    { kind: 'spot', name: '宮島の厳島神社', note: '海に浮かぶ大鳥居' },
    { kind: 'food', name: 'もみじ饅頭', note: '宮島みやげの定番' },
    { kind: 'craft', name: '熊野筆', note: '職人が一本ずつ作る筆' },
    { kind: 'fest', name: 'とうかさん', note: 'ゆかたの着始めの祭り' },
    { kind: 'spot', name: 'しまなみ海道', note: '島をつなぐサイクリングの聖地' },
    { kind: 'food', name: '汁なし担担麺', note: 'しびれる辛さの広島ご当地麺' },
    { kind: 'season', name: '宮島の紅葉', note: 'もみじ谷が真っ赤に染まる秋' },
  ],
  yok: [
    { kind: 'fest', name: '博多どんたく', note: '大型連休ににぎわう港まつり' },
    { kind: 'fest', name: '博多祇園山笠', note: '山笠が街を駆け抜ける夏祭り' },
    { kind: 'food', name: '博多とんこつラーメン', note: '細麺と替え玉でおなじみ' },
    { kind: 'food', name: '辛子明太子', note: '博多みやげの代表' },
    { kind: 'food', name: 'もつ鍋', note: 'ニラとキャベツたっぷりの鍋' },
    { kind: 'spot', name: '中洲の屋台', note: '川沿いに並ぶ屋台の灯り' },
    { kind: 'craft', name: '博多人形', note: '素焼きに彩色する伝統人形' },
    { kind: 'spot', name: '太宰府天満宮', note: '学問の神様をまつる神社' },
    { kind: 'fest', name: '放生会', note: '露店がずらりと並ぶ秋の祭り' },
    { kind: 'food', name: '水炊き', note: '鶏のうまみたっぷりの鍋' },
  ],
  ngy: [
    { kind: 'fest', name: 'さっぽろ雪まつり', note: '巨大な雪像が並ぶ冬の祭典' },
    { kind: 'fest', name: 'YOSAKOIソーラン祭り', note: '鳴子を持って踊る初夏の祭り' },
    { kind: 'food', name: '味噌ラーメン', note: '札幌生まれの濃厚ラーメン' },
    { kind: 'food', name: 'ジンギスカン', note: '北海道の焼き肉といえばこれ' },
    { kind: 'food', name: 'スープカレー', note: '具だくさんのさらさらカレー' },
    { kind: 'spot', name: '札幌の時計台', note: '140年以上時を刻む建物' },
    { kind: 'season', name: 'さっぽろ夏まつり', note: '大通公園がビアガーデンになる夏' },
    { kind: 'season', name: 'ドカ雪', note: '一晩で街が真っ白になる大雪' },
    { kind: 'craft', name: '木彫りの熊', note: '北海道みやげの定番' },
    { kind: 'food', name: '夕張メロン', note: 'とろける甘さの赤肉メロン' },
  ],
  hir: [
    { kind: 'fest', name: '仙台七夕まつり', note: '豪華な七夕飾りが街をうめる夏祭り' },
    { kind: 'season', name: 'SENDAI光のページェント', note: '並木が光で包まれる冬の行事' },
    { kind: 'food', name: '牛たん焼き', note: '仙台を代表する名物' },
    { kind: 'food', name: 'ずんだ餅', note: '枝豆をつぶしたあんの餅' },
    { kind: 'food', name: '笹かまぼこ', note: '笹の葉の形のかまぼこ' },
    { kind: 'spot', name: '松島', note: '日本三景のひとつ' },
    { kind: 'craft', name: '宮城伝統こけし', note: '木のぬくもりの郷土人形' },
    { kind: 'fest', name: '仙台・青葉まつり', note: 'すずめ踊りでにぎわう初夏の祭り' },
    { kind: 'fest', name: '定禅寺ストリートジャズフェスティバル', note: '街じゅうが音楽ステージになる祭り' },
    { kind: 'food', name: '金華さば', note: '石巻の港に揚がるブランドさば', area: '石巻' },
  ],
  kob: [
    { kind: 'season', name: '幕張ビーチ花火フェスタ', note: '海辺で上がる夏の花火' },
    { kind: 'spot', name: '海ほたる', note: '東京湾の真ん中のパーキングエリア' },
    { kind: 'food', name: '落花生', note: '生産量日本一の千葉の味' },
    { kind: 'food', name: '勝浦タンタンメン', note: 'ラー油が真っ赤なご当地麺' },
    { kind: 'spot', name: '成田山新勝寺', note: '初詣でにぎわう名刹' },
    { kind: 'fest', name: '佐原の大祭', note: '巨大な山車が町を進む祭り' },
    { kind: 'craft', name: '房州うちわ', note: '竹の骨を生かした伝統のうちわ' },
    { kind: 'food', name: 'なめろう', note: '漁師町生まれのたたき料理' },
    { kind: 'season', name: '九十九里浜の海開き', note: '約60kmつづく砂浜の夏' },
    { kind: 'fest', name: '千葉の親子三代夏祭り', note: '家族で楽しむ千葉の夏祭り' },
  ],
  snd: [
    { kind: 'fest', name: '所沢まつり', note: '山車がにぎやかに練り歩く祭り' },
    { kind: 'fest', name: '秩父夜祭', note: '豪華な屋台と冬の花火の祭り' },
    { kind: 'fest', name: '川越まつり', note: '小江戸の町を山車が進む祭り' },
    { kind: 'spot', name: '川越の蔵造りの町並み', note: '江戸の面影が残る小江戸' },
    { kind: 'food', name: '草加せんべい', note: 'しょうゆ味の堅焼きせんべい' },
    { kind: 'food', name: '狭山茶', note: '色は静岡、香りは宇治、味は狭山でとどめさす' },
    { kind: 'food', name: 'ゼリーフライ', note: '行田のおからコロッケ' },
    { kind: 'craft', name: '岩槻の人形', note: 'ひな人形づくりの町の技' },
    { kind: 'season', name: '羊山公園の芝桜', note: '丘一面がピンクに染まる春' },
    { kind: 'spot', name: '鉄道博物館', note: '本物の車両が並ぶ大宮の博物館' },
  ],
  hkt: [
    { kind: 'fest', name: '天神祭', note: '船渡御と花火の日本三大祭り' },
    { kind: 'fest', name: '岸和田だんじり祭', note: 'だんじりが駆け抜ける勇壮な祭り' },
    { kind: 'food', name: 'たこ焼き', note: '大阪のソウルフード' },
    { kind: 'food', name: '串カツ', note: '「ソースの二度づけ禁止」でおなじみ' },
    { kind: 'food', name: '豚まん', note: '大阪みやげの定番' },
    { kind: 'spot', name: '通天閣', note: '新世界のシンボルタワー' },
    { kind: 'spot', name: '道頓堀', note: '巨大看板がにぎやかな繁華街' },
    { kind: 'spot', name: '大阪城', note: '天下人が築いた名城' },
    { kind: 'craft', name: '堺の打刃物', note: 'プロの料理人も使う刃物' },
    { kind: 'season', name: '造幣局の桜の通り抜け', note: '春だけ開く桜並木' },
  ],
};

const EVENTS = [
  {
    id: 'aceSlump',
    cond: g => g.team.rotation.some(p => p.condition <= 0),
    make: g => ({ p: [...g.team.rotation].sort((a, b) => b.overall - a.overall)[0] }),
    text: (g, d) => `エースの${d.p.name}が「肩が重い」と言っている。次の登板どうする？`,
    choices: [
      { label: '1回登板を飛ばして休ませる', desc: '調子が2段階上がる。今回は別の投手が先発',
        run: (g, d) => { d.p.rest = 1; d.p.changeCondition(2); return `${d.p.name}はしっかり休養。調子が上がった。`; } },
      { label: '信じて投げさせる', desc: '五分五分の賭け',
        run: (g, d) => Rand.chance(0.5)
          ? (d.p.changeCondition(1), `${d.p.name}「任せてください！」気合いで調子が上がった。`)
          : (d.p.changeCondition(-1), `無理がたたって${d.p.name}の調子が下がってしまった…。`) },
    ],
  },
  {
    id: 'cm',
    cond: g => g.team.players.length > 0,
    make: g => ({ p: [...g.team.players].sort((a, b) => b.overall - a.overall)[0] }),
    text: (g, d) => `飲料メーカーから「${d.p.name}をCMに出したい」と依頼。出演料は2,000万円。`,
    choices: [
      { label: 'CMに出てもらう', desc: '資金+2,000万円・ファン+500人。撮影で調子が下がるかも',
        run: (g, d) => { g.finance.funds += 2000; g.finance.fans += 500; if (Rand.chance(0.5)) d.p.changeCondition(-1); return 'CMが話題に！ 資金とファンが増えた。'; } },
      { label: '野球に集中させる', desc: '調子が少し上がる',
        run: (g, d) => { d.p.changeCondition(1); return `${d.p.name}は練習に集中し、調子を上げた。`; } },
    ],
  },
  {
    id: 'youngster',
    cond: g => g.team.batters.some(p => !p.starter && p.age <= 25 && p.available),
    make: g => ({ p: Rand.pick(g.team.batters.filter(p => !p.starter && p.age <= 25 && p.available)) }),
    text: (g, d) => `控えの${d.p.name}（${d.p.age}歳）が「試合に出たいです！」と直訴してきた。`,
    choices: [
      { label: 'スタメンに抜擢する', desc: '一番弱いスタメンと入れ替え。経験値+8',
        run: (g, d) => {
          const out = g.team.batters.filter(p => p.starter).sort((a, b) => a.overall - b.overall)[0];
          if (out) out.starter = false;
          d.p.starter = true; d.p.changeCondition(1);
          const grown = d.p.gainExp(8);
          return `${d.p.name}がスタメン入り${out ? `（${out.name}は控えへ）` : ''}。${grown.length ? `${grown.join('・')}が上がった！` : 'やる気に燃えている。'}`;
        } },
      { label: '今はまだ早いと伝える', desc: '本人の調子が下がる',
        run: (g, d) => { d.p.changeCondition(-1); return `${d.p.name}は肩を落とした…。`; } },
    ],
  },
  {
    id: 'injury',
    cond: g => g.team.lineup.some(p => g.team.players.includes(p)),
    make: g => ({ p: Rand.pick(g.team.lineup.filter(p => g.team.players.includes(p))), n: Math.max(1, Rand.int(2, 4) - (g.facilities.medical - 1) - (g.finance.hasPerk('medical') ? 1 : 0)) }),
    before: (g, d) => { d.p.injured = d.n; d.p.starter = false; },
    text: (g, d) => `${d.p.name}（${d.p.position}）が練習中にケガ。${d.n}試合出られない。`,
    choices: [
      { label: '緊急補強する（契約金1,000万円）', desc: '同じくらいの力のベテランを獲得',
        ok: g => g.finance.funds >= 1000 && g.team.players.length < g.rules.maxRoster,
        run: (g, d) => {
          const p = PlayerFactory.batter({ level: Util.clamp(d.p.overall - 3, 50, 75), position: d.p.position, age: Rand.int(29, 34) });
          p.starter = true; g.finance.funds -= 1000; g.team.players.push(p);
          return `ベテランの${p.name}（総合${p.rank}）が加入。穴を埋めてくれそうだ。`;
        } },
      { label: '控えでカバーする', desc: 'お金はかからない',
        run: (g, d) => `控えメンバーで乗り切る。${d.p.name}は${d.n}試合後に復帰予定。` },
    ],
  },
  {
    id: 'clinic',
    cond: () => true,
    make: g => ({ p: Rand.pick(g.team.players) }),
    text: () => '地元の小学校から「選手に野球教室をしてほしい」と依頼が来た。',
    choices: [
      { label: '選手を派遣する', desc: 'ファン+800人。選手も子どもたちに元気をもらう',
        run: (g, d) => { g.finance.fans += 800; d.p.changeCondition(1); return `子どもたちは大喜び！ ファンが増え、${d.p.name}の調子も上がった。`; } },
      { label: '今回は断る', desc: 'ファンが少し減る',
        run: g => { g.finance.fans = Math.max(3000, g.finance.fans - 200); return '「残念…」という声が少し聞こえた。'; } },
    ],
  },
  {
    id: 'digital',
    cond: () => true,
    make: () => ({}),
    text: () => '近所のプログラミング教室に通う子どもたちから「選手のデータでゲームを作りたい」と連絡が来た。',
    choices: [
      { label: 'データを提供する', desc: 'ファン+600人・オーナー評価+2',
        run: g => { g.finance.fans += 600; g.ownerRating = Util.clamp(g.ownerRating + 2, 0, 100); return '完成したゲームが地元で話題に！ オーナーもご機嫌だ。'; } },
      { label: '忙しいので断る', desc: '', run: () => '今回は見送った。' },
    ],
  },
  {
    id: 'ownerOrder',
    cond: () => true,
    make: () => ({}),
    text: () => 'オーナー「次の試合、絶対に勝て！」',
    choices: [
      { label: '勝利ボーナスを約束する（1,000万円）', desc: '全員の調子+1。勝てば評価+3、負ければ-3',
        ok: g => g.finance.funds >= 1000,
        run: g => { g.finance.funds -= 1000; g.team.players.forEach(p => p.changeCondition(1)); g.flags.ownerOrder = true; return 'ボーナスの約束でベンチの士気が上がった！'; } },
      { label: 'いつも通り戦う', desc: '勝てば評価+3、負ければ-3',
        run: g => { g.flags.ownerOrder = true; return '「いつも通りやるだけです」とオーナーに返事をした。'; } },
    ],
  },
  {
    id: 'scout',
    cond: g => g.team.players.length < g.rules.maxRoster,
    make: () => ({ p: PlayerFactory.prospect() }),
    text: (g, d) => `スカウト「独立リーグに掘り出し物がいます。${d.p.name}（${d.p.age}歳・${d.p.isPitcher ? '投手' : d.p.position}）です」`,
    choices: [
      { label: '契約する（契約金500万円）', desc: '今は弱いが、伸びしろはとても大きい',
        ok: g => g.finance.funds >= 500 && g.team.players.length < g.rules.maxRoster,
        run: (g, d) => { g.finance.funds -= 500; g.team.players.push(d.p); return `${d.p.name}が入団！ 育て方しだいで大化けするかも。`; } },
      { label: '見送る', desc: '', run: () => '今回は見送った。' },
    ],
  },
  // ---- 最新設備 ----
  {
    id: 'equipment',
    cond: g => Object.keys(EQUIPMENT).some(k => !g.equipment.includes(k)),
    make: g => ({ k: Rand.pick(Object.keys(EQUIPMENT).filter(k => !g.equipment.includes(k))), sale: Rand.chance(0.3) }),
    text: (g, d) => `メーカーの営業「最新の${EQUIPMENT[d.k].name}を導入しませんか？」${EQUIPMENT[d.k].pitch}${d.sale ? '（今だけ2割引き！）' : ''}`,
    choices: [
      { label: (g, d) => `導入する（${Util.money(g.equipCost(d.k, d.sale))}）`,
        desc: (g, d) => `${EQUIPMENT[d.k].effect}。一度入れればずっと効く。毎試合${Util.money(EQUIPMENT_UPKEEP)}の保守費がかかる${g.itnavPartner ? '（ITパートナーの技術協力で2割引き）' : ''}`,
        ok: (g, d) => g.finance.funds >= g.equipCost(d.k, d.sale),
        run: (g, d) => { g.finance.funds -= g.equipCost(d.k, d.sale); g.equipment.push(d.k); g.gmCount('equip');
          return `${EQUIPMENT[d.k].name}を導入！（${EQUIPMENT[d.k].effect}）`; } },
      { label: '今回は見送る', desc: 'お金は使わない。また話が来るかも', run: () => '導入は見送った。' },
    ],
  },
  // ---- IT・デジタル ----
  {
    id: 'hackVenue',
    cond: g => g.team.players.length > 0,
    make: () => ({}),
    text: () => '人気ゲームの大型イベント「ゲームフェス」から「球場を会場として3日間貸してほしい」と相談が来た。',
    choices: [
      { label: '球場を貸す', desc: '会場費+800万円・ファン+400人。ただし練習がしづらくなる',
        run: g => { g.finance.funds += 800; g.finance.fans += 400; const n = moodSome(g, 2, -1);
          return `ゲームファンが大勢来場して球団の知名度が上がった。…が、練習不足で${n.join('・')}の調子が下がった。`; } },
      { label: '練習を優先して断る', desc: '', run: () => '別の会場を紹介した。' },
    ],
  },
  {
    id: 'hackData',
    cond: () => true,
    make: () => ({}),
    text: () => 'データ分析好きのファンから「球団の試合データをオープンデータとして公開してほしい」と要望が来た。',
    choices: [
      { label: 'データを公開する', desc: 'ファン+500人・オーナー評価+1。相手球団にも見られるかも',
        run: g => { g.finance.fans += 500; addOwner(g, 1);
          if (Rand.chance(0.5)) { g.finance.fans += 500; return 'ファンが作った分析サイトがバズった！ さらにファン+500人。'; }
          const n = moodSome(g, 2, -1); return `相手球団にもクセを研究され、${n.join('・')}の調子が下がった…。`; } },
      { label: '公開しない', desc: '', run: () => '今回は公開を見送った。' },
    ],
  },
  // ---- 季節の行事・地域とのつながり ----
  // 担当する球団の地元の出来事（REGION_EVENTS から、今シーズンまだ出ていないものを選ぶ）
  {
    id: 'region', weight: 12, repeat: true,   // 1シーズンに2回くらい出る
    cond: g => regionLeft(g).length > 0,
    make: g => { const r = Rand.pick(regionLeft(g)); g.flags.regionUsed = [...(g.flags.regionUsed || []), r.name];
      return { ...r, city: r.area || REGION_NAME[g.profile.pick] || '地元' }; },
    text: (g, d) => ({
      fest: `${d.city}では「${d.name}」（${d.note}）の季節！ 地元の人たちから「球団のみんなもぜひ参加して」と声がかかった。`,
      season: `${d.city}に「${d.name}」（${d.note}）の季節がやってきた。この時期に合わせて、球団で何かできないか？`,
      food: `${d.city}名物「${d.name}」（${d.note}）のお店から「球場限定メニューを一緒に作りませんか」と提案が来た。`,
      spot: `${d.city}の観光協会から「${d.name}」（${d.note}）のPRに協力してほしいと依頼が来た。`,
      craft: `${d.city}の「${d.name}」（${d.note}）の職人さんから「球団の記念グッズを作りたい」と声がかかった。`,
    })[d.kind],
    choices: [
      { label: (g, d) => evText(REGION_CHOICES[d.kind][0].label, g, d), desc: (g, d) => evText(REGION_CHOICES[d.kind][0].desc, g, d),
        ok: (g, d) => g.finance.funds >= (REGION_CHOICES[d.kind][0].cost || 0), run: (g, d) => REGION_CHOICES[d.kind][0].run(g, d) },
      { label: (g, d) => evText(REGION_CHOICES[d.kind][1].label, g, d), desc: (g, d) => evText(REGION_CHOICES[d.kind][1].desc, g, d), run: (g, d) => REGION_CHOICES[d.kind][1].run(g, d) },
      { label: '今回は見送る', desc: '', run: () => '今回は見送った。' },
    ],
  },
  {
    id: 'bousai',
    cond: () => true,
    make: () => ({}),
    text: () => '防災の日を前に、市から「防災と野球の教室を、子どもたちと一緒に開きたい」と相談が来た。',
    choices: [
      { label: '球団で開く（500万円）', desc: 'ファン+1,000人・オーナー評価+3。選手の気持ちも引き締まる',
        ok: g => g.finance.funds >= 500,
        run: g => { g.finance.funds -= 500; g.finance.fans += 1000; addOwner(g, 3); const n = moodSome(g, 3, 1);
          return `「野球ができる日常のありがたさ」を子どもたちと考えた。${n.join('・')}の調子が上がった。`; } },
      { label: '今回は見送る', desc: 'オーナー評価-1', run: g => { addOwner(g, -1); return 'オーナー「地元とのつながりは大事にしてくれよ」'; } },
    ],
  },
  {
    id: 'bibai',
    cond: g => g.team.players.length > 0,
    make: g => ({ p: [...g.team.players].sort((a, b) => b.overall - a.overall)[0] }),
    text: (g, d) => `子どもプログラミング教室のみんなから「${d.p.name}選手の応援ゲームを作ったので遊んでほしい！」とビデオレターが届いた。`,
    choices: [
      { label: '教室を訪問して交流する（400万円）', desc: 'ファン+1,200人・オーナー評価+2',
        ok: g => g.finance.funds >= 400,
        run: (g, d) => { g.finance.funds -= 400; g.finance.fans += 1200; addOwner(g, 2); d.p.changeCondition(1);
          return `子どもたちとゲームで対戦！ 手作りの応援うちわをもらい、${d.p.name}もご機嫌だ。`; } },
      { label: '動画で返事をする', desc: 'ファン+500人', run: (g, d) => { g.finance.fans += 500; return `${d.p.name}がゲームを実況する動画を送った。`; } },
    ],
  },
  {
    id: 'yokosuka',
    cond: () => true,
    make: () => ({}),
    text: () => '人気のストリートファッションブランドから「コラボユニフォームを作ろう！」と企画が届いた。',
    choices: [
      { label: '作る（2,500万円）', desc: '売れれば大もうけ。外れると赤字',
        ok: g => g.finance.funds >= 2500,
        run: g => { g.finance.funds -= 2500;
          if (Rand.chance(0.6)) { g.finance.funds += 5500; g.finance.fans += 800; return 'コラボユニが即完売！ 売上+5,500万円・ファン+800人。'; }
          g.finance.funds += 1500; g.finance.fans += 300; return '一部のファンには刺さった（売上+1,500万円）。'; } },
      { label: '見送る', desc: '', run: () => '今回は見送った。' },
    ],
  },
  // ---- 選手のドラマ ----
  {
    id: 'retire', weight: 3,
    cond: g => g.gameIndex >= g.rules.gamesPerSeason - 6 && retireCands(g).length > 0,
    make: g => ({ p: retireCands(g)[0] }),
    text: (g, d) => `ベテランの${d.p.name}（${d.p.age}歳・背番号${d.p.number}）が「今季限りで引退します」と申し出てきた。${careerText(d.p)}`,
    choices: [
      { label: '最終戦で引退試合を開く（300万円）', desc: 'ファン+1,500人。本人の調子が大きく上がる', ok: g => g.finance.funds >= 300,
        run: (g, d) => { g.finance.funds -= 300; g.finance.fans += 1500; d.p.retiring = 'ceremony'; d.p.changeCondition(2);
          g.addStory(`${d.p.name}（背番号${d.p.number}）が今季限りでの引退を発表。最終戦が引退試合に`);
          return `${d.p.shortName}「最後まで全力でプレーします」。ファン+1,500人。最終戦は引退試合になる。`; } },
      { label: (g, d) => `引退試合を開き、背番号${d.p.number}を永久欠番にする（800万円）`, desc: 'ファン+3,000人・オーナー評価+2。球団の歴史に名前が残る',
        hide: (g, d) => !isLegend(d.p), ok: g => g.finance.funds >= 800,
        run: (g, d) => { g.finance.funds -= 800; g.finance.fans += 3000; addOwner(g, 2); d.p.retiring = 'ceremony'; d.p.changeCondition(2);
          g.retireNumber(d.p);
          return `背番号${d.p.number}は${d.p.shortName}だけのものに。永久欠番の発表に球場が涙した（ファン+3,000人）。`; } },
      { label: 'もう1年がんばろうと説得する', desc: '半々で現役続行。断られると少し気まずい',
        run: (g, d) => { if (Rand.chance(0.5)) { d.p.stayYear = g.season; d.p.changeCondition(1); return `${d.p.shortName}「…もう1年、やらせてください！」。現役続行が決まった。`; }
          d.p.retiring = 'plain'; d.p.changeCondition(-1); return `${d.p.shortName}の決意は固かった。今季限りで引退する。`; } },
    ],
  },
  // ---- 地域・ファン（追加） ----
  {
    id: 'mascot',
    cond: () => true,
    make: () => ({}),
    text: () => '「全国ご当地キャラ総選挙」に、球団マスコットがエントリーされた！ どう戦う？',
    choices: [
      { label: '全力で選挙活動（500万円）', desc: '4割で1位！ ファン大幅アップ。ダメでも少し増える',
        ok: g => g.finance.funds >= 500,
        run: g => { g.finance.funds -= 500;
          if (Rand.chance(0.4)) { g.finance.fans += 3000; g.finance.funds += 1500; addOwner(g, 2); return 'マスコットが堂々の1位！ グッズが売れまくり+1,500万円・ファン+3,000人。'; }
          g.finance.fans += 600; return '惜しくも5位。それでも知名度は上がった（ファン+600人）。'; } },
      { label: '自然体で応援する', desc: 'お金はかからない', run: g => { if (Rand.chance(0.15)) { g.finance.fans += 1500; return 'まさかの3位入賞！ ファン+1,500人。'; } g.finance.fans += 200; return '12位だった。マスコットはちょっとすねている。'; } },
    ],
  },
  {
    id: 'proposal',
    cond: () => true,
    make: () => ({}),
    text: () => 'ファンから「試合中に大型ビジョンでプロポーズさせてください！」とお願いが届いた。',
    choices: [
      { label: 'ビジョンを貸して全力で盛り上げる', desc: 'ファン+300人。成功すればSNSでバズるかも',
        run: g => { g.finance.fans += 300;
          if (Rand.chance(0.85)) { g.finance.fans += 1200; return '「はい！」の返事に球場が総立ち！ 動画が拡散され、ファン+1,500人。'; }
          return '返事は「…少し考えさせて」。球場がしんみりした。でも温かい拍手が送られた。'; } },
      { label: '試合に集中したいので断る', desc: '', run: () => '丁重にお断りした。' },
    ],
  },
  {
    id: 'shikyu',
    cond: () => true,
    make: () => ({}),
    text: () => '地元出身の人気タレントが「始球式をやらせてほしい」と名乗り出てくれた。',
    choices: [
      { label: '招待する（300万円）', desc: 'ファン+1,500人。投げる球によっては話題に',
        ok: g => g.finance.funds >= 300,
        run: g => { g.finance.funds -= 300; g.finance.fans += 1500;
          const r = Rand.pick(['まさかの120km/h！ ノーバウンド投球が話題になった。', '大きくそれてバックネット直撃。でも笑顔で大ウケ。', '見事なストライク！ 選手からも拍手が起きた。']);
          return `${r}（ファン+1,500人）`; } },
      { label: '今回は見送る', desc: '', run: () => '日程が合わず見送った。' },
    ],
  },
  {
    id: 'kidsPromise',
    cond: g => g.team.lineup.some(p => g.team.players.includes(p)),
    make: g => ({ p: [...g.team.lineup].filter(p => g.team.players.includes(p)).sort((a, b) => b.stats.power - a.stats.power)[0] }),
    text: (g, d) => `入院中の少年から手紙が届いた。「${d.p.name}選手、次の試合でホームランを打ってください！」`,
    choices: [
      { label: (g, d) => `${d.p.shortName}に「約束する」と伝えてもらう`, desc: '本当に打てば大反響。打てなくても応援される',
        run: (g, d) => { g.flags.kidsPromise = d.p.id; d.p.changeCondition(1); return `${d.p.name}「必ず打ちます」。気合いが入った（調子アップ）。`; } },
      { label: 'サイン入りボールを贈る', desc: 'ファン+400人', run: g => { g.finance.fans += 400; return '少年からお礼の絵が届いた。'; } },
    ],
  },
  // ---- スポンサーとのつきあい（スポンサーが出てくる出来事は出やすい） ----
  {
    id: 'spVisit', weight: 3,
    cond: g => spList(g).length > 0,
    make: g => ({ sp: Rand.pick(spList(g)) }),
    text: (g, d) => `スポンサーの「${d.sp.name}」の代表が、家族を連れて試合を見に来ることになった。`,
    choices: [
      { label: 'VIP席でおもてなし（200万円）', desc: '気に入ってもらえれば契約金アップ＆延長',
        ok: g => g.finance.funds >= 200,
        run: (g, d) => { g.finance.funds -= 200;
          if (Rand.chance(0.7)) { const up = spRaise(d.sp, 0.2); d.sp.years += 1;
            return `「最高の一日だった！」と大喜び。${d.sp.name}の契約金が年${Util.money(up)}アップ、契約も1年延長に。`; }
          return '楽しんで帰っていった。今回は話が進まなかった。'; } },
      { label: '試合後に選手とのあいさつ会を開く', desc: '契約金が少しアップ。選手は少し疲れる',
        run: (g, d) => { const up = spRaise(d.sp, 0.1); const n = moodSome(g, 2, -1);
          return `お子さんが大喜び！ ${d.sp.name}の契約金が年${Util.money(up)}アップ。${n.join('・')}は少しお疲れ…。`; } },
      { label: 'いつも通りに迎える', desc: '', run: (g, d) => `${d.sp.name}の代表は静かに観戦して帰った。` },
    ],
  },
  {
    id: 'spCollab', weight: 3,
    cond: g => spList(g).length > 0 && g.team.players.length > 0,
    make: g => ({ sp: Rand.pick(spList(g)), p: [...g.team.players].sort((a, b) => b.overall - a.overall)[0] }),
    text: (g, d) => `「${d.sp.name}」から「${g.team.name}とのコラボ商品を出したい」と提案が来た。`,
    choices: [
      { label: (g, d) => `エースの${d.p.shortName}の顔入りで出す`, desc: '当たれば大きな売上。外れると在庫の山…',
        run: (g, d) => { if (Rand.chance(0.65)) { const v = Rand.pick([900, 1200, 1600]); g.finance.funds += v; g.finance.fans += 500;
            return `「${d.sp.name}×${d.p.shortName}」コラボが店頭から消える大ヒット！ +${Util.money(v)}・ファン+500人。`; }
          g.finance.funds += 200; return `思ったほど売れず…（+${Util.money(200)}）。${d.p.shortName}「なんかすみません」`; } },
      { label: '球団ロゴ入りで手堅く出す', desc: `+${Util.money(500)}`,
        run: (g, d) => { g.finance.funds += 500; return `${d.sp.name}のお店に${g.team.name}のコラボ商品が並んだ。+${Util.money(500)}。`; } },
      { label: '今回は断る', desc: '', run: () => '今回は見送った。' },
    ],
  },
  {
    id: 'spCM', weight: 3,
    cond: g => spList(g).length > 0 && g.team.players.length > 0,
    make: g => ({ sp: Rand.pick(spList(g)), p: [...g.team.players].sort((a, b) => b.overall - a.overall)[0],
      y: Rand.pick(g.team.players.filter(p => p.age <= 24).concat(g.team.players).slice(0, 8)) }),
    text: (g, d) => `「${d.sp.name}」が新しいテレビCMを作る。「${g.team.name}の選手に出てほしい」と出演の依頼が来た。`,
    choices: [
      { label: (g, d) => `看板選手の${d.p.shortName}を出す`, desc: `出演料+${Util.money(800)}・ファン+1,000人。撮影で少し疲れる`,
        run: (g, d) => { g.finance.funds += 800; g.finance.fans += 1000; d.p.changeCondition(-1);
          return `${d.p.shortName}のCMが全国で流れた！ +${Util.money(800)}・ファン+1,000人。演技は…ちょっと棒読み。`; } },
      { label: (g, d) => `若手の${d.y.shortName}を推薦する`, desc: `出演料+${Util.money(400)}・ファン+500人。本人は大喜び`,
        run: (g, d) => { g.finance.funds += 400; g.finance.fans += 500; d.y.changeCondition(2);
          return `「あの子だれ？」とSNSで話題に。${d.y.shortName}は気合い十分（調子アップ）。`; } },
      { label: 'シーズン中なので断る', desc: '', run: () => '丁寧にお断りした。' },
    ],
  },
  {
    id: 'spDay', weight: 3,
    cond: g => spList(g).length > 0,
    make: g => ({ sp: Rand.pick(spList(g)) }),
    text: (g, d) => `「${d.sp.name}デー」を開催することになった。来場者へのプレゼントはどうする？`,
    choices: [
      { label: '来場者全員にプレゼント（300万円）', desc: 'ファン+1,500人。スポンサーも大満足',
        ok: g => g.finance.funds >= 300,
        run: (g, d) => { g.finance.funds -= 300; g.finance.fans += 1500; if (Rand.chance(0.4)) { d.sp.years += 1; return `球場が${d.sp.name}グッズを持ったファンでいっぱいに！ ファン+1,500人。喜んだ${d.sp.name}が契約を1年延長してくれた。`; }
          return `球場が${d.sp.name}グッズを持ったファンでいっぱいに！ ファン+1,500人。`; } },
      { label: '先着1万人にだけプレゼント', desc: 'お金はかからない。ファン+600人',
        run: (g, d) => { g.finance.fans += 600; return `朝から${d.sp.name}グッズを求めて長い行列ができた。ファン+600人。`; } },
    ],
  },
  {
    id: 'spGift', weight: 3,
    cond: g => spList(g).length > 0 && g.team.players.length > 0,
    make: g => ({ sp: Rand.pick(spList(g)) }),
    text: (g, d) => `「${d.sp.name}」から選手たちに、山のような差し入れが届いた！`,
    choices: [
      { label: '選手みんなでいただく', desc: '3人の調子が上がる',
        run: (g, d) => { const n = moodSome(g, 3, 1); return `${n.join('・')}が元気いっぱいに（調子アップ）。${d.sp.name}さん、ありがとう！`; } },
      { label: '球場でファンにおすそ分けする', desc: 'ファン+600人',
        run: (g, d) => { g.finance.fans += 600; return `「${d.sp.name}、太っ腹！」とファンから大好評。ファン+600人。`; } },
    ],
  },
  {
    id: 'spReverse', weight: 3,
    cond: g => spOpen(g).length > 0,
    make: g => ({ c: Rand.pick(spOpen(g)) }),
    text: (g, d) => `なんと「${d.c.name}」の方から「${g.team.name}のスポンサーになりたい」と連絡が来た！（${d.c.tier}・年${Util.money(d.c.amount)}×${d.c.years}年${d.c.perk ? `・特典：${d.c.perk}` : ''}）`,
    choices: [
      { label: 'その条件で契約する', desc: '営業費なしで、すぐ契約',
        run: (g, d) => spSign(g, d.c, d.c.amount) },
      { label: '強気に金額アップを求める', desc: '通れば1.3倍。断られることも',
        run: (g, d) => (Rand.chance(0.55) ? spSign(g, d.c, Math.round(d.c.amount * 1.3 / 100) * 100) : `${d.c.name}「では、今回はご縁がなかったということで…」。話は白紙になった。`) },
      { label: '今回は断る', desc: '', run: (g, d) => `${d.c.name}にお礼を伝えて断った。` },
    ],
  },
  // ---- ファンとのつながり ----
  {
    id: 'limitedUniform',
    cond: g => !g.limitedUniform && g.gameIndex < g.rules.gamesPerSeason - 3,
    make: g => { const t = Rand.pick(UNI_TEMPLATES.filter(x => ['retro', 'matsuri', 'sunset', 'gold', 'black'].includes(x.id)));
      return { id: t.id, name: t.name, u: uniTemplate(t.id, g.team.color, g.profile.uniform.text) }; },
    text: (g, d) => `グッズ担当から「次の5試合、期間限定の『${d.name}』を着ませんか？ 限定グッズも出します」と提案が来た。（デザインは球団タブで確認できる）`,
    choices: [
      { label: '期間限定ユニを着る（500万円）', desc: 'ファン+800人・5試合グッズが1人+300円。終わればいつものユニに戻る',
        ok: g => g.finance.funds >= 500,
        run: (g, d) => { g.finance.funds -= 500; const base = g.profile.uniform;
          g.setUniform(d.u, { free: true, hype: 5, keepColor: true, news: `期間限定「${d.name}」を発表！` });
          g.limitedUniform = { base, left: 5, name: d.name };
          return `期間限定「${d.name}」がお披露目！ 限定グッズに行列ができた（ファン+800人・5試合グッズが売れる）。`; } },
      { label: 'いつものユニフォームでいく', desc: '', run: () => '今回は見送った。' },
    ],
  },
  {
    id: 'uniformContest',
    cond: () => true,
    make: g => { const c = () => Rand.pick(UNI_COLORS);
      let main = c(); while (main === '#ffffff') main = c();
      return { u: { body: Rand.pick(['#ffffff', '#efe9dc', '#111111', '#1f366a']), main, accent: c(), pattern: Rand.pick(Object.keys(UNI_PATTERNS)), font: Rand.pick(Object.keys(UNI_FONTS)), text: chestText(g.profile) } }; },
    text: (g, d) => `ファンから「新しいユニフォームのデザイン案」を募集したら、1位に選ばれたのは「${UNI_PATTERNS[d.u.pattern]}」に${UNI_FONTS[d.u.font]}の文字が入ったデザインだった。`,
    choices: [
      { label: 'ファン案を採用して発表する', desc: 'お金はかからない。ファン+800人・3試合グッズが売れる（デザインは球団タブで見られる）',
        run: (g, d) => g.setUniform(d.u, { free: true, hype: 3 }).text },
      { label: '今のユニフォームのままにする', desc: '', run: () => '応募してくれたファンにお礼のグッズを送った。' },
    ],
  },
  {
    id: 'baseballSchool',
    cond: g => g.team.players.length > 0,
    make: g => ({ p: [...g.team.players].sort((a, b) => b.overall - a.overall)[0] }),
    text: () => '地元の少年野球チームから「プロの選手に野球教室を開いてほしい」とお願いが来た。',
    choices: [
      { label: (g, d) => `主力の${d.p.shortName}たちを送る`, desc: 'ファン+1,000人。主力が少し疲れる',
        run: (g, d) => { g.finance.fans += 1000; d.p.changeCondition(-1); return `子どもたちの目がキラキラ！ ファン+1,000人。${d.p.shortName}は少し疲れたが笑顔。`; } },
      { label: '若手選手を送る', desc: 'ファン+500人。若手は刺激を受ける',
        run: g => { g.finance.fans += 500; const y = g.team.players.filter(p => p.age <= 24 && p.available); Rand.shuffle(y).slice(0, 2).forEach(p => p.changeCondition(1));
          return '若手が教える側に回って、自分の野球を見つめ直した。ファン+500人。'; } },
      { label: '今回は見送る', desc: '', run: () => '試合日程を理由にお断りした。' },
    ],
  },
  {
    id: 'foodElection',
    cond: () => true,
    make: () => ({}),
    text: () => '売店のスタッフから「ファン投票で『球場グルメ総選挙』をやりませんか？」と提案が来た。',
    choices: [
      { label: '開催する（200万円）', desc: '盛り上がれば売上アップ',
        ok: g => g.finance.funds >= 200,
        run: g => { g.finance.funds -= 200; g.finance.fans += 400;
          if (Rand.chance(0.7)) { g.finance.funds += 700; return '1位の「ホームランから揚げ丼」に行列ができた！ +700万円・ファン+400人。'; }
          return '投票は盛り上がったが、売上はいつも通り。ファン+400人。'; } },
      { label: 'やらない', desc: '', run: () => '今回は見送った。' },
    ],
  },
  {
    id: 'clubChannel',
    cond: g => g.finance.channel.level < 2,
    make: () => ({}),
    text: g => g.finance.channel.level
      ? `公式チャンネルの登録者が${g.finance.channel.subs.toLocaleString()}人に。広報から「専任の動画チームを作って本格的にやりませんか？」と提案が来た。`
      : '若手職員から「球団公式のYouTubeチャンネルとSNSを始めませんか？ 選手の素顔を見せればファンが増えるはずです」と提案が来た。',
    choices: [
      { label: g => (g.finance.channel.level ? '専任チームを作る（1,200万円）' : '専任チームで本格的に始める（1,500万円）'),
        desc: `登録者がぐんぐん増えて広告収入も入る。チームの人件費 ${CHANNEL[2].upkeep}万円/試合`,
        ok: g => g.finance.funds >= (g.finance.channel.level ? 1200 : 1500),
        run: g => { const ch = g.finance.channel; g.finance.funds -= ch.level ? 1200 : 1500;
          ch.subs += ch.level ? 3000 : 5000; ch.level = 2; g.finance.fans += 600;
          return `プロの映像スタッフが加わった！ 初回動画が話題になり、登録者${ch.subs.toLocaleString()}人に（ファン+600人）。`; } },
      { label: g => (g.finance.channel.level ? '今のまま広報の兼任で続ける' : '広報の兼任で小さく始める（300万円）'),
        desc: g => (g.finance.channel.level ? '' : '人件費はかからない。登録者はゆっくり増える'),
        ok: g => g.finance.channel.level || g.finance.funds >= 300,
        run: g => { const ch = g.finance.channel; if (ch.level) return '今の体制で地道に続けることにした。';
          g.finance.funds -= 300; ch.level = 1; ch.subs += 1000;
          return '公式チャンネルを開設！ 手作り感のある動画が「味がある」と好評（登録者1,000人）。'; } },
      { label: 'まだ始めない', desc: '', hide: g => g.finance.channel.level > 0, run: () => '今回は見送った。' },
    ],
  },
  {
    id: 'playerYoutube',
    cond: g => g.team.players.some(p => p.age <= 30),
    make: g => ({ p: Rand.pick(g.team.players.filter(p => p.age <= 30)) }),
    text: (g, d) => `${d.p.name}（${d.p.age}歳）が「個人のYouTubeチャンネルを始めたいんです！ 練習の様子や私生活を発信したい」と相談に来た。`,
    choices: [
      { label: '全力で応援する', desc: '人気が出ればファン大幅アップ。撮影に夢中になりすぎるかも',
        run: (g, d) => { const ch = g.finance.channel;
          if (Rand.chance(0.7)) { g.finance.fans += 1200; d.p.changeCondition(1); if (ch.level) ch.subs += 2000;
            return `${d.p.shortName}の「ルーティン動画」が大人気！ ファン+1,200人。本人もやる気満々（調子アップ）${ch.level ? '。公式チャンネルとのコラボで登録者+2,000人' : ''}。`; }
          g.finance.fans += 300; d.p.changeCondition(-2);
          return `再生数が気になって夜ふかし続き…。${d.p.shortName}の調子が大きく下がった（ファン+300人）。`; } },
      { label: 'オフの日だけOK（内容は広報がチェック）', desc: 'ファン+500人。手堅く',
        run: (g, d) => { g.finance.fans += 500; return `${d.p.shortName}の動画は落ち着いた内容で好評。ファン+500人。`; } },
      { label: '今は野球に集中させる', desc: 'オーナー評価+1。本人は少しがっかり',
        run: (g, d) => { addOwner(g, 1); d.p.changeCondition(-1); return `${d.p.shortName}「…わかりました」。少し元気がない（調子ダウン）。`; } },
    ],
  },
  {
    id: 'channelIdea',
    cond: g => g.finance.channel.level > 0,
    make: g => ({ p: Rand.pick(g.team.players), m: g.staff.manager }),
    text: g => `公式チャンネルの企画会議。登録者${g.finance.channel.subs.toLocaleString()}人、次の動画で一気に伸ばしたい。どの企画でいく？`,
    choices: [
      { label: (g, d) => `${d.p.shortName}のオフに密着する`, desc: '登録者が確実に増える。撮影で少し疲れる',
        run: (g, d) => { const ch = g.finance.channel; const n = 2000 * ch.level; ch.subs += n; g.finance.fans += 500; d.p.changeCondition(-1);
          return `素顔の${d.p.shortName}が「かわいい」と話題に。登録者+${n.toLocaleString()}人・ファン+500人。本人は少しお疲れ…。`; } },
      { label: '球場グルメ食べ歩き動画', desc: '登録者+1,500人。売店の売上も伸びる',
        run: g => { g.finance.channel.subs += 1500; g.finance.funds += 300; return '「このカレー食べに行きたい」と大反響。登録者+1,500人、売店も+300万円。'; } },
      { label: (g, d) => (d.m ? `監督の${d.m.name}が「ぶっちゃけ生配信」` : '球団職員の「ぶっちゃけ生配信」'), desc: '大バズりか、大炎上か…',
        run: g => { const ch = g.finance.channel;
          if (Rand.chance(0.55)) { ch.subs += 8000; g.finance.fans += 1500; return '裏話が面白すぎると大バズり！ 登録者+8,000人・ファン+1,500人。'; }
          g.finance.fans = Math.max(3000, g.finance.fans - 600); addOwner(g, -3); return 'うっかり口がすべって炎上…。ファン−600人・オーナー評価−3。'; } },
    ],
  },
  {
    id: 'snsEnjou',
    cond: g => g.team.players.length > 0,
    make: g => ({ p: Rand.pick(g.team.players) }),
    text: (g, d) => `${d.p.name}の昔のSNS投稿が掘り起こされ、ネットで炎上しかけている…。マスコミからも問い合わせが来た。`,
    choices: [
      { label: 'すぐに球団として謝罪する', desc: 'ファン−300人・オーナー評価−1。早めに火を消す',
        run: g => { g.finance.fans = Math.max(3000, g.finance.fans - 300); addOwner(g, -1); return 'すばやい対応で騒ぎはすぐ収まった。'; } },
      { label: '本人が動画で正直に説明する', desc: '誠実さが伝われば好感度アップ。失敗すると…',
        run: (g, d) => { if (Rand.chance(0.6)) { g.finance.fans += 800; d.p.changeCondition(1); return `${d.p.shortName}の真っすぐな言葉に「応援したくなった」の声。ファン+800人。`; }
          g.finance.fans = Math.max(3000, g.finance.fans - 1200); addOwner(g, -2); d.p.changeCondition(-1);
          return '言い方がまずく、さらに燃え広がってしまった…。ファン−1,200人・オーナー評価−2。'; } },
      { label: '何もせず様子を見る', desc: 'うまくいけば自然に収まる',
        run: g => { if (Rand.chance(0.5)) return '数日で話題は消えた。ほっとひと安心。';
          g.finance.fans = Math.max(3000, g.finance.fans - 1500); addOwner(g, -3); return '対応が遅いと批判が集まった…。ファン−1,500人・オーナー評価−3。'; } },
    ],
  },
  {
    id: 'youtuber',
    cond: () => true,
    make: () => ({}),
    text: () => '登録者数100万人の人気動画配信者から「選手とガチ対決する企画を撮りたい」と依頼が来た。',
    choices: [
      { label: '協力する', desc: 'ファン大幅アップのチャンス。ただし思わぬ展開も…',
        run: g => { if (Rand.chance(0.75)) { g.finance.fans += 1800; return '動画が200万回再生！ 若いファンがどっと増えた（ファン+1,800人）。'; }
          g.finance.fans += 300; addOwner(g, -2); return '選手がまさかのボロ負け…。笑えると話題だが、オーナーは渋い顔（オーナー−2）。'; } },
      { label: '断る', desc: '', run: () => '今回は見送った。' },
    ],
  },
  {
    id: 'oendan',
    cond: () => true,
    make: () => ({}),
    text: () => '応援団から「新しい応援歌を作ったので、公式に採用してほしい」と相談された。',
    choices: [
      { label: '公式応援歌にする（200万円）', desc: 'ファン+1,000人。次の試合、打者の力+2',
        ok: g => g.finance.funds >= 200,
        run: g => { g.finance.funds -= 200; g.finance.fans += 1000; g.flags.songBoost = true; return '球場が一体になる名曲が誕生！ 次の試合は打線が燃えそうだ。'; } },
      { label: '今の応援歌でいく', desc: '', run: () => '伝統の応援歌を大切にすることにした。' },
    ],
  },
  {
    id: 'gaisen',
    cond: g => g.team.players.length > 0,
    make: g => ({ p: Rand.pick(g.team.players) }),
    text: (g, d) => `${d.p.name}の地元の町が「凱旋パレードをしたい！」と盛り上がっている。`,
    choices: [
      { label: '1日休みをあげて参加させる', desc: '本人の調子が大きくアップ・ファン+500人',
        run: (g, d) => { d.p.changeCondition(2); g.finance.fans += 500; return `${d.p.name}は地元の声援に涙。「もっと活躍します！」（調子大幅アップ）`; } },
      { label: 'シーズン中なので断る', desc: '本人の調子が少しダウン', run: (g, d) => { d.p.changeCondition(-1); return `${d.p.name}は少し残念そうだ…。`; } },
    ],
  },
  // ---- お金・ビジネス（追加） ----
  {
    id: 'crowdfunding',
    cond: () => true,
    make: () => ({}),
    text: () => 'ファンから「球団を応援するクラウドファンディングをやってほしい！」という声が集まっている。',
    choices: [
      { label: '実施する（準備費300万円）', desc: '6割で大成功。返礼品の準備は大変',
        ok: g => g.finance.funds >= 300,
        run: g => { g.finance.funds -= 300;
          if (Rand.chance(0.6)) { g.finance.funds += 3500; g.finance.fans += 600; return '目標の3倍を達成！ +3,500万円・ファン+600人。'; }
          g.finance.funds += 900; return '目標には届かなかったが、+900万円が集まった。'; } },
      { label: 'やらない', desc: '', run: () => '今回は見送った。' },
    ],
  },
  {
    id: 'kitchenCar',
    cond: () => true,
    make: () => ({}),
    text: () => '全国のキッチンカーが集まる「グルメフェス」を、球場前の広場で開きたいと提案があった。',
    choices: [
      { label: '開く', desc: '出店料+600万円・ファン+500人',
        run: g => { g.finance.funds += 600; g.finance.fans += 500; return '試合前から大行列！ 球場がお祭りムードに包まれた。'; } },
      { label: '球団の売店の売上を守るため断る', desc: '', run: () => '今回は断った。' },
    ],
  },
  {
    id: 'vtuber',
    cond: () => true,
    make: () => ({}),
    text: () => '人気のバーチャル配信者から「球団とコラボ配信をしたい」とオファーが来た。',
    choices: [
      { label: 'コラボする（500万円）', desc: '当たれば同時視聴10万人！',
        ok: g => g.finance.funds >= 500,
        run: g => { g.finance.funds -= 500;
          if (Rand.chance(0.5)) { g.finance.fans += 2500; g.finance.funds += 1200; return 'コラボグッズが即完売！ +1,200万円・ファン+2,500人。'; }
          g.finance.fans += 500; return 'じわじわ話題に。ファン+500人。'; } },
      { label: '見送る', desc: '', run: () => '今回は見送った。' },
    ],
  },
  {
    id: 'tradingCard',
    cond: g => g.team.players.length > 0,
    make: g => ({ p: [...g.team.players].sort((a, b) => b.overall - a.overall)[0] }),
    text: (g, d) => `カード会社から「選手のトレーディングカードを出しましょう」と提案。目玉は${d.p.name}のサイン入りレアカードだ。`,
    choices: [
      { label: '発売する（1,500万円）', desc: '人気が出れば大もうけ',
        ok: g => g.finance.funds >= 1500,
        run: (g, d) => { g.finance.funds -= 1500; const r = Math.random();
          if (r < 0.45) { g.finance.funds += 5000; g.finance.fans += 800; return `${d.p.shortName}のレアカードを求めて大行列！ +5,000万円・ファン+800人。`; }
          if (r < 0.85) { g.finance.funds += 2200; return 'そこそこ売れた（+2,200万円）。'; }
          g.finance.funds += 600; return '在庫が山積みに…（+600万円）。'; } },
      { label: '見送る', desc: '', run: () => '今回は見送った。' },
    ],
  },
  {
    id: 'drama',
    cond: g => g.team.players.length > 0,
    make: () => ({}),
    text: () => 'テレビ局から「野球ドラマのロケ地として、球場を3日間貸してほしい」と依頼が来た。',
    choices: [
      { label: '貸す', desc: '使用料+1,000万円・ファン+1,200人。ただし練習時間が減る',
        run: g => { g.finance.funds += 1000; g.finance.fans += 1200; const n = moodSome(g, 2, -1);
          return `ドラマが放送されて球場が聖地に！ ${n.join('・')}は練習不足で調子が少し下がった。`; } },
      { label: '断る', desc: '', run: () => '練習を優先した。' },
    ],
  },
  {
    id: 'legendBall',
    cond: () => true,
    make: () => ({}),
    text: () => '倉庫の奥から、球団の歴史に残る「伝説のサヨナラホームランボール」が見つかった！',
    choices: [
      { label: 'オークションに出す', desc: '大金になるが、ファンは少し悲しむ',
        run: g => { const v = Rand.pick([1500, 2500, 4000]); g.finance.funds += v; g.finance.fans = Math.max(3000, g.finance.fans - 300); return `${Util.money(v)}で落札された！ ただ「思い出を売るなんて」という声も（ファン−300人）。`; } },
      { label: '球場に展示する', desc: 'ファン+800人',
        run: g => { g.finance.fans += 800; return '展示コーナーは連日大にぎわい。親子で見に来るファンも多い。'; } },
    ],
  },
  // ---- 国際大会 ----
  {
    id: 'national',
    cond: g => !g.flags.intlDone && g.team.players.some(p => p.overall >= 66 && p.available),
    make: g => {
      // 開幕直後は春の「世界野球クラシック」（試合は休まない）、それ以降は夏の大会（数試合抜ける）
      const T = g.gameIndex <= 1 ? INTL_TOURNAMENTS[0] : Rand.pick(INTL_TOURNAMENTS.slice(1));
      const ps = [...g.team.players].filter(p => p.overall >= 66 && p.available).sort((a, b) => b.overall - a.overall).slice(0, 2);
      return { t: T.id, ps };
    },
    text: (g, d) => { const T = INTL_TOURNAMENTS.find(x => x.id === d.t);
      return `「${T.name}」の日本代表に、${d.ps.map(p => p.name).join('・')}が選ばれた！ ${T.miss ? `出場すると${T.miss}試合チームを離れる。` : '大会は開幕前なので試合は休まない。'}球団として送り出す？`; },
    choices: [
      { label: '日本代表に送り出す', desc: '日の丸を背負う経験で大きく成長するかも。ケガのリスクもある',
        run: (g, d) => { const T = INTL_TOURNAMENTS.find(x => x.id === d.t); g.flags.intlDone = true;
          d.ps.forEach(p => { p.away = T.miss; });
          const names = d.ps.map(p => p.shortName).join('・');
          const r = Math.random();
          let text;
          if (r < 0.4) { g.finance.fans += 3000; g.finance.funds += 1000; addOwner(g, 3); d.ps.forEach(p => { p.changeCondition(2); p.gainExp(25); });
            text = `日本代表が優勝！ ${names}も大活躍し、球団の人気が急上昇（ファン+3,000人・関連グッズ+1,000万円・大きく成長）。`; }
          else if (r < 0.8) { g.finance.fans += 1200; d.ps.forEach(p => p.gainExp(12));
            text = `日本代表はベスト4。${names}は世界の強豪と戦って成長した（ファン+1,200人）。`; }
          else { g.finance.fans += 500; d.ps.forEach(p => p.changeCondition(-1));
            text = `日本代表はまさかの1次ラウンド敗退…。${names}は少し元気がない（ファン+500人）。`; }
          if (Rand.chance(0.15)) { const q = Rand.pick(d.ps); q.injured = Math.max(q.injured, 2); text += ` さらに${q.shortName}が代表戦でケガ（2試合欠場）…。`; }
          return text; } },
      { label: '辞退をお願いする', desc: 'チームに専念できるが、ファンとオーナーは残念がる',
        run: (g, d) => { g.flags.intlDone = true; g.finance.fans = Math.max(3000, g.finance.fans - 800); addOwner(g, -2); d.ps.forEach(p => p.changeCondition(-1));
          return `「日本代表を辞退」のニュースに、ファンから残念の声（ファン−800人・オーナー−2）。${d.ps.map(p => p.shortName).join('・')}も少し気落ちしている。`; } },
    ],
  },
  // ---- 首脳陣 ----
  {
    id: 'managerCrisis',
    cond: g => g.staff.manager && g.results.length >= 3 && g.results.slice(-3).every(r => r.outcome === 'lose'),
    make: g => ({ m: g.staff.manager, n: [...g.results].reverse().findIndex(r => r.outcome !== 'lose') }),
    text: (g, d) => `${d.n < 0 ? g.results.length : d.n}連敗中。オーナー「${d.m.name}監督のままでいいのか？」`,
    choices: [
      { label: g => `監督を解任する（違約金 ${Util.money(g.staff.manager ? g.staffFireFee(g.staff.manager) : 0)}）`,
        desc: '負け越していればオーナー評価+4。チームに刺激が入る。後任は補強タブで',
        ok: g => !!g.staff.manager,
        run: g => `${g.fireStaff('manager').text}補強タブで新しい監督を選ぼう。` },
      { label: '続投を支持する', desc: 'オーナー評価-3。監督が意地を見せるかも',
        run: (g, d) => { addOwner(g, -3);
          if (Rand.chance(0.5)) { const n = moodSome(g, 4, 1); return `${d.m.name}監督「必ず立て直します」。${n.join('・')}の目の色が変わった！`; }
          return 'オーナーは不満そうだ…。'; } },
    ],
  },
  {
    id: 'poach',
    cond: g => ['batting', 'pitching', 'fielding', 'farm'].some(r => g.staff[r] && g.staff[r].ability >= 68),
    make: g => { const role = Rand.pick(['batting', 'pitching', 'fielding', 'farm'].filter(r => g.staff[r] && g.staff[r].ability >= 68));
      return { role, st: g.staff[role], team: Rand.pick([...g.league.opponents, ...g.league2.teams]).name }; },
    text: (g, d) => `${d.team}が、${STAFF_ROLES[d.role].name}の${d.st.name}を引き抜きたいと言ってきた。`,
    choices: [
      { label: '年俸を3割上げて引き止める', desc: g => '年俸アップ・契約+1年',
        run: (g, d) => { if (g.staff[d.role] !== d.st) return 'すでにチームを離れていた。';
          d.st.salary = Math.round(d.st.salary * 1.3 / 100) * 100; d.st.years = Math.min(4, d.st.years + 1);
          return `${d.st.name}「この球団で結果を出します」。年俸${Util.money(d.st.salary)}で残留。`; } },
      { label: '移籍金をもらって送り出す', desc: '年俸1年分が入る。空席は代行がつとめる',
        run: (g, d) => { if (g.staff[d.role] !== d.st) return 'すでにチームを離れていた。';
          g.finance.funds += d.st.salary; g.staff[d.role] = null;
          return `${d.st.name}を送り出した（+${Util.money(d.st.salary)}）。補強タブで後任を探そう。`; } },
    ],
  },
  {
    id: 'legend',
    cond: () => true,
    make: () => { const role = Rand.pick(['batting', 'pitching', 'fielding', 'farm']);
      const st = StaffFactory.make(role, { ability: Rand.int(78, 88), age: Rand.int(55, 68), years: 2 });
      st.career = '地元出身・元プロの名選手'; st.salary = Math.round(st.salary * 0.8 / 100) * 100;
      return { role, st }; },
    text: (g, d) => `地元出身のレジェンド、${d.st.name}さん（${d.st.age}歳）が「地元のために${STAFF_ROLES[d.role].name}をやりたい」と申し出てきた。指導力${Util.rankOf(d.st.ability)}（${d.st.ability}）・年俸${Util.money(d.st.salary)}。`,
    choices: [
      { label: (g, d) => `${STAFF_ROLES[d.role].name}に招へいする${g.staff[d.role] ? `（今の${g.staff[d.role].name}は解任・違約金 ${Util.money(g.staffFireFee(g.staff[d.role]))}）` : ''}`,
        desc: '2年契約。地元が盛り上がりファン+500人',
        ok: (g, d) => g.finance.funds >= (g.staff[d.role] ? g.staffFireFee(g.staff[d.role]) : 0),
        run: (g, d) => { const pre = g.staff[d.role] ? g.fireStaff(d.role, { silent: true }).text : '';
          g.staff[d.role] = d.st; g.finance.fans += 500;
          return `${pre}${d.st.name}さんが${STAFF_ROLES[d.role].name}に就任！ 地元は大盛り上がりだ。`; } },
      { label: '気持ちだけいただく', desc: '', run: () => '丁重にお断りした。' },
    ],
  },
];

// ---------- 国際大会（実在の大会をもとにした架空の大会） ----------
const INTL_TOURNAMENTS = [
  { id: 'classic', name: '世界野球クラシック', miss: 0 },
  { id: 'festa',   name: '世界スポーツの祭典・野球競技', miss: 2 },
  { id: 'asia',    name: 'アジア野球チャンピオンシップ', miss: 1 },
];

// ---------- シーズンの方針（戦略）と目標 ----------
// game: 試合での効果（bat=打者のミート・パワー / pitch=投手の力 / run=足の速い選手が活躍）
// youngExp: 24歳以下の成長の倍率 / faFee: FA契約金の倍率 / fit: ドラフトで「方針に合う」度合い
const STRATEGIES = {
  balance: { name: 'バランス重視', desc: '特別な効果はないが、弱点もない', game: { bat: 0, pitch: 0, run: 0 }, youngExp: 1, faFee: 1,
             draft: '総合力の高い選手', fit: p => p.overall * 0.5 + p.potential * 0.6 },
  bat:     { name: '打ち勝つ野球', desc: '試合で打者のミート・パワー+3、投手-1', game: { bat: 3, pitch: -1, run: 0 }, youngExp: 1, faFee: 1,
             draft: 'ミート・パワーの高い野手', fit: p => (p.isPitcher ? 30 : p.stats.contact * 0.6 + p.stats.power * 0.7) + p.potential * 0.3 },
  pitch:   { name: '守り勝つ野球', desc: '試合で投手の力+3、打者-1', game: { bat: -1, pitch: 3, run: 0 }, youngExp: 1, faFee: 1,
             draft: '力のある投手', fit: p => (p.isPitcher ? p.overall * 1.2 : 30) + p.potential * 0.3 },
  speed:   { name: '機動力野球', desc: '足の速い打者がよく打ち、走者が先の塁まで進む', game: { bat: 0, pitch: 0, run: 1 }, youngExp: 1, faFee: 1,
             draft: '走力・守備の高い野手', fit: p => (p.isPitcher ? 30 : p.stats.speed * 0.9 + p.stats.defense * 0.4) + p.potential * 0.3 },
  youth:   { name: '育成重視', desc: '24歳以下の成長が1.5倍', game: { bat: 0, pitch: 0, run: 0 }, youngExp: 1.5, faFee: 1,
             draft: '伸びしろの大きい若手（高校生）', fit: p => p.potential * 1.1 + (p.origin === '高校' ? 6 : 0) + (p.age <= 20 ? 3 : 0) },
  now:     { name: '即戦力重視', desc: 'FA契約金が3割引き。24歳以下の成長は0.8倍', game: { bat: 0, pitch: 0, run: 0 }, youngExp: 0.8, faFee: 0.7,
             draft: '今すぐ使える社会人・大学生', fit: p => p.overall * 1.1 + (p.origin === '社会人' || p.origin === '大学' ? 4 : 0) },
};
const GOALS = {
  nippon:   { name: '日本一', desc: '日本一決定シリーズで勝つ', win: 18, lose: -10, check: g => !!g.post && g.post.champion === g.team.id },
  champion: { name: 'リーグ優勝', desc: 'レギュラーシーズン1位', win: 12, lose: -8, check: g => g.league.rankOf(g.team.id) === 1 },
  aclass:   { name: 'Aクラス（3位以内）', desc: '上位争いに加わる', win: 6, lose: -5, check: g => g.league.rankOf(g.team.id) <= 3 },
  half:     { name: '勝率5割以上', desc: '負け越さない', win: 4, lose: -3, check: g => g.record.w >= g.record.l },
  youth:    { name: '若手の成長', desc: '24歳以下の選手の能力アップ35回以上', win: 4, lose: -3, check: g => (g.youthGrowth || 0) >= 35 },
};
const NO_STYLE = { bat: 0, pitch: 0, run: 0 };

// ---------- オフシーズン（日本のプロ野球の流れをもとにした簡易版） ----------
// ドラフト → ①戦力外・合同トライアウト → ②FA → ③現役ドラフト → 契約更改 → 新シーズン
const FA_YEARS = 8;                     // 国内FA権：支配下で8年
const FA_OVERSEAS_YEARS = 9;            // 海外FA権：支配下で9年。海外への移籍には補償がない
const MLB_LEVEL = 72;                   // メジャーの球団が興味を持つ総合力
// FAランク：所属球団の年俸順位で決まる（A＝上位3人、B＝4〜10位、C＝それ以外）。A・Bは移籍すると補償がある
const FA_COMP = { A: 0.8, B: 0.6, C: 0 };   // 金銭補償（前の年俸に対する割合）
const GENYAKU_SALARY_LIMIT = 5000;       // 現役ドラフトのリストに載せられる年俸の上限（万円）
const OFF_STEPS = [
  { id: 'tryout', name: '戦力外・トライアウト' },
  { id: 'fa', name: 'FA' },
  { id: 'genyaku', name: '現役ドラフト' },
];

// ---------- ドラフト会議 ----------
const DRAFT_ROUNDS = 7;                           // 支配下ドラフト：7位まで
const IKUSEI_ROUNDS = 5;                          // 育成ドラフト：育成5位まで
const ROOKIE_SALARY = [1500, 1200, 1000, 800, 700, 600, 500];   // 支配下1位〜7位の年俸（万円）
const IKUSEI_SALARY = 300;                        // 育成選手の年俸（万円）
const PROMOTED_SALARY = 500;                      // 支配下登録したときの年俸（万円）
const DRAFT_POOL_MAIN = 54;                       // 支配下向きの候補
const DRAFT_POOL_IKUSEI = 30;
const DRAFT_AUTO = { main: 5, ikusei: 3 };          // おまかせ指名で取る人数（支配下・育成）                     // 育成向きの候補

// ---------- 初期データ（モック） ----------
const INITIAL_DATA = {
  season: 2026,
  ownerRating: 50,
  rules: {
    gamesPerSeason: 15,
    negativeLimit: 3,                    // （旧ルール・未使用）解任はシーズン終了後と開幕前にだけ判断する
    hoardLimit: 50000,                   // シーズン終了時にこれ以上お金を貯めているとオーナー評価-5
    maxRoster: 70,                       // 支配下登録の上限（NPBと同じ70人）
    maxFarm: null,                       // 育成選手の上限（NPBと同じく上限なし）
    maxActive: 31,                       // 出場選手登録（1軍）の上限。NPBは2020年から31人
    benchMax: 26,                        // 1試合のベンチ入り。NPBは26人（残りは「上がり」でベンチ外）
    reRegister: 2,                       // 抹消後に再登録できない試合数（NPBは10日間）
    tradesPerSeason: 3,
    eventChance: 0.7,                    // 試合前に出来事が起きる確率
  },
  // はじめの設定画面で上書きされる
  profile: { teamName: 'みらいスターズ', short: 'みらい', stadium: 'みらい市民球場', gm: 'あなた', color: '#1f7a45' },
  team: {
    id: 'my', name: 'みらいスターズ', short: 'みらい', color: '#1f7a45',
    players: [
      { type: 'P', id: 'p1', number: 18, name: '及川 蒼',   position: '投手', role: '先発', age: 27, salary: 3800, potential: 86, stats: { velocity: 150, control: 68, stamina: 80, breaking: 72 } },
      { type: 'P', id: 'p2', number: 11, name: '千葉 大翔', position: '投手', role: '先発', age: 23, salary: 1200, potential: 85, stats: { velocity: 146, control: 60, stamina: 74, breaking: 57 } },
      { type: 'P', id: 'p3', number: 21, name: '菅原 湊',   position: '投手', role: '先発', age: 31, salary: 2100, potential: 84, stats: { velocity: 139, control: 79, stamina: 66, breaking: 70 } },
      { type: 'P', id: 'p4', number: 47, name: '今野 颯',   position: '投手', role: '中継ぎ', age: 25, salary: 700, potential: 80, stats: { velocity: 148, control: 54, stamina: 38, breaking: 59 } },
      { type: 'P', id: 'p5', number: 30, name: '遠藤 樹',   position: '投手', role: '抑え', age: 29, salary: 2500, potential: 84, stats: { velocity: 154, control: 66, stamina: 34, breaking: 77 } },
      { type: 'B', id: 'b1', number: 2,  name: '阿部 陽翔', position: '捕手',   age: 30, salary: 1600, bats: '右', potential: 84, starter: true, stats: { contact: 54, power: 51, speed: 36, defense: 78 } },
      { type: 'B', id: 'b2', number: 3,  name: '佐々木 岳', position: '一塁手', age: 32, salary: 3500, bats: '左', potential: 90, starter: true, stats: { contact: 70, power: 84, speed: 31, defense: 48 } },
      { type: 'B', id: 'b3', number: 4,  name: '高橋 悠真', position: '二塁手', age: 26, salary: 1400, bats: '左', potential: 84, starter: true, stats: { contact: 72, power: 41, speed: 74, defense: 70 } },
      { type: 'B', id: 'b4', number: 5,  name: '木村 翔太', position: '三塁手', age: 28, salary: 2000, bats: '右', potential: 80, starter: true, stats: { contact: 64, power: 68, speed: 48, defense: 62 } },
      { type: 'B', id: 'b5', number: 6,  name: '後藤 蓮',   position: '遊撃手', age: 22, salary: 600,  bats: '右', potential: 92, starter: true, stats: { contact: 57, power: 36, speed: 82, defense: 80 } },
      { type: 'B', id: 'b6', number: 7,  name: '村上 海斗', position: '左翼手', age: 34, salary: 1900, bats: '右', potential: 78, starter: true, stats: { contact: 62, power: 73, speed: 34, defense: 41 } },
      { type: 'B', id: 'b7', number: 8,  name: '石川 隼人', position: '中堅手', age: 24, salary: 900,  bats: '左', potential: 92, starter: true, stats: { contact: 68, power: 46, speed: 87, defense: 76 } },
      { type: 'B', id: 'b8', number: 9,  name: '森 健太',   position: '右翼手', age: 27, salary: 1500, bats: '左', potential: 80, starter: true, stats: { contact: 59, power: 65, speed: 56, defense: 66 } },
      { type: 'B', id: 'b9', number: 25, name: '小野 航',   position: '指名打者', age: 29, salary: 1100, bats: '右', potential: 84, starter: true, stats: { contact: 66, power: 77, speed: 31, defense: 31 } },
      { type: 'B', id: 'b10', number: 0, name: '千田 柊',   position: '外野手', age: 20, salary: 400,  bats: '左', potential: 90, starter: false, stats: { contact: 51, power: 44, speed: 76, defense: 58 } },
    ],
  },
  finance: {
    funds: 15000,
    fans: 20000,
    ticketPrice: 2500,
    stadiumId: 'city',                   // 最初の本拠地は市民球場（運営費などは STADIUMS で決まる）
    sponsors: [
      { name: '地元の信用金庫',   tier: 'メインスポンサー', amount: 3000, years: 3 },
      { name: '駅前の商店街',     tier: 'ユニフォーム袖',   amount: 1200, years: 2 },
      { name: '街の電器屋',       tier: '球場看板',         amount: 500, years: 2 },
    ],
  },
  facilities: { goods: 1, training: 1, pr: 1, medical: 1, scout: 1, sales: 1 },
  // 球団・リーグは TEAM_CATALOG から、はじめの設定で選んだ球団に合わせて組み立てる
  opponents: [],
  leagueName: 'セントラ・リーグ',
  otherLeague: { name: 'パシフィカ・リーグ', teams: [] },
};

// ---------- 12球団（実在の都市を本拠地にした架空の球団）。はじめの設定で1つ選んで自分の球団にする ----------
// festival：その街の有名なお祭り（試合前の出来事で使う）
const TEAM_CATALOG = {
  central: { name: 'セントラ・リーグ', teams: [
    { id: 'bib', name: '東京ギガンテス',       short: '東京', en: 'Tokyo',   color: '#f97709', strength: 70, city: '東京',   festival: '神田祭' },
    { id: 'jin', name: '神宮スウィフツ',       short: '神宮', en: 'Jingu',   color: '#1b4d8f', strength: 62, city: '東京',   festival: '隅田川花火大会' },
    { id: 'tom', name: '横浜ベイシューターズ', short: '横浜', en: 'Yokohama',   color: '#0055a5', strength: 63, city: '横浜',   festival: '横浜開港祭' },
    { id: 'spr', name: '名古屋ドラグーンズ',   short: '名古屋', en: 'Nagoya', color: '#002569', strength: 64, city: '名古屋', festival: '名古屋まつり' },
    { id: 'tky', name: '西宮ベンガルズ',       short: '西宮', en: 'Bengals',   color: '#ffd400', strength: 68, city: '西宮',   festival: '十日えびす' },
    { id: 'nnw', name: '広島レッドコイズ',     short: '広島', en: 'Hiroshima',   color: '#e60012', strength: 61, city: '広島',   festival: 'ひろしまフラワーフェスティバル' },
  ] },
  pacific: { name: 'パシフィカ・リーグ', teams: [
    { id: 'yok', name: '福岡ファルコンズ',     short: '福岡', en: 'Fukuoka',   color: '#f5c700', strength: 72, city: '福岡', festival: '博多どんたく' },
    { id: 'ngy', name: '北海道ウォリアーズ',   short: '北海道', en: 'Hokkaido', color: '#006298', strength: 64, city: '札幌', festival: 'さっぽろ雪まつり' },
    { id: 'hir', name: '仙台グリフォンズ',     short: '仙台', en: 'Sendai',   color: '#860010', strength: 60, city: '仙台', festival: '仙台七夕まつり' },
    { id: 'kob', name: '千葉セイラーズ',       short: '千葉', en: 'Chiba',   color: '#222222', strength: 63, city: '千葉', festival: '幕張ビーチ花火フェスタ' },
    { id: 'snd', name: '埼玉レオンズ',         short: '埼玉', en: 'Saitama',   color: '#1f366a', strength: 66, city: '所沢', festival: '所沢まつり' },
    { id: 'hkt', name: '大阪バイソンズ',       short: '大阪', en: 'Osaka',   color: '#0a1f4d', strength: 67, city: '大阪', festival: '天神祭' },
  ] },
};
const ALL_TEAMS = [...TEAM_CATALOG.central.teams, ...TEAM_CATALOG.pacific.teams];
const teamDef = id => ALL_TEAMS.find(t => t.id === id) || null;

// ---------- ポストシーズン（日本のプロ野球のルールをもとにしている） ----------
// ・プレーオフ ファーストステージ：2位 対 3位。先に2勝で勝ち抜け（最大3試合）。全試合2位の本拠地。
//   勝ち数が同じなら2位が勝ち抜け。
// ・プレーオフ ファイナルステージ：1位 対 ファーストの勝者。1位に1勝のアドバンテージ。
//   先に4勝で勝ち抜け（最大6試合）。全試合1位の本拠地。勝ち数が同じなら1位が勝ち抜け。
// ・日本一決定シリーズ：両リーグの勝者が対戦。先に4勝で日本一。第1・2・6・7戦と第3〜5戦で本拠地が入れ替わり、
//   どちらのリーグが先にホームになるかは年ごとに交代。引き分けがあれば第8戦まで行う。
const POSTSEASON = {
  cs1: { name: 'プレーオフ ファーストステージ', short: 'POファースト', need: 2, adv: 0, max: 3 },
  cs2: { name: 'プレーオフ ファイナルステージ', short: 'POファイナル', need: 4, adv: 1, max: 6 },
  js:  { name: '日本一決定シリーズ', short: '日本一決定シリーズ', need: 4, adv: 0, max: 8 },
};
// どこまで勝ち進んだか（level）と、そのときのご褒美
const POST_RESULT = [
  { name: 'ポストシーズン進出ならず', owner: 0, prize: 0, fans: 0 },
  { name: 'プレーオフ ファーストステージ敗退', owner: 2, prize: 0, fans: 0 },
  { name: 'プレーオフ ファイナルステージ敗退', owner: 4, prize: 1000, fans: 0.02 },
  { name: '日本一決定シリーズ敗退', owner: 7, prize: 3000, fans: 0.05 },
  { name: '日本一！', owner: 12, prize: 6000, fans: 0.1 },
];

// ---------- ネーミングライツ（球場の名前を企業に売る） ----------
// brand が球場名になる。odd：ちょっと変わった名前（お金は多いが、ファンは少しびっくりする）
const NAMING_BRANDS = [
  { company: 'どこでもモバイル', brand: 'どこでも' },
  { company: 'トヨダ自動車',     brand: 'トヨダ' },
  { company: 'ネットフリッパー', brand: 'フリッパー' },
  { company: 'ANNA航空',         brand: 'ANNA' },
  { company: 'サイバーエージャント', brand: 'エージャント' },
  { company: 'みずぼ銀行',       brand: 'みずぼ' },
  { company: 'フジヤマテレビ',   brand: 'フジヤマ' },
  { company: 'パナソニッグ',     brand: 'パナソニッグ' },
  { company: 'キリソビール',     brand: 'キリソ' },
  { company: '吉牛屋',           brand: 'つゆだく',   odd: true },
  { company: 'カルビィ',         brand: 'ポテチ',     odd: true },
  { company: '任天丼',           brand: 'テンドン',   odd: true },
  { company: 'サンリヲ',         brand: 'ふわもこ',   odd: true },
];
const NAMING_WORD = { school: 'グラウンド', river: 'フィールド', city: 'スタジアム', stadium: 'スタジアム', dome: 'ドーム', ballpark: 'ボールパーク' };

// ---------- スポンサー営業 ----------
// amount: 1シーズンの金額（万円） / years: 契約年数 / cost: 営業費（万円） / base: 基本の成功率
// need: 営業できる条件（fans: ファン数、capacity: 球場の収容人数） / naming: ネーミングライツ（球場名が変わる）
// perkKey：契約中だけ効く特典（SPONSOR_PERKS）。need：営業できる条件
const SPONSOR_PERKS = {
  equip:   '最新設備の導入が2割引き',
  goods:   'グッズ・飲食 1人+100円',
  fans:    '毎試合のファン増加+0.3%',
  loan:    '銀行借入の利息が半分',
  medical: 'ケガで休む試合が1試合短い',
  scout:   'ドラフト候補の力+2',
  travel:  '球場の運営費が5%安い',
};
// 名前は有名企業をもじった架空の会社（実在の企業とは関係ない）
const SPONSOR_CATALOG = [
  // ---- おなじみのお店・ブランド ----
  { name: 'サイバーエージャント',     tier: 'ITパートナー',               amount: 1500,  years: 3, cost: 250,  base: 0.5,  itnav: true, perkKey: 'equip' },
  { name: 'ローソソ',                 tier: '球場看板',                   amount: 700,   years: 2, cost: 150,  base: 0.6 },
  { name: 'ファミリーマルト',         tier: '球場看板',                   amount: 600,   years: 2, cost: 120,  base: 0.65 },
  { name: 'みずぼ銀行',               tier: 'メインバンク',               amount: 1500,  years: 3, cost: 300,  base: 0.45, perkKey: 'loan' },
  { name: '吉牛屋',                   tier: '球場グルメ',                 amount: 800,   years: 2, cost: 150,  base: 0.55, perkKey: 'goods' },
  { name: 'グリコーン',               tier: '冠試合「ゴールインナイト」', amount: 1000,  years: 1, cost: 150,  base: 0.55 },
  { name: 'サンリヲ',                 tier: 'グッズ共同開発',             amount: 1200,  years: 2, cost: 200,  base: 0.5 },
  { name: 'ニトル',                   tier: '球場看板',                   amount: 500,   years: 2, cost: 100,  base: 0.7 },
  { name: '任天丼',                   tier: '冠試合「ゲームナイト」',     amount: 1200,  years: 1, cost: 200,  base: 0.55 },
  { name: 'バンダイナモ',             tier: 'グッズ共同開発',             amount: 1000,  years: 2, cost: 200,  base: 0.5 },
  { name: 'カルビィ',                 tier: '球場売店',                   amount: 1400,  years: 2, cost: 250,  base: 0.5,  perkKey: 'goods' },
  { name: '大昭製薬',                 tier: 'リカバリーパートナー',       amount: 1000,  years: 2, cost: 200,  base: 0.5,  perkKey: 'medical' },
  { name: 'グーグレ',                 tier: 'データ分析パートナー',       amount: 1200,  years: 2, cost: 250,  base: 0.45, perkKey: 'scout' },
  { name: 'ユニシロ',                 tier: 'ユニフォーム袖',             amount: 1300,  years: 2, cost: 220,  base: 0.5 },
  // ---- 大企業 ----
  { name: 'フジヤマテレビ',           tier: '中継パートナー',             amount: 2000,  years: 2, cost: 350,  base: 0.4,  perkKey: 'fans', need: { fans: 22000 } },
  { name: 'パナソニッグ',             tier: 'ヘルメット',                 amount: 1800,  years: 2, cost: 300,  base: 0.45, need: { fans: 20000 } },
  { name: 'キリソビール',             tier: '公式ビール',                 amount: 2400,  years: 2, cost: 350,  base: 0.4,  perkKey: 'goods', need: { fans: 24000 } },
  { name: 'どこでもモバイル',         tier: '公式通信パートナー',         amount: 2200,  years: 3, cost: 400,  base: 0.4,  need: { fans: 25000 } },
  { name: 'オリンポス',               tier: '公式メディカル',             amount: 2600,  years: 3, cost: 400,  base: 0.38, perkKey: 'medical', need: { fans: 27000 } },
  { name: 'ネットフリッパー',         tier: 'オフィシャル配信',           amount: 3000,  years: 2, cost: 450,  base: 0.35, perkKey: 'fans', need: { fans: 30000 } },
  { name: 'ANNA航空',                 tier: 'ユニフォーム胸',             amount: 5000,  years: 3, cost: 700,  base: 0.3,  perkKey: 'travel', need: { fans: 32000 } },
  { name: 'ヤマバ発動機',             tier: 'ユニフォーム背中',           amount: 4000,  years: 3, cost: 600,  base: 0.32, need: { fans: 30000 } },
  { name: 'トヨダ自動車',             tier: 'ユニフォーム胸・オフィシャルカー', amount: 6500, years: 3, cost: 900, base: 0.25, need: { fans: 36000 } },
];
SPONSOR_CATALOG.forEach(c => { if (c.perkKey) c.perk = SPONSOR_PERKS[c.perkKey]; });
// 提案のしかた：控えめ（金額は減るが通りやすい）／ふつう／強気（金額は増えるが断られやすい）
const SALES_MODES = [
  { name: '控えめに提案', short: '控えめ', amount: 0.8,  chance: 0.15 },
  { name: 'ふつうに提案', short: 'ふつう', amount: 1,    chance: 0 },
  { name: '強気に提案',   short: '強気',   amount: 1.25, chance: -0.15 },
];
const sponsorPerk = sp => sp.perk || (SPONSOR_CATALOG.find(c => c.name === sp.name) || {}).perkKey || null;

// ---------- GMの成績 ----------
// 1シーズンの採点（0〜100）：順位・ポストシーズン・目標・オーナー評価
const gmSeasonScore = h => Util.clamp(Math.round((6 - h.rank) * 9 + h.postLevel * 8 + (h.achieved ? 12 : 0) + h.owner * 0.2), 0, 100);
const GM_TITLES = [
  { min: 80, name: '伝説のGM', desc: '球史に名を残すチームビルダー' },
  { min: 65, name: '名GM',     desc: 'どの球団も欲しがる手腕' },
  { min: 50, name: '敏腕GM',   desc: '結果を出せる、頼れるGM' },
  { min: 35, name: '中堅GM',   desc: 'チームづくりが形になってきた' },
  { min: 0,  name: '駆け出しGM', desc: 'まずは仲間を信じて一歩ずつ' },
];
const GM_COUNTS = { trade: 'トレード成立', fa: 'FA・補強で獲得', draft: 'ドラフト指名', sponsor: 'スポンサー契約', invest: '施設への投資', hire: '首脳陣の招へい', fire: '首脳陣の解任', equip: '最新設備の導入' };

// ---------- ゲーム全体の状態 ----------
class GameState {
  constructor(data, profile) {
    data = Util.clone(data);
    this.profile = { difficulty: 'easy', ...data.profile, ...(profile || {}) };
    // 難易度に合わせて、はじめの戦力・資金・ファンを決める
    const st = (DIFFICULTY[this.profile.difficulty] || DIFFICULTY.easy).start;
    data.team.players.forEach(p => Object.keys(p.stats).forEach(k => { p.stats[k] += k === 'velocity' ? Math.round(st.stat / 2) : st.stat; }));
    Object.assign(data.finance, { funds: st.funds, fans: st.fans });
    Object.assign(data.team, { name: this.profile.teamName, short: this.profile.short, color: this.profile.color });
    // 選んだ球団のリーグに入る（オリジナル球団はセントラ・リーグの1枠を使う）
    const pick = teamDef(this.profile.pick) || TEAM_CATALOG.central.teams[TEAM_CATALOG.central.teams.length - 1];
    const myLg = TEAM_CATALOG.central.teams.includes(pick) ? TEAM_CATALOG.central : TEAM_CATALOG.pacific;
    const otherLg = myLg === TEAM_CATALOG.central ? TEAM_CATALOG.pacific : TEAM_CATALOG.central;
    data.opponents = myLg.teams.filter(t => t !== pick);
    data.leagueName = myLg.name;
    data.otherLeague = { name: otherLg.name, teams: otherLg.teams };
    this.profile.pick = pick.id;
    if (!this.profile.uniform) this.profile.uniform = defaultUniform(this.profile.color, chestText(this.profile));
    this.rules = data.rules;
    this.season = data.season;
    this.ownerRating = data.ownerRating;
    this.facilities = data.facilities;
    this.equipment = [];                 // 導入した最新設備
    // はじめの選手の名前も毎回ランダムに付ける
    PlayerFactory.usedNames = new Set();
    data.team.players.forEach(p => { p.name = PlayerFactory.name(); });
    this.team = new Team({ ...data.team, isMine: true, players: data.team.players.map(makePlayer) });
    this.finance = new Finance(data.finance, this.facilities, this.equipment);
    const opponents = data.opponents.map(o => PlayerFactory.team(o));
    this.league = new League({ teams: [this.team, ...opponents], myTeamId: this.team.id, gamesPerSeason: this.rules.gamesPerSeason });
    this.leagueName = data.leagueName;
    this.league2Name = data.otherLeague.name;
    this.league2 = new League({ teams: data.otherLeague.teams.map(o => PlayerFactory.team(o)), myTeamId: null, gamesPerSeason: this.rules.gamesPerSeason });
    this.news = [];
    this.firedReason = null;
    this.draft = null;
    this.titles = 0;                     // リーグ優勝の回数
    this.strategy = 'balance';           // チームの方針（シーズンをまたいで続く）
    this.lottery = { win: 0, lose: 0 };  // ドラフトのくじ引き通算成績
    this.stadiumHistory = [{ season: this.season, name: this.profile.stadium, type: this.finance.park.type }];
    this.staff = StaffFactory.initial();   // 監督・コーチ
    this.gmHistory = [];                   // GMとしての各シーズンの成績
    this.gmLog = {};                       // GMの仕事の回数（トレード・補強など）
    this.loan = 0;                         // 銀行からの借入残高
    this.startSeason();
    this.addNews('event', `${this.profile.gm}さんが${this.team.name}のGMに就任！`);
  }

  // ---- セーブ（保存できる形に変換する／元に戻す） ----
  get allTeams() { return this.league.teams; }
  findPlayer(id) {
    const teams = [...this.allTeams, ...(this.league2 ? this.league2.teams : [])];
    for (const t of teams) { const p = t.players.find(x => x.id === id) || t.farm.find(x => x.id === id); if (p) return p; }
    return this.fa.find(x => x.id === id) || (this.draft && this.draft.pool.find(x => x.id === id))
      || (this.off && this.off.tryout.find(x => x.id === id)) || (this.off && (this.off.mlb || []).find(x => x.id === id)) || null;
  }
  ownerOf(id) { return [...this.league.teams, ...this.league2.teams].find(t => t.players.some(p => p.id === id)) || null; }
  encodeData(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (v instanceof Player) out[k] = this.findPlayer(v.id) ? { ref: v.id } : { player: v };
      else out[k] = { value: v };
    }
    return out;
  }
  decodeData(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] = 'ref' in v ? this.findPlayer(v.ref) : 'player' in v ? makePlayer(v.player) : v.value;
    }
    return out;
  }
  toJSON() {
    return {
      version: 1, savedAt: Date.now(),
      profile: this.profile, rules: this.rules, season: this.season, ownerRating: this.ownerRating, facilities: this.facilities,
      team: { id: this.team.id, name: this.team.name, short: this.team.short, color: this.team.color, players: this.team.players, farm: this.team.farm, battingOrder: this.team.battingOrder },
      goal: this.goal, strategy: this.strategy, youthGrowth: this.youthGrowth,
      opponents: this.league.opponents.map(t => ({ id: t.id, name: t.name, short: t.short, color: t.color, players: t.players })),
      finance: { funds: this.finance.funds, fans: this.finance.fans, ticketPrice: this.finance.ticketPrice, sponsors: this.finance.sponsors, stadiumId: this.finance.stadiumId, channel: this.finance.channel, uniformHype: this.finance.uniformHype || 0, lastReport: this.finance.lastReport },
      titles: this.titles, stadiumHistory: this.stadiumHistory, lottery: this.lottery,
      leagueName: this.leagueName, league2Name: this.league2Name,
      league2: { teams: this.league2.teams.map(t => ({ id: t.id, name: t.name, short: t.short, color: t.color, players: t.players })), table: this.league2.table },
      off: this.off || null, tradeOffer: this.tradeOffer || null,
      post: this.post, salesLeft: this.salesLeft, offers: this.offers, naming: this.naming || null, namingOffers: this.namingOffers || [], lastRenewal: this.lastRenewal || null, japanTitles: this.japanTitles || 0,
      league: { schedule: this.league.schedule, table: this.league.table },
      gameIndex: this.gameIndex, results: this.results, lastGame: this.lastGame, negativeStreak: this.negativeStreak,
      tradesLeft: this.tradesLeft, flags: this.flags, seasonStart: this.seasonStart, fa: this.fa,
      seasonSummary: this.seasonSummary, news: this.news, firedReason: this.firedReason, recentEvents: this.recentEvents || [],
      pendingEvent: this.pendingEvent ? { id: this.pendingEvent.def.id, data: this.encodeData(this.pendingEvent.data) } : null,
      draft: this.draft,
      staff: this.staff, staffMarket: this.staffMarket, equipment: this.equipment, building: this.building || null, gmHistory: this.gmHistory, gmLog: this.gmLog, loan: this.loan || 0, limitedUniform: this.limitedUniform || null,
      stories: this.stories || [], retiredNumbers: this.retiredNumbers || [], nemesis: this.nemesis || null, daily: this.daily || null,
    };
  }
  static load(j) {
    const g = Object.create(GameState.prototype);
    Object.assign(g, {
      profile: { ...j.profile, uniform: j.profile.uniform || defaultUniform(j.profile.color, j.profile.short) }, rules: j.rules, season: j.season, ownerRating: j.ownerRating,
      facilities: { ...INITIAL_DATA.facilities, ...j.facilities },
      gameIndex: j.gameIndex, results: j.results, lastGame: j.lastGame, negativeStreak: j.negativeStreak,
      tradesLeft: j.tradesLeft, flags: j.flags, seasonStart: j.seasonStart, seasonSummary: j.seasonSummary,
      news: j.news, firedReason: j.firedReason, recentEvents: j.recentEvents,
      titles: j.titles || 0, stadiumHistory: j.stadiumHistory || [], lottery: j.lottery || { win: 0, lose: 0 },
      strategy: j.strategy || 'balance', youthGrowth: j.youthGrowth || 0,
      leagueName: j.leagueName || TEAM_CATALOG.central.name, league2Name: j.league2Name || TEAM_CATALOG.pacific.name,
      tradeOffer: j.tradeOffer || null,
      limitedUniform: j.limitedUniform || null, stories: j.stories || [], retiredNumbers: j.retiredNumbers || [], nemesis: j.nemesis || null, daily: j.daily || null,
      post: j.post || null, naming: j.naming || null, lastRenewal: j.lastRenewal || null, japanTitles: j.japanTitles || 0,
      // 方針がなかった古いセーブで、シーズンの途中なら「勝率5割以上」で続ける
      goal: j.goal || (j.gameIndex > 0 ? 'half' : null),
    });
    // 古いセーブでも、今のルール（登録人数など）で遊べるようにする
    g.rules = { ...INITIAL_DATA.rules, ...j.rules, maxRoster: INITIAL_DATA.rules.maxRoster, maxFarm: INITIAL_DATA.rules.maxFarm };
    g.team = new Team({ ...j.team, isMine: true, players: j.team.players.map(makePlayer), farm: (j.team.farm || []).map(makePlayer) });
    const opponents = j.opponents.map(o => new Team({ ...o, players: o.players.map(makePlayer) }));
    g.equipment = j.equipment || [];
    g.finance = new Finance(j.finance, g.facilities, g.equipment);
    g.staff = j.staff || StaffFactory.initial();
    g.building = j.building || null;
    g.gmHistory = j.gmHistory || [];
    g.gmLog = j.gmLog || {};
    g.loan = j.loan || 0;
    g.staffMarket = j.staffMarket || StaffFactory.market();
    g.finance.lastReport = j.finance.lastReport;
    g.league = new League({ teams: [g.team, ...opponents], myTeamId: g.team.id, gamesPerSeason: g.rules.gamesPerSeason });
    g.league.schedule = j.league.schedule;
    g.league.table = j.league.table;
    // もう1つのリーグ（古いセーブにはないので新しく作る）
    const l2teams = j.league2 ? j.league2.teams.map(o => new Team({ ...o, players: o.players.map(makePlayer) })) : TEAM_CATALOG.pacific.teams.map(o => PlayerFactory.team(o));
    g.league2 = new League({ teams: l2teams, myTeamId: null, gamesPerSeason: g.rules.gamesPerSeason });
    if (j.league2) g.league2.table = j.league2.table;
    // 球団名・略称・色は、今の設定に合わせる（古いセーブの球団名を置き換える）
    for (const def of ALL_TEAMS) {
      const t = g.league.team(def.id) || g.league2.team(def.id);
      if (t) Object.assign(t, { name: def.name, short: def.short, color: def.color });
    }
    g.finance.sponsors.forEach(sp => { if (sp.years === undefined) sp.years = 2; });
    g.salesLeft = j.salesLeft ?? 2 + g.facilities.sales;
    g.offers = j.offers || g.makeOffers();
    g.namingOffers = j.namingOffers || (g.naming ? [] : g.makeNamingOffers());
    // 古いセーブでシーズンが終わっていたら、ポストシーズンは済んだことにする
    if (g.gameIndex >= g.rules.gamesPerSeason && !g.post) g.post = { stage: 'done', series: [], done: [], champion: null, income: 0, myLevel: 0, seeds: { A: [], B: [] } };
    g.fa = j.fa.map(makePlayer);
    g.draft = j.draft && j.draft.stage ? { ...j.draft, pool: j.draft.pool.map(makePlayer) } : null;
    g.off = j.off ? { ...j.off, tryout: (j.off.tryout || []).map(makePlayer), mlb: (j.off.mlb || []).map(makePlayer) } : null;
    g.pendingEvent = null;
    if (j.pendingEvent) {
      const def = EVENTS.find(e => e.id === j.pendingEvent.id);
      if (def) g.pendingEvent = { def, data: g.decodeData(j.pendingEvent.data) };
    }
    // 名前の重複と選手番号が続きから正しく振られるように
    const all = [...g.allTeams.flatMap(t => t.players), ...g.league2.teams.flatMap(t => t.players), ...g.team.farm, ...g.fa, ...(g.draft ? g.draft.pool : [])];
    PlayerFactory.usedNames = new Set(all.map(p => p.name));
    nextPlayerId = Math.max(nextPlayerId, ...all.map(p => Number(String(p.id).replace(/\D/g, '')) || 0)) + 1;
    if (!g.nemesis && g.league.opponents.length) g.nemesis = g.pickNemesis();
    return g;
  }

  startSeason() {
    // 古いセーブ（10試合制）は、新しいシーズンから今の試合数にそろえる
    if (this.rules.gamesPerSeason !== INITIAL_DATA.rules.gamesPerSeason) {
      this.rules.gamesPerSeason = this.league.gamesPerSeason = this.league2.gamesPerSeason = INITIAL_DATA.rules.gamesPerSeason;
    }
    this.league.reset();
    this.league2.reset();
    this.post = null;                    // ポストシーズン（レギュラーシーズン後に作る）
    this.salesLeft = 2 + this.facilities.sales;   // スポンサー営業できる回数
    this.offers = this.makeOffers();
    if (!this.naming) this.namingOffers = this.makeNamingOffers();   // ネーミングライツの話は毎シーズン3社
    this.gameIndex = 0;
    this.results = [];
    this.lastGame = null;
    this.negativeStreak = 0;
    this.tradesLeft = this.rules.tradesPerSeason;
    // 今シーズンの成績を通算に足してから、新しいシーズンの成績を0にする
    [...this.team.players, ...this.team.farm].forEach(p => { if (p.ss) p.career = addSS(p.career, p.ss); p.ss = null; });
    this.nemesis = this.pickNemesis();
    this.flags = {};
    this.goal = null;                    // 今シーズンの目標（開幕前に決める）
    this.youthGrowth = 0;                // 24歳以下の能力アップ回数（目標「若手の成長」用）
    this.seasonStart = { funds: this.finance.funds, fans: this.finance.fans, owner: this.ownerRating, loan: this.loan || 0 };
    this.finance.lastReport = null;
    this.fa = Array.from({ length: 6 }, () => PlayerFactory.freeAgent());
    this.staffMarket = StaffFactory.market();   // 首脳陣の候補は毎シーズン入れ替わる
    this.seasonSummary = null;
    this.pendingEvent = null;
    this.rollEvent(0.9);
  }

  addNews(type, text) {
    this.news.unshift({ type, text });
    this.news = this.news.slice(0, 40);
  }

  get record() { return this.league.table[this.team.id]; }
  get nextGame() {
    const g = this.league.schedule[this.gameIndex];
    return g ? { ...g, opponent: this.league.team(g.opponentId) } : null;
  }
  get isSeasonOver() { return this.gameIndex >= this.rules.gamesPerSeason; }
  get isFired() { return !!this.firedReason; }
  get canPlay() { return !!this.nextGame && !this.isFired && !this.pendingEvent && !!this.goal; }
  get needsPlan() { return !this.goal && !this.isSeasonOver && !this.draft && !this.isFired; }
  setPlan(goal, strategy) {
    if (!GOALS[goal] || !STRATEGIES[strategy]) return { ok: false, text: '目標と方針を選んでください' };
    this.goal = goal;
    this.strategy = strategy;
    const G = GOALS[goal];
    this.addNews('event', `${this.season}年の目標は「${G.name}」、方針は「${STRATEGIES[strategy].name}」に決定！`);
    const say = goal === 'champion' ? 'その意気だ！ 楽しみにしているぞ' : goal === 'youth' ? '未来への投資か。いいだろう' : '堅実だな。まずは結果を見せてくれ';
    return { ok: true, text: `オーナー「${say}」` };
  }
  setStrategy(strategy) { if (STRATEGIES[strategy]) this.strategy = strategy; }

  // ---- 出来事 ----
  rollEvent(chance = this.rules.eventChance) {
    if (this.isSeasonOver || !Rand.chance(chance)) return;
    const recent = this.recentEvents || [];
    // repeat：地域の出来事などは直前でなければまた出てよい
    const pool = EVENTS.filter(e => (e.repeat ? recent[0] !== e.id : !recent.includes(e.id)) && e.cond(this));
    if (!pool.length) return;
    // weight が大きい出来事ほど出やすい（スポンサーがらみは3倍）
    let r = Math.random() * pool.reduce((sum, e) => sum + (e.weight || 1), 0);
    const def = pool.find(e => (r -= e.weight || 1) < 0) || pool[pool.length - 1];
    const data = def.make(this);
    if (def.before) def.before(this, data);
    this.pendingEvent = { def, data };
    this.recentEvents = [def.id, ...recent].slice(0, 5);   // 同じ出来事が続かないように
  }
  resolveEvent(i) {
    const ev = this.pendingEvent;
    if (!ev) return null;
    const c = ev.def.choices[i];
    if (c.ok && !c.ok(this, ev.data)) return null;
    const label = evText(c.label, this, ev.data);
    const text = c.run(this, ev.data);
    this.addNews('event', `${label} → ${text}`);
    this.pendingEvent = null;
    return text;
  }

  // ---- 試合 ----
  playNextGame() {
    if (!this.canPlay) return null;
    this.fixActive();
    const g = this.nextGame;
    const home = g.home ? this.team : g.opponent;
    const away = g.home ? g.opponent : this.team;
    const homeAdv = g.home ? this.finance.park.homeAdv : 0;
    const myStyle = this.myStyle;
    const styles = g.home ? { home: myStyle, away: NO_STYLE } : { home: NO_STYLE, away: myStyle };
    const sim = new GameEngine({ home, away, gameNo: this.gameIndex, homeAdv, styles, bonus: { [g.home ? 'home' : 'away']: this.diff.game } }).simulate();
    const mySide = g.home ? 'home' : 'away', oppSide = g.home ? 'away' : 'home';
    const outcome = sim.winner === null ? 'draw' : sim.winner === mySide ? 'win' : 'lose';
    const res = { game: g, home, away, sim, outcome, mySide, oppSide, myRuns: sim.totals[mySide].R, oppRuns: sim.totals[oppSide].R };
    res.highlights = this.highlights(res);
    this.commit(res);
    return res;
  }

  // 試合のハイライト（短い文章を数行）
  highlights(res) {
    const { sim, mySide, oppSide, outcome } = res;
    const lines = [];
    if (sim.walkOff && mySide === 'home' && outcome === 'win') lines.push('サヨナラ勝ち！ スタンドが総立ちに');
    const my = sim.lineups[mySide].filter(p => this.team.players.includes(p));
    const score = p => { const b = sim.bat[p.id] || {}; return (b.h || 0) + (b.hr || 0) * 2 + (b.rbi || 0); };
    my.filter(p => { const b = sim.bat[p.id]; return b && (b.hr || b.h >= 2 || b.rbi >= 2); })
      .sort((a, b) => score(b) - score(a)).slice(0, 2)
      .forEach(p => { const b = sim.bat[p.id]; lines.push(`${p.name}　${b.pa}打席${b.h}安打${b.hr ? `・${b.hr}本塁打` : ''}${b.rbi ? `・${b.rbi}打点` : ''}`); });
    const sp = sim.starters[mySide], spl = sim.pit[sp.id];
    if (spl) {
      const good = spl.outs >= 18 && spl.r <= 2;
      lines.push(`先発 ${sp.name}　${Util.innings(spl.outs)} ${spl.r}失点${good ? 'の好投' : spl.r >= 5 ? '、打ち込まれた' : ''}`);
    }
    ['away', 'home'].forEach(side => sim.board[side].forEach((r, i) => {
      if (typeof r === 'number' && r >= 4) lines.push(`${i + 1}回に${(side === 'away' ? res.away : res.home).short}が一挙${r}点`);
    }));
    if (outcome === 'lose') {
      const opp = sim.lineups[oppSide].filter(p => (sim.bat[p.id] || {}).hr).sort((a, b) => sim.bat[b.id].hr - sim.bat[a.id].hr)[0];
      if (opp) lines.push(`相手の${opp.name}に${sim.bat[opp.id].hr}本塁打を浴びた`);
    }
    // 宿敵との対決
    const nm = this.nemesis, nb = nm && sim.bat[nm.id];
    if (nb && sim.lineups[oppSide].some(p => p.id === nm.id)) {
      if (nb.hr) { nm.lost = (nm.lost || 0) + 1; lines.unshift(`宿敵・${nm.name}にまた打たれた（${nb.hr}本塁打）…`); }
      else if (nb.pa >= 3 && nb.h === 0) { nm.won = (nm.won || 0) + 1; this.finance.fans += 300; lines.unshift(`宿敵・${nm.name}をノーヒットに抑えた！ ファン+300人`); }
    }
    // 最終戦は引退試合
    if (this.gameIndex >= this.rules.gamesPerSeason - 1) this.team.players.filter(p => p.retiring === 'ceremony')
      .forEach(p => lines.unshift(`${p.name}の引退試合。最後の${p.isPitcher ? 'マウンド' : '打席'}に、スタンドから大きな拍手が送られた`));
    return lines.slice(0, 6);
  }

  // 試合後の反映：順位・お金・ファン・オーナー評価・調子・成長
  commit(res) {
    const { outcome, game } = res;
    this.league.record(this.team.id, outcome);
    this.league.record(game.opponent.id, outcome === 'win' ? 'lose' : outcome === 'lose' ? 'win' : 'draw');
    this.league.playOtherGames([this.team.id, game.opponent.id]);
    this.league2.playOtherGames([]);

    const report = this.finance.settle({ payroll: this.costPayroll, gamesPerSeason: this.rules.gamesPerSeason, outcome, home: game.home });
    // 期間限定ユニフォームは決まった試合数で元に戻る
    if (this.limitedUniform && --this.limitedUniform.left <= 0) {
      this.profile.uniform = this.limitedUniform.base;
      res.highlights.push(`期間限定の「${this.limitedUniform.name}」はこの試合で見納め。次からいつものユニフォームに戻る`);
      this.limitedUniform = null;
    }
    // 借入金の利息
    if (this.loan > 0) {
      const interest = Math.max(10, Math.round(this.loan * this.loanRate));
      this.finance.funds -= interest;
      report.interest = interest;
      report.net -= interest;
    }
    if (report.rain) res.highlights.push(`雨の${this.profile.stadium}。客足が鈍った`);
    const margin = Math.abs(res.myRuns - res.oppRuns);
    let d = outcome === 'win' ? 4 : outcome === 'lose' ? this.diff.lose : 0;
    if (margin >= 5) d += outcome === 'win' ? 1 : outcome === 'lose' ? -1 : 0;
    if (report.net < 0) d -= 2;
    if (this.finance.funds < 0) d -= 3;
    if (report.sellout) d += 1;
    if (this.flags.ownerOrder) { d += outcome === 'win' ? 3 : outcome === 'lose' ? -3 : 0; this.flags.ownerOrder = false; }
    // 少年との約束（ホームランを打てたか）
    if (this.flags.kidsPromise) {
      const pid = this.flags.kidsPromise, p = this.team.players.find(x => x.id === pid), b = res.sim.bat[pid];
      if (p && b && b.hr) { this.finance.fans += 2500; d += 2; res.highlights.unshift(`${p.name}が約束のホームラン！ 少年との約束を果たし、日本中が感動`); this.addNews('event', `${p.name}が少年との約束のホームラン！`); }
      else if (p) { this.finance.fans += 200; res.highlights.push(`${p.name}は約束のホームランならず…。それでも少年は「また応援する」と笑顔`); }
      this.flags.kidsPromise = null;
    }
    this.flags.songBoost = false;   // 応援歌の効果は1試合だけ
    d = Math.round(d * Math.min(1, 10 / this.rules.gamesPerSeason));   // 試合数が多いほど1試合の重みは小さい
    this.ownerRating = Util.clamp(this.ownerRating + d, 0, 100);
    this.negativeStreak = this.finance.funds < 0 ? this.negativeStreak + 1 : 0;
    res.report = report;
    res.ownerDelta = d;

    this.gameIndex++;
    this.results.push({ no: game.no, outcome, my: res.myRuns, opp: res.oppRuns, opponent: game.opponent.short, home: game.home });
    const word = { win: '勝利', lose: '敗戦', draw: '引き分け' }[outcome];
    this.addNews('game', `第${game.no}戦 vs ${game.opponent.short} ${res.myRuns}-${res.oppRuns}で${word}`);
    res.changes = this.afterGame(res);
    this.lastGame = this.gameView(res);

    // シーズン中は解任しない（判断はシーズンが終わってから）
    if (this.isSeasonOver) this.startPostseason();
    else { this.rollEvent(); this.maybeTradeOffer(); }
    if (this.tradeOffer && this.gameIndex > this.tradeOffer.until) { this.addNews('move', 'トレードの申し込みは取り下げられた'); this.tradeOffer = null; }
  }

  // 試合タブ・ホームに出す結果（セーブできるよう、文字と数字だけにする）
  gameView(res) {
    const { sim, mySide } = res;
    return {
      no: res.game.no, outcome: res.outcome, myRuns: res.myRuns, oppRuns: res.oppRuns, home: res.game.home,
      opp: res.game.opponent.short,
      away: { name: res.away.name, short: res.away.short }, homeTeam: { name: res.home.name, short: res.home.short },
      board: sim.board, totals: sim.totals, highlights: res.highlights, report: res.report, ownerDelta: res.ownerDelta, changes: res.changes,
      batting: sim.lineups[mySide].map((p, i) => ({ order: i + 1, name: p.name, ...(sim.bat[p.id] || { pa: 0, h: 0, hr: 0, rbi: 0, k: 0 }) })),
      pitching: Object.entries(sim.pit).map(([id, v]) => ({ p: this.team.players.find(x => x.id === id), ...v })).filter(x => x.p)
        .map(x => ({ name: x.p.name, outs: x.outs, r: x.r, k: x.k })),
    };
  }

  // 調子と成長。変化があった選手を返す
  afterGame(res) {
    const { sim, mySide } = res;
    const changes = [];
    const trainMul = (1 + (this.facilities.training - 1) * 0.3) * this.diff.grow;
    const eff = this.staffEffect;
    const played = new Set([...sim.lineups[mySide].map(p => p.id), ...Object.keys(sim.pit)]);
    this.checkStories();
    for (const p of this.team.players) {
      // ケガ・休養のカウントダウン
      if (p.away > 0 && --p.away === 0) { this.addNews('cond', `${p.name}が日本代表から戻ってきた！`); changes.push(`${p.shortName} 代表から復帰`); }
      if (p.injured > 0 && --p.injured === 0) { this.addNews('cond', `${p.name}がケガから復帰！ スタメンに戻すか決めよう`); changes.push(`${p.shortName} 復帰`); }
      if (p.rest > 0 && !played.has(p.id)) p.rest--;
      if (p.down > 0) p.down--;
      // シーズン成績（MVPや引退のことばに使う）
      { const b = sim.bat[p.id], pl = sim.pit[p.id];
        if (b || pl) p.ss = addSS(p.ss, { g: b ? 1 : 0, pa: b ? b.pa : 0, h: b ? b.h : 0, hr: b ? b.hr : 0, rbi: b ? b.rbi : 0, pg: pl ? 1 : 0, outs: pl ? pl.outs : 0, r: pl ? pl.r : 0 }); }
      if (p.overall > (p.peak || 0)) p.peak = p.overall;
      // 2軍の選手は試合に出ないが、練習で少し育ち、調子を整える
      if (!p.active) {
        if (p.condition < 0 && Rand.chance(0.5)) p.changeCondition(1);
        p.gainExp(Math.round((p.age <= 24 ? 6 : 3) * trainMul));
        continue;
      }
      // コンバートした位置に慣れていく（試合に出るほど早い。守備走塁コーチがよいとさらに早い）
      if (p.conv > 0) {
        p.conv = Math.max(0, p.conv - (played.has(p.id) ? 2 : 1) - (this.staff.fielding && this.staff.fielding.ability >= 70 ? 1 : 0));
        if (!p.conv) { this.addNews('grow', `${p.name}が${p.position}に慣れた！ コンバート成功`); changes.push(`${p.shortName} ${POS_ABBR[p.position]}に慣れた`); }
      }

      // 調子：活躍で上がり、不振で下がる。たまに気分で動く
      let dc = 0;
      const b = sim.bat[p.id], pl = sim.pit[p.id];
      if (b) {
        const perf = b.h + b.hr * 1.5 + b.rbi * 0.5;
        if (perf >= 3 && Rand.chance(0.65)) dc = 1;
        else if (b.h === 0 && b.pa >= 3 && Rand.chance(0.4)) dc = -1;
      }
      if (pl && pl.outs >= 9) {
        if (pl.r <= 2 && pl.outs >= 18) dc = Rand.chance(0.7) ? 1 : 0;
        else if (pl.r >= 5) dc = -1;
      }
      if (!dc && Rand.chance(0.15)) dc = p.condition > 0 ? -1 : p.condition < 0 ? 1 : Rand.pick([-1, 1]);
      if (dc && p.changeCondition(dc)) {
        if (Math.abs(p.condition) === 2) this.addNews('cond', `${p.name}が${CONDITION[p.condition]}に${p.condition > 0 ? '！' : '…'}`);
        changes.push(`${p.shortName} ${dc > 0 ? '調子↑' : '調子↓'}`);
      }

      // 成長：試合に出ると経験値。若いほど・練習施設が良いほど伸びる。出なかった1軍の選手も練習で少し伸びる
      if (!played.has(p.id)) {
        const grown = p.gainExp(Math.round((p.age <= 24 ? 3 : 1) * trainMul * (p.age <= 24 ? eff.growYoung : 1)));
        if (p.age <= 24) this.youthGrowth = (this.youthGrowth || 0) + grown.length;
        continue;
      }
      let ex = 5 + (b && (b.h >= 2 || b.hr) ? 3 : 0) + (pl && pl.outs >= 18 && pl.r <= 2 ? 5 : 0);
      ex *= (p.age <= 23 ? 2.4 : p.age <= 27 ? 1.5 : p.age >= 33 ? 0.3 : 0.7) * trainMul;
      if (p.age <= 24) ex *= STRATEGIES[this.strategy].youngExp * eff.growYoung;
      ex *= p.isPitcher ? eff.growPitch : eff.growBat;
      const grown = p.gainExp(Math.round(ex));
      if (p.age <= 24) this.youthGrowth = (this.youthGrowth || 0) + grown.length;
      if (grown.length) {
        this.addNews('grow', `${p.name}の${grown.join('・')}が上がった！`);
        changes.push(`${p.shortName} ${grown.join('・')}↑`);
      }
    }
    // 育成選手は2軍で練習して少しずつ育つ
    for (const p of this.team.farm) {
      if (p.conv > 0) p.conv = Math.max(0, p.conv - 1);
      const grown = p.gainExp(Math.round((p.age <= 23 ? 6 : 4) * trainMul * eff.growYoung * (p.isPitcher ? eff.growPitch : eff.growBat)
        * (p.age <= 24 ? STRATEGIES[this.strategy].youngExp : 1)));
      if (p.age <= 24) this.youthGrowth = (this.youthGrowth || 0) + grown.length;
      if (grown.length && Rand.chance(0.5)) changes.push(`育成 ${p.shortName} ${grown.join('・')}↑`);
    }
    const built = this.progressBuilding();
    if (built) changes.push(built);
    // FA市場が少し入れ替わる
    if (this.gameIndex % 3 === 0) {
      this.fa.splice(Rand.int(0, this.fa.length - 1), 1);
      this.fa.push(PlayerFactory.freeAgent(), PlayerFactory.freeAgent());
      this.fa = this.fa.slice(-7);
      this.addNews('move', 'FA市場に新しい選手が登録された');
    }
    return changes;
  }

  finishSeason() {
    const rank = this.league.rankOf(this.team.id);
    if (rank === 1) { this.titles++; this.addNews('event', `${this.season}年、リーグ優勝！（通算${this.titles}回目）`); }
    const bonus = [15, 8, 4, -2, -5, -10][rank - 1];
    const G = GOALS[this.goal] || GOALS.half;
    const achieved = G.check(this);
    const goalDelta = achieved ? G.win : G.lose;
    // ポストシーズンの結果
    const level = this.post ? this.post.myLevel : 0;
    const PR = POST_RESULT[level];
    if (PR.prize) this.finance.funds += PR.prize;
    if (PR.fans) this.finance.fans = Math.round(this.finance.fans * (1 + PR.fans));
    if (level === 4) { this.japanTitles = (this.japanTitles || 0) + 1; this.addNews('event', `${this.season}年、日本一！（通算${this.japanTitles}回目）`); }
    // 黒字には法人税がかかる
    // 借りたお金・返したお金は利益に入れない
    const profit = (this.finance.funds - (this.loan || 0)) - (this.seasonStart.funds - (this.seasonStart.loan || 0));
    const tax = profit > 0 ? Math.round(profit * this.diff.tax / 100) * 100 : 0;
    if (tax) { this.finance.funds -= tax; this.addNews('move', `今季の黒字${Util.money(profit)}に法人税 ${Util.money(tax)}を納めた`); }
    // 借金が残っているとオーナーの評価が下がる
    const debt = this.loan > 0 ? -3 : 0;
    if (debt) this.addNews('bad', `オーナー「借金（${Util.money(this.loan)}）を早く返せ」`);
    // お金を貯め込みすぎるとオーナーに叱られる
    const hoard = this.finance.funds >= this.rules.hoardLimit ? -5 : 0;
    if (hoard) this.addNews('bad', 'オーナー「お金を眠らせるな！ 選手や施設に投資しろ」');
    this.ownerRating = Util.clamp(this.ownerRating + bonus + goalDelta + PR.owner + hoard + debt, 0, 100);
    if (this.firstSeason && this.ownerRating < 10) {
      this.ownerRating = 10;
      this.addNews('bad', 'オーナー「1年目だから今回は大目に見る。来年は結果を出せ」（オーナー評価10%で続投）');
    }
    this.addNews('event', `目標「${G.name}」は${achieved ? '達成！' : '未達成…'}`);
    this.pendingEvent = null;
    this.seasonSummary = {
      season: this.season, rank, bonus, record: { ...this.record },
      goal: { name: G.name, achieved, delta: goalDelta }, strategy: STRATEGIES[this.strategy].name, youthGrowth: this.youthGrowth,
      post: { name: PR.name, owner: PR.owner, prize: PR.prize, champion: this.post && this.post.champion ? this.teamById(this.post.champion).name : null, income: this.post ? this.post.income : 0 },
      hoard, tax, debt, loan: this.loan || 0,
      standings: this.league.standings.map(r => ({ name: r.team.name, color: r.team.color, w: r.w, l: r.l, d: r.d, me: r.team.id === this.team.id })),
      fundsDelta: this.finance.funds - this.seasonStart.funds,
      fansDelta: this.finance.fans - this.seasonStart.fans,
      owner: this.ownerRating,
      mvp: this.seasonMVP,
    };
    this.gmHistory = this.gmHistory || [];
    this.gmHistory.push({
      season: this.season, team: this.team.name, rank, w: this.record.w, l: this.record.l, d: this.record.d,
      postLevel: level, post: PR.name, goal: G.name, achieved, owner: this.ownerRating,
      funds: this.finance.funds, fans: this.finance.fans,
    });
    if (this.ownerRating <= 0) this.firedReason = 'owner';
    this.seasonSummary.challenge = this.checkChallenge() && this.profile.challenge.doneSeason === this.season ? this.profile.challenge.done : null;
    if (this.daily) { this.daily.done = true; this.daily.score = gmSeasonScore(this.gmHistory[this.gmHistory.length - 1]); Daily.setBest(this.daily.date, this.daily.score); }
  }

  get diff() { return DIFFICULTY[this.profile.difficulty] || DIFFICULTY.easy; }   // 難易度のない古いセーブは「やさしい」
  setDifficulty(k) {
    if (!DIFFICULTY[k] || this.profile.difficulty === k) return null;
    this.profile.difficulty = k;
    this.addNews('event', `難易度を「${DIFFICULTY[k].name}」に変えた`);
    return { ok: true, text: `難易度を「${DIFFICULTY[k].name}」にしました。次の試合から反映されます` };
  }
  get firstSeason() { return !(this.gmHistory || []).length; }   // 就任1年目（まだシーズンを終えていない）
  // GMの仕事を数える
  gmCount(k) { this.gmLog = this.gmLog || {}; this.gmLog[k] = (this.gmLog[k] || 0) + 1; }
  // GMの通算成績
  get gmCareer() {
    const h = this.gmHistory || [];
    const sum = k => h.reduce((a, x) => a + x[k], 0);
    const scores = h.map(gmSeasonScore);
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const title = GM_TITLES.find(t => (avg ?? 0) >= t.min);
    const best = h.length ? h.reduce((a, b) => (gmSeasonScore(b) > gmSeasonScore(a) ? b : a)) : null;
    return {
      seasons: h.length, w: sum('w'), l: sum('l'), d: sum('d'),
      league: h.filter(x => x.rank === 1).length, japan: h.filter(x => x.postLevel === 4).length,
      cs: h.filter(x => x.postLevel >= 1).length, goals: h.filter(x => x.achieved).length,
      avg, title, best, scores,
    };
  }

  // オフ：年齢を重ね、若手は伸び、ベテランは衰える。相手球団も少し変わる
  nextSeason() {
    this.processRetirements();
    this.season++;
    const lines = [];
    [...this.league.opponents, ...this.league2.teams].forEach(t => t.players.forEach(p => { p.service++; }));
    for (const p of [...this.team.players, ...this.team.farm]) {
      p.age++; p.condition = 0; p.injured = 0; p.rest = 0; p.conv = 0; p.down = 0; p.away = 0;   // 不慣れはキャンプで解消
      if (this.team.players.includes(p)) p.service++;
      // オフの自主トレ：若いほど大きく伸びる（27歳まで）
      if (p.age <= 27) { const g = p.gainExp(Math.round((p.age <= 23 ? Rand.int(30, 50) : Rand.int(15, 30)) * this.diff.grow)); if (g.length) lines.push(`${p.shortName}（${g.join('・')}）`); }
      if (p.age >= 33) Object.keys(p.stats).forEach(k => { if (k !== 'velocity' && Rand.chance(0.6)) p.stats[k] = Math.max(20, p.stats[k] - Rand.int(1, 3)); });
    }
    [...this.league.opponents, ...this.league2.teams].forEach(t => t.players.forEach(p => Object.keys(p.stats).forEach(k => {
      if (k !== 'velocity') p.stats[k] = Util.clamp(p.stats[k] + Rand.int(-2, 2), 25, 95);
    })));
    this.renewContracts();
    this.renewSponsors();
    this.renewStaff();
    this.fundsFire = false;
    this.progressBuilding(true);   // オフの間に工事は終わる
    // オフの固定費と、ファンの熱が少し冷める
    this.finance.funds -= this.diff.offFixed;
    const cool = Math.round(this.finance.fans * FAN_COOL);
    this.finance.fans = Math.max(3000, this.finance.fans - cool);
    this.addNews('move', `オフの固定費（キャンプ・2軍運営・職員）${Util.money(this.diff.offFixed)}を払った。オフの間にファンが${cool.toLocaleString()}人離れた`);
    if (this.diff.support && !(this.challengeDef && this.challengeDef.noSupport)) {
      this.finance.funds += this.diff.support;
      this.addNews('move', `親会社から来季の支援金 ${Util.money(this.diff.support)}が入った`);
    }
    // 開幕前の資金チェック：マイナスなら銀行の緊急融資。借りられなければ解任
    if (this.finance.funds < 0) {
      const need = Math.ceil(-this.finance.funds / 5000) * 5000;
      if ((this.loan || 0) + need <= LOAN_MAX && this.ownerRating >= 20) {
        this.loan = (this.loan || 0) + need;
        this.finance.funds += need;
        this.addNews('bad', `開幕前に資金がマイナスだったため、銀行から緊急融資 ${Util.money(need)}を受けた（借入残高 ${Util.money(this.loan)}）`);
      } else this.fundsFire = true;
    }
    this.startSeason();
    if (this.fundsFire) { this.firedReason = 'funds'; this.fundsFire = false; }
    this.addNews('grow', lines.length ? `オフの練習で若手が成長：${lines.join('、')}` : '新しいシーズンが始まった');
  }

  // 契約更改：能力が上がった選手は年俸アップ、下がった選手はダウン（1年目の新人と育成選手はそのまま）
  renewContracts() {
    const before = this.team.payroll;
    const changes = [];
    for (const p of this.team.players) {
      if (p.draft && p.draft.startsWith(`${this.season - 1}年`)) continue;
      const target = Util.salaryFor(p.overall);
      const next = Math.max(400, Math.round(Util.clamp(target, p.salary * 0.75, p.salary * 1.3) / 100) * 100);
      if (Math.abs(next - p.salary) >= 100) changes.push({ name: p.name, from: p.salary, to: next });
      p.salary = next;
    }
    changes.sort((a, b) => (b.to - b.from) - (a.to - a.from));
    this.lastRenewal = { season: this.season, before, after: this.team.payroll, top: changes.slice(0, 6), count: changes.length };
    this.addNews('move', `契約更改：年俸総額 ${Util.money(before)} → ${Util.money(this.team.payroll)}`);
  }
  // スポンサー契約：1年ずつ減り、0になったら満了
  renewSponsors() {
    const f = this.finance;
    for (const sp of f.sponsors) sp.years--;
    const ended = f.sponsors.filter(sp => sp.years <= 0);
    f.sponsors = f.sponsors.filter(sp => sp.years > 0);
    ended.forEach(sp => this.addNews('bad', `スポンサー「${sp.name}」との契約が満了した。営業で新しいスポンサーを探そう`));
    if (this.naming && ended.some(sp => sp.name === this.naming.company)) {
      this.profile.stadium = this.naming.original;
      this.addNews('move', `ネーミングライツが終わり、球場名が「${this.naming.original}」に戻った`);
      this.naming = null;
    }
  }

  // ---- ポストシーズン ----
  teamById(id) { return this.league.team(id) || this.league2.team(id); }
  startPostseason() {
    const s1 = this.league.standings.map(r => r.team.id), s2 = this.league2.standings.map(r => r.team.id);
    const me = this.team.id;
    this.post = {
      stage: 'cs1', seeds: { A: s1.slice(0, 3), B: s2.slice(0, 3) },
      series: [this.makeSeries('A', 'cs1', s1[1], s1[2]), this.makeSeries('B', 'cs1', s2[1], s2[2])],
      done: [], champion: null, income: 0,
      myLevel: s1[0] === me ? 2 : s1.slice(1, 3).includes(me) ? 1 : 0,   // 1位はファイナルから
    };
    this.pendingEvent = null;
    this.addNews('event', this.post.myLevel ? `レギュラーシーズン${s1.indexOf(me) + 1}位でプレーオフ進出！` : 'プレーオフ進出ならず。ポストシーズンを見守ろう');
  }
  makeSeries(league, stage, a, b) {
    // a は上位（本拠地・アドバンテージあり）。日本一決定シリーズの本拠地は年ごとに交代
    let homes = [a];
    if (stage === 'js') {
      const x = this.season % 2 === 0 ? a : b, y = x === a ? b : a;
      homes = [x, x, y, y, y, x, x, x, y, x];
    }
    return { league, stage, a, b, wa: 0, wb: 0, draws: 0, games: [], homes, winner: null };
  }
  seriesHome(sr, i) { return sr.homes[Math.min(i, sr.homes.length - 1)]; }
  // 勝ち抜けが決まったか（a は 1位などのアドバンテージ込み）
  seriesDecided(sr) {
    const P = POSTSEASON[sr.stage], wa = sr.wa + P.adv;
    if (wa >= P.need) return sr.a;
    if (sr.wb >= P.need) return sr.b;
    if (sr.games.length >= P.max) {
      if (sr.stage === 'js' && wa === sr.wb && sr.games.length < 10) return null;   // 日本一決定シリーズは決着するまで
      return wa >= sr.wb ? sr.a : sr.b;
    }
    return null;
  }
  get postStage() { return this.post && this.post.stage !== 'done' ? this.post.series : []; }
  get myPostSeries() { return this.postStage.find(sr => !sr.winner && (sr.a === this.team.id || sr.b === this.team.id)) || null; }
  // 1日分（各シリーズ1試合ずつ）進める
  postAdvance() {
    const P = this.post;
    if (!P || P.stage === 'done') return;
    for (const sr of P.series) {
      if (sr.winner) continue;
      const i = sr.games.length;
      const homeId = this.seriesHome(sr, i), awayId = homeId === sr.a ? sr.b : sr.a;
      let winner, score;
      if (homeId === this.team.id || awayId === this.team.id) {
        const r = this.playPostGame(sr, homeId, awayId, i);
        winner = r.winner; score = r.score;
      } else {
        const h = this.teamById(homeId), a = this.teamById(awayId);
        if (Rand.chance(0.05)) { winner = null; score = '引き分け'; }
        else { winner = Rand.chance(1 / (1 + Math.exp(-(h.overall + 1 - a.overall) / 8))) ? homeId : awayId; }
      }
      sr.games.push({ no: i + 1, home: homeId, winner, score: score || '' });
      if (winner === sr.a) sr.wa++; else if (winner === sr.b) sr.wb++; else sr.draws++;
      const w = this.seriesDecided(sr);
      if (w) {
        sr.winner = w;
        const name = POSTSEASON[sr.stage].name;
        if (w === this.team.id) {
          P.myLevel = { cs1: 2, cs2: 3, js: 4 }[sr.stage];
          this.addNews('event', `${name}を勝ち抜いた！`);
        } else if (sr.a === this.team.id || sr.b === this.team.id) {
          this.addNews('bad', `${name}で敗退…`);
        } else this.addNews('game', `${name}：${this.teamById(w).name}が勝ち抜け`);
      }
    }
    if (P.series.every(sr => sr.winner)) this.postNextStage();
  }
  postNextStage() {
    const P = this.post;
    P.done.push(...P.series);
    const win = league => P.series.find(sr => sr.league === league).winner;
    if (P.stage === 'cs1') {
      P.stage = 'cs2';
      P.series = [this.makeSeries('A', 'cs2', P.seeds.A[0], win('A')), this.makeSeries('B', 'cs2', P.seeds.B[0], win('B'))];
    } else if (P.stage === 'cs2') {
      const a = win('A'), b = win('B');   // シリーズを入れ替える前に勝者を確定
      P.stage = 'js';
      P.series = [this.makeSeries('JS', 'js', a, b)];
      this.addNews('event', `日本一決定シリーズは ${this.teamById(a).name} 対 ${this.teamById(b).name}！`);
    } else {
      P.stage = 'done';
      P.champion = P.series[0].winner;
      P.series = [];
      this.addNews('event', `${this.teamById(P.champion).name}が日本一に輝いた！`);
    }
  }
  // 自分のチームのポストシーズンの試合（レギュラーシーズンと同じように計算する）
  playPostGame(sr, homeId, awayId, i) {
    const home = this.teamById(homeId), away = this.teamById(awayId);
    const myHome = homeId === this.team.id;
    const myStyle = this.myStyle;
    const styles = myHome ? { home: myStyle, away: NO_STYLE } : { home: NO_STYLE, away: myStyle };
    const sim = new GameEngine({ home, away, gameNo: this.gameIndex + i, homeAdv: myHome ? this.finance.park.homeAdv : 0, styles, bonus: { [myHome ? 'home' : 'away']: this.diff.game } }).simulate();
    const mySide = myHome ? 'home' : 'away', oppSide = myHome ? 'away' : 'home';
    const outcome = sim.winner === null ? 'draw' : sim.winner === mySide ? 'win' : 'lose';
    const res = { game: { no: i + 1, opponent: myHome ? away : home, home: myHome }, home, away, sim, outcome, mySide, oppSide, myRuns: sim.totals[mySide].R, oppRuns: sim.totals[oppSide].R };
    res.highlights = this.highlights(res);
    // ホームのポストシーズンは観客1.5倍（収容人数まで）・チケット1.2倍。運営費と選手への出場ボーナス（1.5試合分の年俸）を引く。ビジターは収入なし
    const f = this.finance, fansBefore = f.fans;
    let net = 0, attendance = 0;
    if (myHome) {
      // ポストシーズンは人気が高く、ふだんの1.5倍のお客さんが来る（球場の収容人数まで）
      attendance = Math.min(f.capacity, Math.round(f.fans * f.demandRate() * 1.5));
      net = Util.yenToMan(attendance * Math.round(f.ticketPrice * 1.2)) + Util.yenToMan(attendance * f.goodsPerFan)
        - f.operatingCost - Math.round(this.team.payroll / this.rules.gamesPerSeason * 1.5);
      f.funds += net;
      this.post.income += net;
    }
    if (outcome === 'win') f.fans = Math.round(f.fans * 1.01);
    res.report = { attendance, net, sellout: myHome, fansBefore, fansAfter: f.fans };
    res.ownerDelta = 0;
    res.changes = this.afterGame(res);
    const view = this.gameView(res);
    view.label = `${POSTSEASON[sr.stage].short} 第${i + 1}戦`;
    this.lastGame = view;
    const word = { win: '勝利', lose: '敗戦', draw: '引き分け' }[outcome];
    this.addNews('game', `${view.label} vs ${res.game.opponent.short} ${res.myRuns}-${res.oppRuns}で${word}`);
    return { winner: sim.winner === null ? null : sim.winner === 'home' ? homeId : awayId, score: `${sim.totals.away.R}-${sim.totals.home.R}` };
  }
  // ポストシーズンを終えて、シーズンの結果発表へ
  closePostseason() {
    if (!this.post || this.post.stage !== 'done' || this.seasonSummary) return;
    this.finishSeason();
  }

  // ---- スポンサー営業 ----
  makeOffers() {
    const have = new Set(this.finance.sponsors.map(sp => sp.name));
    const open = SPONSOR_CATALOG.filter(c => !have.has(c.name));
    // 地元のITパートナー候補には毎シーズン営業できる。残りはランダム
    const fixed = open.filter(c => c.itnav);
    return [...fixed, ...Rand.shuffle(open.filter(c => !c.itnav)).slice(0, 6 - fixed.length)].map(c => ({ name: c.name, status: null }));
  }
  offerDef(o) { return SPONSOR_CATALOG.find(c => c.name === o.name); }
  salesLock(c) {
    const n = c.need || {};
    const why = [];
    if (n.fans && this.finance.fans < n.fans) why.push(`ファン${n.fans.toLocaleString()}人以上`);
    if (n.capacity && this.finance.capacity < n.capacity) why.push(`収容${n.capacity.toLocaleString()}人以上の球場`);
    if (c.naming && this.naming) why.push('ネーミングライツは契約中');
    return why.length ? `条件：${why.join('・')}` : null;
  }
  // 成功率：ファン・オーナー評価・順位・営業部で変わる
  salesChance(c) {
    const f = this.finance;
    let p = c.base + (f.fans - 20000) / 120000 + (this.ownerRating - 50) / 250 + (this.facilities.sales - 1) * 0.05;
    const r = this.record;
    if (r.w + r.l >= 3) { const rank = this.league.rankOf(this.team.id); p += rank <= 2 ? 0.08 : rank >= 5 ? -0.06 : 0; }
    if (this.japanTitles) p += 0.05;
    return Util.clamp(p, 0.05, 0.95);
  }
  doSales(name, mode = 1) {
    const M = SALES_MODES[mode] || SALES_MODES[1];
    const o = this.offers.find(x => x.name === name);
    const c = o && this.offerDef(o);
    if (!c || o.status) return { ok: false, text: 'この会社にはもう営業しました' };
    if (this.salesLeft <= 0) return { ok: false, text: '今シーズンの営業回数を使い切りました（営業部を強化すると増える）' };
    const lock = this.salesLock(c);
    if (lock) return { ok: false, text: lock };
    if (this.finance.funds < c.cost) return { ok: false, text: '営業費が足りません' };
    this.finance.funds -= c.cost;
    this.salesLeft--;
    const chance = Util.clamp(this.salesChance(c) + M.chance, 0.05, 0.97);
    const pct = Math.round(chance * 100);
    if (!Rand.chance(chance)) {
      o.status = 'ng';
      return { ok: false, text: `${c.name}「今回は見送らせてください」（成功率${pct}%）` };
    }
    o.status = 'ok';
    const amount = Math.round(c.amount * M.amount / 100) * 100;
    this.finance.sponsors.push({ name: c.name, tier: c.tier, amount, years: c.years, perk: c.perkKey || null });
    let extra = c.perk ? ` 特典：${c.perk}。` : '';
    if (c.naming) {
      this.naming = { company: c.name, original: this.profile.stadium };
      this.profile.stadium = `${c.name.replace(/^.+の/, '')}パーク${this.team.short}`;
      extra = ` 球場名が「${this.profile.stadium}」になった！`;
    }
    this.gmCount('sponsor');
    this.addNews('move', `${c.name}と${c.tier}のスポンサー契約（年${Util.money(amount)}・${c.years}年）を結んだ！`);
    return { ok: true, text: `契約成立！（${M.name}）${c.name}が${c.tier}のスポンサーに（年${Util.money(amount)}×${c.years}年）。${extra}` };
  }

  // ---- ドラフト会議 ----
  // 支配下ドラフト（7位まで）：1巡目は全球団が同時に入札 → 重なったら抽選 → 外れた球団は再入札
  //                            2巡目からは下位球団から順に指名（巡ごとに順番が逆）
  // 育成ドラフト（育成5位まで）：支配下ドラフトのあと、同じ順番で指名
  // どの球団も「指名終了」したら、その後の巡では飛ばされる
  startDraft() {
    if (!this.isSeasonOver || !this.seasonSummary || this.draft || this.isFired) return;
    const pool = [
      ...Array.from({ length: DRAFT_POOL_MAIN }, () => PlayerFactory.draftProspect((this.facilities.scout - 1) * 2 + (this.finance.hasPerk('scout') ? 2 : 0))),
      ...Array.from({ length: DRAFT_POOL_IKUSEI }, () => PlayerFactory.ikuseiProspect((this.facilities.scout - 1) * 2 + (this.finance.hasPerk('scout') ? 2 : 0))),
    ];
    this.draft = {
      stage: 'main', round: 1, phase: 'bid', hazure: 0, pool,
      order: this.league.standings.map(r => r.team.id).reverse(),   // 下位球団から
      pending: this.league.teams.map(t => t.id),                   // 1位がまだ決まっていない球団
      ended: [],                                                   // この段階の指名を終えた球団
      reveal: null, lot: null, turn: 0, log: [], got1: [],
    };
    this.addNews('move', `${this.season}年 ドラフト会議が開幕！`);
  }
  get rosterFull() { return this.team.players.length >= this.rules.maxRoster; }
  get farmFull() { return this.rules.maxFarm != null && this.team.farm.length >= this.rules.maxFarm; }
  get draftRounds() { return this.draft && this.draft.stage === 'ikusei' ? IKUSEI_ROUNDS : DRAFT_ROUNDS; }
  get myDraftFull() { return this.draft && this.draft.stage === 'ikusei' ? this.farmFull : this.rosterFull; }
  get draftTurnTeam() {
    const d = this.draft;
    if (!d || d.phase !== 'pick') return null;
    return this.draftOrder(d.round)[d.turn];
  }
  draftOrder(round) { const d = this.draft; return round % 2 === 0 ? d.order : [...d.order].reverse(); }
  // チームのポジション別の層（主力の平均能力）。低いところが弱点
  teamDepth() {
    const out = {};
    for (const [g, n] of Object.entries(POS_DEPTH)) {
      const v = this.team.players.filter(p => posGroup(p) === g).map(p => p.overall).sort((a, b) => b - a).slice(0, n);
      while (v.length < n) v.push(40);
      out[g] = Math.round(v.reduce((a, b) => a + b, 0) / n);
    }
    return out;
  }
  // スカウト部長のおすすめ：方針に合うか＋チームの弱点を補えるか、で3人選ぶ
  draftRecommend() {
    const d = this.draft, st = STRATEGIES[this.strategy], fit = st.fit;
    const depth = this.teamDepth();
    const weakOrder = Object.keys(depth).sort((a, b) => depth[a] - depth[b]);
    const [weak, weak2] = weakOrder;
    const fitTop = new Set([...d.pool].sort((a, b) => fit(b) - fit(a)).slice(0, 8).map(p => p.id));
    // 他球団も狙いそうな選手（1巡目の入札で競合しやすい）
    const popular = new Set([...d.pool].sort((a, b) => (b.overall * 0.5 + b.potential * 0.6) - (a.overall * 0.5 + a.potential * 0.6)).slice(0, 4).map(p => p.id));
    const bidding = d.stage === 'main' && d.round === 1;
    // 3人は役割を分ける：①方針のイチオシ ②弱点の補強 ③別ポジションの注目
    const byFit = [...d.pool].sort((a, b) => fit(b) - fit(a));
    const slots = [];
    const take = (kind, list) => { const p = list.find(x => !slots.some(s => s.p === x)); if (p) slots.push({ kind, p }); };
    take('方針のイチオシ', byFit);
    take(`弱点の補強（${POS_GROUPS[weak]}）`, byFit.filter(p => posGroup(p) === weak));
    take('別ポジションの注目', byFit.filter(p => !slots.some(s => posGroup(s.p) === posGroup(p))));
    take('方針のおすすめ', byFit);
    const picks = slots.slice(0, 3).map(({ kind, p }) => {
      const reasons = [];
      if (fitTop.has(p.id)) reasons.push(`方針「${st.name}」にぴったり（${st.draft}）`);
      if (posGroup(p) === weak) reasons.push(`チームの弱点「${POS_GROUPS[weak]}」を補える（今の主力 ${Util.rankOf(depth[weak])}）`);
      else if (posGroup(p) === weak2) reasons.push(`層が薄い「${POS_GROUPS[weak2]}」の補強になる`);
      if (p.potential >= 85) reasons.push(`伸びしろ${Util.rankOf(p.potential)}の大物候補`);
      if (p.overall >= 65) reasons.push(`すぐ1軍で使える力（今の力 ${Util.rankOf(p.overall)}）`);
      if (bidding) reasons.push(popular.has(p.id) ? '人気選手。他球団と競合して抽選になりそう' : '他球団とかぶりにくい。単独指名をねらえる');
      if (!reasons.length) reasons.push('バランスのよい選手');
      return { p, reasons, kind };
    });
    return { depth, weak, picks, popular, bidding };
  }
  draftLabel(round, stage = this.draft.stage) { return stage === 'ikusei' ? `育成${round}位` : `${round}位`; }
  cpuDraftChoice() {
    let best = null, bv = -1e9;
    for (const p of this.draft.pool) {
      const v = p.overall * 0.5 + p.potential * 0.6 + Rand.range(-6, 6);
      if (v > bv) { bv = v; best = p; }
    }
    return best;
  }
  draftLog(teamId, round, p) {
    const t = this.league.team(teamId);
    this.draft.log.push({
      stage: this.draft.stage, label: this.draftLabel(round), round, team: t.name, color: t.color, mine: teamId === this.team.id,
      pid: p ? p.id : null, name: p ? p.name : '（指名終了）', pos: p ? (p.isPitcher ? '投手' : p.position) : '', origin: p ? `${p.origin}・${p.school}` : '',
    });
  }
  draftAssign(teamId, pid, round) {
    const d = this.draft;
    const p = d.pool.find(x => x.id === pid);
    if (!p) return null;
    d.pool = d.pool.filter(x => x !== p);
    const ikusei = d.stage === 'ikusei';
    p.salary = ikusei ? IKUSEI_SALARY : ROOKIE_SALARY[round - 1];
    p.draft = `${this.season}年 ${this.draftLabel(round)}`;
    p.starter = false;
    p.service = 0;
    if (!ikusei && round === 1) d.got1.push(teamId);
    this.draftLog(teamId, round, p);
    const t = this.league.team(teamId);
    if (teamId === this.team.id) {
      (ikusei ? t.farm : t.players).push(p);
      p.story = { year: this.season, label: this.draftLabel(round), start: p.overall };   // 成長ストーリーの始まり
      this.gmCount('draft');
      this.addNews('move', `ドラフト${this.draftLabel(round)}で${p.name}（${p.school}）を指名！`);
    } else if (!ikusei) {
      t.players.push(p);
      this.trimCpuRoster(t, p);
    }
    return p;
  }
  // 相手球団は人数を保つため、いちばん評価の低い選手が引退する
  trimCpuRoster(t, rookie) {
    const same = t.players.filter(p => p.isPitcher === rookie.isPitcher);
    const limit = rookie.isPitcher ? 5 : 9;
    if (same.length <= limit) return;
    const out = same.filter(p => p !== rookie).sort((a, b) => a.value - b.value)[0];
    if (out === undefined) return;
    if (rookie.isPitcher) rookie.role = out.role;
    else rookie.position = out.position;
    t.players = t.players.filter(p => p !== out);
  }
  // 1巡目の入札。pid は自分の入札（自分が入札しない回は null）
  draftBid(pid) {
    const d = this.draft;
    if (!d || d.phase !== 'bid') return { ok: false, text: '' };
    const meIn = d.pending.includes(this.team.id);
    if (meIn && pid === null) {
      // 支配下の指名をしないことを選んだ（このあと育成ドラフトだけ参加できる）
      d.got1.push(this.team.id);
      d.ended.push(this.team.id);
      d.pending = d.pending.filter(t => t !== this.team.id);
      this.draftLog(this.team.id, 1, null);
    } else if (meIn) {
      if (!d.pool.some(x => x.id === pid)) return { ok: false, text: '入札する選手を選んでください' };
      if (this.rosterFull) return { ok: false, text: `支配下が${this.rules.maxRoster}人でいっぱいです。編成タブで自由契約にして枠を空けよう` };
    }
    const bids = {};
    for (const tid of d.pending) bids[tid] = tid === this.team.id ? pid : this.cpuDraftChoice().id;
    const byPlayer = {};
    for (const [tid, p] of Object.entries(bids)) (byPlayer[p] = byPlayer[p] || []).push(tid);
    const rows = [];
    d.lot = null;
    for (const [p, tids] of Object.entries(byPlayer)) {
      const pl = d.pool.find(x => x.id === p);
      const row = (tid, st) => rows.push({ tid, team: this.league.team(tid).name, color: this.league.team(tid).color, name: pl.name, pos: pl.isPitcher ? '投手' : pl.position, origin: `${pl.origin}・${pl.school}`, pid: p, st });
      if (tids.length === 1) { row(tids[0], '単独入札 → 交渉権獲得'); this.draftAssign(tids[0], p, 1); }
      else if (tids.includes(this.team.id)) {
        d.lot = { pid: p, tids, choice: null, winEnv: Rand.int(0, tids.length - 1), winner: null, owners: null, name: pl.name };
        tids.forEach(t => row(t, `${tids.length}球団競合 → 抽選へ`));
      } else {
        const w = Rand.pick(tids);
        const odds = `確率${Math.round(100 / tids.length)}%`;
        tids.forEach(t => row(t, t === w ? `${tids.length}球団競合 → 抽選で交渉権獲得（${odds}）` : `${tids.length}球団競合 → 抽選で外れ`));
        this.draftAssign(w, p, 1);
      }
    }
    rows.sort((a, b) => d.order.indexOf(a.tid) - d.order.indexOf(b.tid));
    d.reveal = { rows, hazure: d.hazure };
    d.pending = d.pending.filter(t => !d.got1.includes(t));
    d.phase = 'reveal';
    return { ok: true };
  }
  // 抽選：封筒を1枚選ぶ
  // 封筒は球団の数だけあり、当たりは1枚（winEnv）。どれを選んでも当たる確率は「1 / 球団の数」
  draftDraw(envIdx) {
    const d = this.draft, L = d && d.lot;
    if (!L || L.choice !== null) return null;
    L.choice = envIdx;
    // 残りの封筒を他球団が1枚ずつ引く
    const others = Rand.shuffle(L.tids.filter(t => t !== this.team.id));
    L.owners = L.tids.map((_, i) => (i === envIdx ? this.team.id : others.pop()));
    L.winner = L.owners[L.winEnv];
    const won = L.winner === this.team.id;
    this.lottery = this.lottery || { win: 0, lose: 0 };
    this.lottery[won ? 'win' : 'lose']++;
    d.reveal.rows.forEach(r => { if (r.pid === L.pid) r.st = r.tid === L.winner ? `${L.tids.length}球団競合 → 抽選で交渉権獲得` : `${L.tids.length}球団競合 → 抽選で外れ`; });
    this.draftAssign(L.winner, L.pid, 1);
    d.pending = d.pending.filter(t => t !== L.winner);
    this.addNews('event', won ? `${L.tids.length}球団競合のくじを引き当てた！（当たる確率${Math.round(100 / L.tids.length)}%）` : `${L.tids.length}球団競合のくじははずれ…`);
    return won;
  }
  draftContinue() {
    const d = this.draft;
    if (!d || d.phase !== 'reveal' || (d.lot && d.lot.choice === null)) return;
    d.lot = null; d.reveal = null;
    if (d.pending.length) {
      d.hazure++;
      d.phase = 'bid';
      if (!d.pending.includes(this.team.id)) this.draftBid(null);   // 自分は決まっている → 他球団だけ再入札
      return;
    }
    d.round = 2; d.turn = 0; d.phase = 'pick';
    this.draftSkipEnded();
    this.draftRunCpu();
  }
  // 指名を終えた球団の番は飛ばす。全巡が終われば次の段階へ
  draftSkipEnded() {
    const d = this.draft;
    while (d.phase === 'pick') {
      if (d.round > this.draftRounds || !d.pool.length || d.ended.length >= d.order.length) { this.draftNextStage(); continue; }
      if (!d.ended.includes(this.draftTurnTeam)) return;
      d.turn++;
      if (d.turn >= d.order.length) { d.turn = 0; d.round++; }
    }
  }
  draftNextStage() {
    const d = this.draft;
    if (d.stage === 'main') {
      d.stage = 'ikusei'; d.round = 1; d.turn = 0; d.ended = [];
      this.addNews('move', '支配下ドラフトが終わり、育成ドラフトが始まった');
    } else d.phase = 'done';
  }
  draftAdvance() {
    const d = this.draft;
    d.turn++;
    if (d.turn >= d.order.length) { d.turn = 0; d.round++; }
    this.draftSkipEnded();
  }
  // 自分の番が来るまで他球団が指名する
  draftRunCpu() {
    const d = this.draft;
    while (d.phase === 'pick' && this.draftTurnTeam !== this.team.id) {
      const tid = this.draftTurnTeam;
      // 他球団は支配下を7位まで、育成は巡が進むほど指名をやめやすい
      const stop = d.stage === 'ikusei' ? 0.25 + d.round * 0.1 : Math.max(0, (d.round - 4) * 0.3);
      if (Rand.chance(stop)) {
        d.ended.push(tid);
        this.draftLog(tid, d.round, null);
      } else {
        this.draftAssign(tid, this.cpuDraftChoice().id, d.round);
      }
      this.draftAdvance();
    }
  }
  draftPick(pid) {
    const d = this.draft;
    if (!d || d.phase !== 'pick' || this.draftTurnTeam !== this.team.id) return { ok: false, text: '' };
    if (this.myDraftFull) {
      return { ok: false, text: d.stage === 'ikusei'
        ? `育成選手が${this.rules.maxFarm}人でいっぱいです。編成タブで自由契約にするか「指名終了」を選ぼう`
        : `支配下が${this.rules.maxRoster}人でいっぱいです。編成タブで自由契約にするか「指名終了」を選ぼう` };
    }
    if (!this.draftAssign(this.team.id, pid, d.round)) return { ok: false, text: '指名する選手を選んでください' };
    this.draftAdvance();
    this.draftRunCpu();
    return { ok: true };
  }
  // 自分はこの段階（支配下／育成）の指名を終える
  draftEnd() {
    const d = this.draft;
    if (!d || d.phase !== 'pick' || this.draftTurnTeam !== this.team.id) return;
    d.ended.push(this.team.id);
    this.draftLog(this.team.id, d.round, null);
    this.draftAdvance();
    this.draftRunCpu();
  }
  // おまかせ指名：スカウト部長のおすすめで、残りの指名をすべて進める（くじも自動で引く）
  // 支配下は DRAFT_AUTO.main 人、育成は DRAFT_AUTO.ikusei 人まで（年俸がふくらみすぎないように）
  draftAuto() {
    const d = this.draft;
    if (!d || d.phase === 'done') return [];
    const mine = st => d.log.filter(l => l.mine && l.stage === st && l.pid).length;
    for (let guard = 0; d.phase !== 'done' && guard < 500; guard++) {
      if (d.phase === 'bid') {
        const rec = this.rosterFull ? null : this.draftRecommend().picks[0];
        this.draftBid(rec ? rec.p.id : null);
      } else if (d.phase === 'reveal') {
        if (d.lot && d.lot.choice === null) this.draftDraw(Rand.int(0, d.lot.tids.length - 1));
        this.draftContinue();
      } else if (d.phase === 'pick') {
        if (this.draftTurnTeam !== this.team.id) { this.draftRunCpu(); continue; }
        const limit = d.stage === 'ikusei' ? DRAFT_AUTO.ikusei : DRAFT_AUTO.main;
        const rec = this.myDraftFull || mine(d.stage) >= limit ? null : this.draftRecommend().picks[0];
        if (rec) this.draftPick(rec.p.id); else this.draftEnd();
      } else break;
    }
    this.addNews('move', `ドラフトをスカウト部長におまかせした（支配下${mine('main')}人・育成${mine('ikusei')}人を指名）`);
    return d.log.filter(l => l.mine && l.pid);
  }
  finishDraft() {
    if (!this.draft || this.draft.phase !== 'done') return;
    this.draft = null;
    this.startOffseason();
  }

  // ===== オフシーズン =====
  startOffseason() {
    this.off = { step: 'tryout', tryout: [], faOut: [], faIn: [], genyaku: null, log: [] };
    this.makeTryout();
    this.addNews('move', 'オフシーズン開始。戦力外になった選手の合同トライアウトが行われる');
  }
  offNext() {
    const o = this.off;
    if (!o) return;
    if (o.step === 'tryout') { o.tryout = []; o.step = 'fa'; this.makeFA(); }
    else if (o.step === 'fa') { this.finishFA(); o.step = 'genyaku'; this.makeGenyaku(); }
    else if (o.step === 'genyaku') {
      if (!o.genyaku.done) return;
      this.off = null;
      this.nextSeason();
    }
  }

  // ---- ①戦力外・合同トライアウト ----
  // 他球団はベテランを中心に1〜2人を戦力外にし、若手で穴を埋める。戦力外の選手は安く獲得できる
  makeTryout() {
    const pool = [];
    for (const t of [...this.league.opponents, ...this.league2.teams]) {
      const cut = t.players.filter(p => p.age >= 29).sort((a, b) => a.value - b.value).slice(0, Rand.int(1, 2));
      for (const p of cut) {
        t.players = t.players.filter(x => x !== p);
        const level = Util.clamp(Math.round(t.players.reduce((s, x) => s + x.overall, 0) / t.players.length) - 4, 45, 70);
        const young = p.isPitcher ? PlayerFactory.pitcher({ level, role: p.role, age: Rand.int(20, 24) }) : PlayerFactory.batter({ level, position: p.position, age: Rand.int(20, 24) });
        young.service = 0;
        t.players.push(young);
        p.from = t.short;
        pool.push(p);
      }
    }
    pool.forEach(p => { p.salary = Math.max(400, Math.round(Util.salaryFor(p.overall) * 0.5 / 100) * 100); p.condition = 0; });
    this.off.tryout = pool.sort((a, b) => b.overall - a.overall).slice(0, 10);
  }
  signTryout(id) {
    const p = this.off && this.off.tryout.find(x => x.id === id);
    if (!p) return { ok: false, text: 'その選手はもういません' };
    if (this.rosterFull) return { ok: false, text: `支配下が${this.rules.maxRoster}人でいっぱいです` };
    this.off.tryout = this.off.tryout.filter(x => x !== p);
    p.starter = false;
    this.team.players.push(p);
    this.gmCount('fa');
    this.addNews('move', `トライアウトで${p.name}（元${p.from}）を獲得！ 年俸${Util.money(p.salary)}`);
    return { ok: true, text: `${p.name}と契約しました（年俸${Util.money(p.salary)}・契約金なし）` };
  }

  // ---- ②FA ----
  faRank(p, team) {
    const order = [...team.players].sort((a, b) => b.salary - a.salary);
    const i = order.indexOf(p);
    return i >= 0 && i < 3 ? 'A' : i >= 3 && i < 10 ? 'B' : 'C';
  }
  makeFA() {
    const o = this.off;
    const rank = this.league.rankOf(this.team.id);
    // 自分の選手：FA権を持つ選手が、条件しだいで宣言する
    for (const p of this.team.players) {
      if (p.service < FA_YEARS || p.age >= 36) continue;
      // 海外FA権があり、メジャーが注目する選手は、海外FAを宣言することがある
      if (p.service >= FA_OVERSEAS_YEARS && p.overall >= MLB_LEVEL && p.age <= 34
          && Rand.chance(Util.clamp(0.3 + (p.overall - MLB_LEVEL) * 0.03 + (p.age <= 30 ? 0.1 : 0), 0, 0.75))) {
        o.faOut.push({ id: p.id, rank: '海外', overseas: true, oldSalary: p.salary, status: null });
        continue;
      }
      const chance = Util.clamp(0.15 + (p.overall >= 70 ? 0.25 : 0) + (rank >= 4 ? 0.15 : 0) + (p.salary < Util.salaryFor(p.overall) ? 0.1 : 0) - (this.ownerRating >= 80 ? 0.05 : 0), 0, 0.6);
      if (Rand.chance(chance)) o.faOut.push({ id: p.id, rank: this.faRank(p, this.team), oldSalary: p.salary, status: null });
    }
    // 他球団のスター：海外FAでメジャーへ（抜けた穴は若手が埋める）
    o.mlbOut = [];
    const stars = [];
    for (const t of [...this.league.opponents, ...this.league2.teams]) {
      for (const p of t.players) if (p.service >= FA_OVERSEAS_YEARS && p.overall >= MLB_LEVEL && p.age <= 33) stars.push({ p, t });
    }
    for (const { p, t } of Rand.shuffle(stars).filter(() => Rand.chance(0.4)).slice(0, 2)) {
      t.players = t.players.filter(x => x !== p);
      const fill = p.isPitcher ? PlayerFactory.pitcher({ level: 58, role: p.role, age: 22 }) : PlayerFactory.batter({ level: 58, position: p.position, age: 22 });
      fill.service = 0;
      t.players.push(fill);
      o.mlbOut.push({ name: p.name, team: t.name, pos: p.isPitcher ? `投手（${p.role}）` : p.position, overall: p.overall });
      this.addNews('game', `${t.name}の${p.name}が海外FA権を行使してメジャーリーグへ`);
    }
    // メジャー帰りの選手（どこの球団にも属していないので補償なし）
    o.mlb = [];
    if (Rand.chance(0.7)) {
      const lv = Rand.int(68, 78), age = Rand.int(31, 35);
      const p = Rand.chance(0.5) ? PlayerFactory.pitcher({ level: lv, role: Rand.pick(['先発', '中継ぎ', '抑え']), age }) : PlayerFactory.batter({ level: lv, age });
      p.service = FA_OVERSEAS_YEARS; p.salary = Util.salaryFor(p.overall);
      o.mlb.push(p);
      o.faIn.push({ id: p.id, team: 'mlb', rank: 'C', oldSalary: p.salary, ask: Math.round(Util.salaryFor(p.overall) * 1.4 / 100) * 100, status: null });
    }
    // 他球団の選手：FA権を持つ主力が何人か宣言する
    const cand = [];
    for (const t of [...this.league.opponents, ...this.league2.teams]) {
      for (const p of t.players) if (p.service >= FA_YEARS && p.overall >= 60 && p.age <= 34) cand.push({ p, t });
    }
    for (const { p, t } of Rand.shuffle(cand).slice(0, 4)) {
      const ask = Math.round(Util.salaryFor(p.overall) * 1.3 / 100) * 100;
      o.faIn.push({ id: p.id, team: t.id, rank: this.faRank(p, t), oldSalary: p.salary, ask, status: null });
    }
    if (o.faOut.length) this.addNews('bad', `${o.faOut.map(f => `${this.findPlayer(f.id).name}${f.overseas ? '（海外FA）' : ''}`).join('・')}がFA宣言した！`);
  }
  // 自分の選手の残留交渉。level: 0=現状維持 1=1割アップ 2=3割アップ 3=5割アップ
  retainChance(f, level) {
    const p = this.findPlayer(f.id), rank = this.league.rankOf(this.team.id);
    const dream = f.overseas ? 0.25 : 0;   // メジャーへの夢は、お金だけでは止めにくい
    return Util.clamp(0.2 + level * 0.18 + (rank <= 3 ? 0.12 : 0) + (p.condition > 0 ? 0.05 : 0) + (this.post && this.post.myLevel >= 3 ? 0.08 : 0) - dream, 0.05, f.overseas ? 0.7 : 0.92);
  }
  retainFA(id, level) {
    const f = this.off.faOut.find(x => x.id === id);
    if (!f || f.status) return null;
    const p = this.findPlayer(id);
    const up = [1, 1.1, 1.3, 1.5][level];
    if (Rand.chance(this.retainChance(f, level))) {
      p.salary = Math.round(p.salary * up / 100) * 100;
      f.status = 'stay';
      this.addNews('move', `${p.name}がFA宣言残留！ 年俸${Util.money(p.salary)}で再契約`);
      return { ok: true, text: `${p.name}「このチームで優勝したい」残留が決まりました（年俸${Util.money(p.salary)}）` };
    }
    return this.loseFA(f, f.overseas ? `${p.name}「子どものころからの夢に挑戦させてください」` : `${p.name}「新しい環境で挑戦したい」交渉は決裂…`);
  }
  // 引き止めない／交渉決裂：他球団へ移籍し、ランクに応じた補償を受け取る
  loseFA(f, msg) {
    const p = this.findPlayer(f.id);
    // 海外FA：メジャーへ。補償はないが、送り出すとファンは応援してくれる
    if (f.overseas) {
      this.team.players = this.team.players.filter(x => x !== p);
      f.status = 'left'; f.to = 'mlb';
      this.finance.fans += 800;
      this.addNews('bad', `${p.name}が海外FA権を行使してメジャーリーグへ！`);
      return { ok: false, text: `${msg} ${p.name}はメジャーリーグへ移籍します（海外移籍なので補償なし。壮行会でファン+800人）` };
    }
    const to = Rand.pick([...this.league.opponents, ...this.league2.teams]);
    this.team.players = this.team.players.filter(x => x !== p);
    p.starter = false;
    p.salary = Math.round(Math.max(p.salary, Util.salaryFor(p.overall)) * 1.2 / 100) * 100;
    to.players.push(p);
    this.trimCpuRoster(to, p);
    f.status = 'left';
    f.to = to.id;
    if (f.rank !== 'C') {
      // 人的補償の候補：移籍先の、主力ではない選手から3人
      f.compCands = [...to.players].filter(x => x !== p).sort((a, b) => a.value - b.value).slice(3, 9).sort(() => Math.random() - 0.5).slice(0, 3).map(x => x.id);
      f.comp = null;
    }
    this.addNews('bad', `${p.name}がFAで${to.name}へ移籍`);
    return { ok: false, text: `${msg} ${p.name}は${to.name}へ移籍します。${f.rank === 'C' ? '（Cランクなので補償なし）' : `${f.rank}ランクなので補償を選べます`}` };
  }
  takeCompensation(id, choice) {
    const f = this.off.faOut.find(x => x.id === id);
    if (!f || f.status !== 'left' || f.comp || f.rank === 'C') return null;
    if (choice === 'money') {
      const money = Math.round(f.oldSalary * FA_COMP[f.rank] / 100) * 100;
      this.finance.funds += money;
      f.comp = 'money';
      return { ok: true, text: `金銭補償 ${Util.money(money)} を受け取りました` };
    }
    const to = this.league.team(f.to) || this.league2.team(f.to);
    const c = to.players.find(x => x.id === choice);
    if (!c || !f.compCands.includes(choice)) return null;
    if (this.rosterFull) return { ok: false, text: '支配下がいっぱいです' };
    to.players = to.players.filter(x => x !== c);
    const fill = c.isPitcher ? PlayerFactory.pitcher({ level: 52, role: c.role, age: 21 }) : PlayerFactory.batter({ level: 52, position: c.position, age: 21 });
    fill.service = 0;
    to.players.push(fill);
    c.starter = false;
    this.team.players.push(c);
    f.comp = c.id;
    this.addNews('move', `人的補償で${c.name}（${to.short}）を獲得`);
    return { ok: true, text: `人的補償で${c.name}を獲得しました` };
  }
  // 他球団のFA選手の獲得。level: 0=希望どおり 1=2割上乗せ 2=4割上乗せ
  faInChance(f, level) {
    const rank = this.league.rankOf(this.team.id);
    return Util.clamp(0.3 + level * 0.18 + (rank <= 2 ? 0.1 : rank >= 5 ? -0.08 : 0) + (this.finance.park.capacity >= 32000 ? 0.06 : 0) + (this.japanTitles ? 0.05 : 0), 0.05, 0.9);
  }
  faInCost(f, level) {
    const salary = Math.round(f.ask * [1, 1.2, 1.4][level] / 100) * 100;
    const bonus = Math.round(salary * 0.5 / 100) * 100;
    const comp = Math.round(f.oldSalary * FA_COMP[f.rank] / 100) * 100;   // 元の球団への補償金
    return { salary, bonus, comp, now: bonus + comp };
  }
  bidFA(id, level) {
    const f = this.off.faIn.find(x => x.id === id);
    if (!f || f.status) return null;
    const p = this.findPlayer(id), cost = this.faInCost(f, level);
    if (this.rosterFull) return { ok: false, text: `支配下が${this.rules.maxRoster}人でいっぱいです` };
    if (this.finance.funds < cost.now) return { ok: false, text: `お金が足りません（契約金と補償金で${Util.money(cost.now)}）` };
    if (!Rand.chance(this.faInChance(f, level))) {
      f.status = 'lost';
      const other = Rand.pick([...this.league.opponents, ...this.league2.teams].filter(t => t.id !== f.team));
      const from = this.ownerOf(id);
      if (from) from.players = from.players.filter(x => x !== p);
      if (f.team === 'mlb') this.off.mlb = this.off.mlb.filter(x => x !== p);
      other.players.push(p);
      this.trimCpuRoster(other, p);
      this.addNews('game', `FAの${p.name}は${other.name}を選んだ`);
      return { ok: false, text: `${p.name}は${other.name}への移籍を選びました…` };
    }
    const from = f.team === 'mlb' ? null : this.ownerOf(id);
    if (from) {
      from.players = from.players.filter(x => x !== p);
      const fill = p.isPitcher ? PlayerFactory.pitcher({ level: 55, role: p.role, age: 22 }) : PlayerFactory.batter({ level: 55, position: p.position, age: 22 });
      fill.service = 0;
      from.players.push(fill);
    } else this.off.mlb = this.off.mlb.filter(x => x !== p);
    this.finance.funds -= cost.now;
    p.salary = cost.salary; p.starter = false; p.faSeason = this.season;
    this.team.players.push(p);
    f.status = 'won';
    this.gmCount('fa');
    const fromName = from ? from.short : 'メジャー';
    this.addNews('move', `FAで${p.name}（${fromName}）を獲得！ 年俸${Util.money(cost.salary)}`);
    return { ok: true, text: `${p.name}の獲得に成功！（年俸${Util.money(cost.salary)}、契約金${Util.money(cost.bonus)}${cost.comp ? `、${fromName}へ補償金${Util.money(cost.comp)}` : ''}）` };
  }
  // FAの手続きを締める：返事をしなかった自分の選手は残留、補償を選ばなかったら金銭補償
  finishFA() {
    for (const f of this.off.faOut) {
      if (!f.status) { f.status = 'stay'; this.addNews('move', `${this.findPlayer(f.id).name}は話し合いの末に残留`); }
      if (f.status === 'left' && !f.overseas && f.rank !== 'C' && !f.comp) this.takeCompensation(f.id, 'money');
    }
  }

  // ---- ③現役ドラフト ----
  // 各球団が2人をリストに載せ、他球団のリストから欲しい選手を1人選ぶ。
  // 希望がいちばん多く集まった球団から指名し、選手を取られた球団が次に指名する。全球団が1人取って1人出す
  genyakuEligible(p) {
    return p.salary < GENYAKU_SALARY_LIMIT && !(p.draft && p.draft.startsWith(`${this.season}年`)) && p.faSeason !== this.season;
  }
  // 両リーグの12球団で行う
  makeGenyaku() {
    const lists = {};
    for (const t of [...this.league.opponents, ...this.league2.teams]) {
      lists[t.id] = t.players.filter(p => this.genyakuEligible(p)).sort((a, b) => a.value - b.value).slice(2, 8).sort(() => Math.random() - 0.5).slice(0, 2).map(p => p.id);
    }
    this.off.genyaku = { lists, myList: [], myWant: null, done: false, results: [] };
  }
  genyakuToggle(id) {
    const g = this.off.genyaku;
    if (g.done) return null;
    const p = this.team.players.find(x => x.id === id);
    if (!p || !this.genyakuEligible(p)) return '年俸5,000万円以上・今年の新人・FAで取った選手はリストに載せられません';
    if (g.myList.includes(id)) g.myList = g.myList.filter(x => x !== id);
    else if (g.myList.length >= 2) return 'リストに載せるのは2人です。先に誰かを外してください';
    else g.myList.push(id);
    return null;
  }
  runGenyaku() {
    const g = this.off.genyaku;
    if (g.done) return { ok: false, text: '' };
    if (g.myList.length !== 2) return { ok: false, text: 'リストに載せる選手を2人選んでください' };
    if (!g.myWant) return { ok: false, text: '他球団のリストから、欲しい選手を1人選んでください' };
    const me = this.team.id;
    const lists = { ...g.lists, [me]: [...g.myList] };
    const teams = Object.keys(lists);
    const team = id => this.teamById(id);
    const ownerList = pid => teams.find(t => lists[t].includes(pid));
    // 希望（他球団は、自分以外のリストでいちばん評価の高い選手）
    const wants = { [me]: g.myWant };
    for (const t of teams) if (t !== me) {
      const opts = teams.filter(x => x !== t).flatMap(x => lists[x]).map(id => this.findPlayer(id));
      wants[t] = opts.sort((a, b) => (b.value + Rand.range(-3, 3)) - (a.value + Rand.range(-3, 3)))[0].id;
    }
    const votes = Object.fromEntries(teams.map(t => [t, 0]));
    for (const t of teams) votes[ownerList(wants[t])]++;
    const picked = new Set(), lost = new Set(), taken = new Set();
    const mostVoted = () => teams.filter(t => !picked.has(t)).sort((a, b) => votes[b] - votes[a] || Math.random() - 0.5)[0];
    let cur = mostVoted();
    const results = [];
    while (picked.size < teams.length) {
      if (!cur || picked.has(cur)) cur = mostVoted();
      // まだ選手を取られていない球団のリストから選ぶ。
      // ただし「最後に残った1球団が、自分のリストからしか選べない」行き止まりになる選び方は避ける（全球団が1人出して1人取るため）
      const deadEnd = id => {
        const pickers = teams.filter(t => !picked.has(t) && t !== cur);
        const donors = teams.filter(t => !lost.has(t) && t !== ownerList(id));
        return pickers.length === 1 && donors.length === 1 && pickers[0] === donors[0];
      };
      let pool = teams.filter(t => t !== cur && !lost.has(t)).flatMap(t => lists[t]).filter(id => !taken.has(id) && !deadEnd(id));
      if (!pool.length) pool = teams.filter(t => t !== cur).flatMap(t => lists[t]).filter(id => !taken.has(id));
      let pid = pool.includes(wants[cur]) ? wants[cur] : pool.map(id => this.findPlayer(id)).sort((a, b) => b.value - a.value)[0].id;
      const from = ownerList(pid);
      const pl = this.findPlayer(pid);
      taken.add(pid); picked.add(cur); lost.add(from);
      results.push({ to: cur, from, pid, name: pl.name, pos: pl.isPitcher ? `投手（${pl.role}）` : pl.position, overall: pl.overall, wanted: pid === wants[cur] });
      cur = from;
    }
    // 移籍を反映
    for (const r of results) {
      const from = team(r.from), to = team(r.to), pl = this.findPlayer(r.pid);
      from.players = from.players.filter(x => x !== pl);
      pl.starter = false;
      to.players.push(pl);
    }
    // 相手球団の人数をそろえる（投手5・野手9）
    for (const t of [...this.league.opponents, ...this.league2.teams]) {
      const fix = (isP, n) => {
        let list = t.players.filter(p => p.isPitcher === isP);
        while (list.length > n) { const out = list.sort((a, b) => a.value - b.value)[0]; t.players = t.players.filter(x => x !== out); list = list.filter(x => x !== out); }
        while (list.length < n) { const np = isP ? PlayerFactory.pitcher({ level: 55, role: '中継ぎ', age: 22 }) : PlayerFactory.batter({ level: 55, age: 22 }); np.service = 0; t.players.push(np); list.push(np); }
      };
      fix(true, 5); fix(false, 9);
    }
    g.results = results.map(r => ({ ...r, toName: team(r.to).name, fromName: team(r.from).name }));
    g.done = true;
    const mine = results.find(r => r.to === me), out = results.find(r => r.from === me);
    const gotText = mine ? `${mine.name}を獲得` : '獲得なし';
    const outText = out ? `${out.name}が${team(out.to).name}へ移籍` : '放出なし';
    this.addNews('move', `現役ドラフト：${gotText}、${outText}`);
    return { ok: true, text: `現役ドラフト終了！ ${gotText}し、${outText}しました` };
  }

  // ---- シーズン中：他球団からのトレード申し込み ----
  maybeTradeOffer() {
    if (this.tradeOffer || this.isSeasonOver || !Rand.chance(0.2)) return;
    const t = Rand.pick(this.league.opponents);
    // 相手のいちばん弱いポジションを、自分のチームの選手で埋めたい
    const depth = {};
    for (const [g, n] of Object.entries(POS_DEPTH)) {
      const v = t.players.filter(p => posGroup(p) === g).map(p => p.overall).sort((a, b) => b - a).slice(0, n);
      depth[g] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    }
    // 弱い順にポジションを見て、そこにいるこちらの選手を1人ねらう（その位置に2人以上いれば、いちばんの主力は外す）
    let want = null, weak = null;
    for (const g of Object.keys(depth).sort((a, b) => depth[a] - depth[b])) {
      const cands = this.team.players.filter(p => posGroup(p) === g && p.overall >= 50 && p.available).sort((a, b) => b.value - a.value);
      const pool = cands.length >= 2 ? cands.slice(1, 5) : cands;
      if (pool.length) { want = Rand.pick(pool); weak = g; break; }
    }
    if (!want) return;
    // 交換に出す選手：同じ投手／野手で、価値が近い選手（得なことも損なこともある）
    const give = t.players.filter(p => p.isPitcher === want.isPitcher && posGroup(p) !== weak)
      .sort((a, b) => Math.abs(a.value - want.value + Rand.range(-4, 4)) - Math.abs(b.value - want.value + Rand.range(-4, 4)))[0];
    if (!give) return;
    this.tradeOffer = { team: t.id, wantId: want.id, giveId: give.id, until: this.gameIndex + 3 };
    this.addNews('move', `${t.name}からトレードの申し込み！ ${want.name} ⇔ ${give.name}（補強タブで返事をしよう）`);
  }
  answerTradeOffer(accept) {
    const o = this.tradeOffer;
    if (!o) return null;
    this.tradeOffer = null;
    const t = this.league.team(o.team);
    const mine = this.team.players.find(p => p.id === o.wantId), theirs = t && t.players.find(p => p.id === o.giveId);
    if (!accept) { this.addNews('move', `${t.name}のトレード申し込みを断った`); return { ok: true, text: 'トレードの申し込みを断りました' }; }
    if (!mine || !theirs) return { ok: false, text: 'このトレードはもう成立できません' };
    this.team.players = this.team.players.map(p => (p === mine ? theirs : p));
    t.players = t.players.map(p => (p === theirs ? mine : p));
    theirs.starter = mine.starter; mine.starter = false;
    if (theirs.isPitcher) { const r1 = theirs.role; theirs.role = mine.role; mine.role = r1; }
    this.gmCount('trade');
    this.addNews('move', `トレード成立：${mine.name} ⇔ ${theirs.name}（${t.short}）`);
    return { ok: true, text: `トレード成立！ ${theirs.name}が加入しました` };
  }

  // ---- 育成選手 ----
  promote(id) {
    const p = this.team.farm.find(x => x.id === id);
    if (!p) return { ok: false, text: '選手が見つかりません' };
    if (this.rosterFull) return { ok: false, text: `支配下が${this.rules.maxRoster}人でいっぱいです` };
    this.team.farm = this.team.farm.filter(x => x !== p);
    p.salary = Math.max(p.salary, PROMOTED_SALARY);
    this.team.players.push(p);
    this.addNews('grow', `育成の${p.name}を支配下登録！ 背番号も2ケタに`);
    return { ok: true, text: `${p.name}を支配下登録しました。試合に出られるようになりました` };
  }

  // ---- 補強 ----
  signingFee(p) { return Math.round(p.salary * 0.6 * STRATEGIES[this.strategy].faFee / 100) * 100; }
  signFA(id) {
    const p = this.fa.find(x => x.id === id);
    if (!p) return { ok: false, text: 'その選手はもういません' };
    const fee = this.signingFee(p);
    if (this.team.players.length >= this.rules.maxRoster) return { ok: false, text: `登録は${this.rules.maxRoster}人までです。自由契約で枠を空けよう` };
    if (this.finance.funds < fee) return { ok: false, text: '契約金が足りません' };
    this.finance.funds -= fee;
    this.fa = this.fa.filter(x => x !== p);
    p.starter = false;
    this.team.players.push(p);
    this.gmCount('fa');
    this.addNews('move', `FAで${p.name}（${p.isPitcher ? p.role : p.position}）を獲得！`);
    return { ok: true, text: `${p.name}と契約しました！${p.isPitcher ? '' : ' 編成画面でスタメンに入れよう'}` };
  }
  canRelease(p) {
    const left = this.team.players.filter(x => x !== p);
    if (left.filter(x => !x.isPitcher).length < 9) return '野手が9人を下回ります';
    if (left.filter(x => x.isPitcher).length < 4) return '投手が4人を下回ります';
    return null;
  }
  release(id) {
    const f = this.team.farm.find(x => x.id === id);
    if (f) {
      this.team.farm = this.team.farm.filter(x => x !== f);
      this.addNews('move', `育成の${f.name}を自由契約にした`);
      return { ok: true, text: `${f.name}を自由契約にしました` };
    }
    const p = this.team.players.find(x => x.id === id);
    const why = p && this.canRelease(p);
    if (!p || why) return { ok: false, text: why || '選手が見つかりません' };
    this.team.players = this.team.players.filter(x => x !== p);
    this.addNews('move', `${p.name}を自由契約にした`);
    return { ok: true, text: `${p.name}を自由契約にしました（年俸の支払いがなくなります）` };
  }

  // トレード：相手が受け取る価値と出す価値を比べる
  tradeReaction(mine, theirs) {
    if (!mine || !theirs) return null;
    if (mine.isPitcher !== theirs.isPitcher) return { level: 'bad', text: '「投手は投手、野手は野手と交換したい」', p: 0 };
    const diff = mine.value - theirs.value;
    if (diff >= 1) return { level: 'good', text: '「いい話ですね。ぜひ」', p: 1 };
    if (diff >= -4) return { level: 'mid', text: '「うーん、迷いますね…」', p: 0.4 };
    return { level: 'bad', text: '「その条件では無理です」', p: 0 };
  }
  proposeTrade(myId, theirId) {
    if (this.tradesLeft <= 0) return { ok: false, text: '今シーズンのトレード交渉は終わりです' };
    const mine = this.team.players.find(p => p.id === myId);
    const owner = this.league.opponents.find(t => t.players.some(p => p.id === theirId));
    const theirs = owner && owner.players.find(p => p.id === theirId);
    const r = this.tradeReaction(mine, theirs);
    if (!r) return { ok: false, text: '選手を選んでください' };
    if (!r.p) return { ok: false, text: `${owner.short}：${r.text}` };
    this.tradesLeft--;
    if (!Rand.chance(r.p)) return { ok: false, text: `${owner.short}：「やっぱりやめておきます」交渉は不成立（残り${this.tradesLeft}回）` };
    this.team.players = this.team.players.map(p => (p === mine ? theirs : p));
    owner.players = owner.players.map(p => (p === theirs ? mine : p));
    theirs.starter = mine.starter;
    mine.starter = false;
    if (theirs.isPitcher) { const r1 = theirs.role; theirs.role = mine.role; mine.role = r1; }
    this.gmCount('trade');
    this.addNews('move', `トレード成立：${mine.name} ⇔ ${theirs.name}（${owner.short}）`);
    return { ok: true, text: `トレード成立！ ${theirs.name}が加入しました（残り${this.tradesLeft}回）` };
  }

  // ---- 本拠地の移転 ----
  // 移転したらどうなるか（1試合の見込み）
  previewStadium(id) {
    const f = this.finance, prev = f.stadiumId;
    f.stadiumId = id;
    const b = f.breakdown({ payroll: this.costPayroll, gamesPerSeason: this.rules.gamesPerSeason });
    f.stadiumId = prev;
    return b;
  }
  stadiumLock(def) {
    if (def.id === this.finance.stadiumId) return '今の本拠地です';
    const n = def.need || {};
    const why = [];
    if (n.fans && this.finance.fans < n.fans) why.push(`ファン${n.fans.toLocaleString()}人以上（今 ${this.finance.fans.toLocaleString()}人）`);
    if (n.owner && this.ownerRating < n.owner) why.push(`オーナー評価${n.owner}%以上（今 ${this.ownerRating}%）`);
    if (n.titles && this.titles < n.titles) why.push(`リーグ優勝${n.titles}回以上（今 ${this.titles}回）`);
    if (why.length) return `条件：${why.join('・')}`;
    if (this.finance.funds < def.cost) return `移転費が足りません（${Util.money(def.cost)}）`;
    return null;
  }
  moveStadium(id, name) {
    const def = STADIUMS.find(x => x.id === id);
    if (!def) return { ok: false, text: '球場が見つかりません' };
    const lock = this.stadiumLock(def);
    if (lock) return { ok: false, text: lock };
    name = (name || '').trim() || `${this.team.short}${def.suffix}`;
    const before = this.finance.park;
    const up = def.capacity > before.capacity;
    this.finance.funds -= def.cost;
    this.finance.stadiumId = def.id;
    this.profile.stadium = name;
    // ネーミングライツ契約中なら、新しい球場にも企業の名前がつく
    if (this.naming) { this.naming.original = name; name = this.namingName(this.naming.brand); this.profile.stadium = name; }
    // 大きな球場へ移ると話題になり、小さな球場へ移るとファンもオーナーもがっかりする
    if (up) {
      this.finance.fans += Math.round(this.finance.fans * 0.08);
      this.ownerRating = Util.clamp(this.ownerRating + 5, 0, 100);
    } else {
      this.finance.fans = Math.max(3000, Math.round(this.finance.fans * 0.9));
      this.ownerRating = Util.clamp(this.ownerRating - 5, 0, 100);
    }
    this.stadiumHistory.push({ season: this.season, name, type: def.type });
    this.addNews('move', `本拠地を「${name}」（${def.type}）に移した！`);
    return { ok: true, text: up ? `${name}に移転！ 新球場ブームでファンが増え、オーナーも喜んでいる（ファン+8%・オーナー評価+5%）`
      : `${name}に移転した。節約にはなるが、ファンとオーナーは少しがっかり（ファン-10%・オーナー評価-5%）` };
  }

  // ---- 首脳陣（監督・コーチ） ----
  get staffPayroll() { return Object.values(this.staff).reduce((sum, st) => sum + (st ? st.salary : 0), 0); }
  get totalPayroll() { return this.team.payroll + this.staffPayroll; }   // 選手＋首脳陣の年俸
  // 球団が実際に払う年俸（難易度に応じて、一部を親会社が負担する）
  get costPayroll() { return Math.round(this.totalPayroll * (this.diff.payroll ?? 1)); }
  staffFireFee(st) { return Math.round(st.salary * st.years * 0.5 / 100) * 100; }   // 残り契約の半分
  // 首脳陣と最新設備の効果（試合での上乗せと、成長の倍率）
  get staffEffect() {
    const L = r => staffLevel(this.staff[r]);
    const m = this.staff.manager, fit = m && m.style === this.strategy ? 1 : 0;
    const ai = this.equipment.includes('ai') ? 1 : 0;
    const r1 = x => Math.round(x * 10) / 10;
    return {
      bat: r1(L('batting') + L('manager') * 0.5 + fit + ai),
      pitch: r1(L('pitching') + L('manager') * 0.5 + fit + ai),
      def: r1(L('fielding') * 2),
      run: this.staff.fielding && this.staff.fielding.ability >= 70 ? 1 : 0,
      fit,
      growBat: Math.max(0.6, 1 + L('batting') * 0.12) * (this.equipment.includes('vr') ? 1.2 : 1),
      growPitch: Math.max(0.6, 1 + L('pitching') * 0.12) * (this.equipment.includes('tracking') ? 1.2 : 1),
      growYoung: Math.max(0.6, 1 + L('farm') * 0.12),
    };
  }
  // 試合で使う自チームの戦い方（方針＋首脳陣＋設備）
  get myStyle() {
    const st = STRATEGIES[this.strategy].game, e = this.staffEffect;
    const song = this.flags && this.flags.songBoost ? 2 : 0;   // 新しい応援歌
    return { bat: st.bat + e.bat + song, pitch: st.pitch + e.pitch, run: st.run || e.run, def: e.def };
  }
  fireStaff(role, { silent = false } = {}) {
    const st = this.staff[role];
    if (!st) return { ok: false, text: 'その役職は空席です' };
    const fee = this.staffFireFee(st);
    this.finance.funds -= fee;
    this.staff[role] = null;
    this.gmCount('fire');
    let extra = '';
    // シーズン中に監督を代えると、オーナーと選手が反応する
    if (role === 'manager' && this.goal && !this.isSeasonOver && this.gameIndex > 0) {
      const r = this.record, pct = r.w + r.l ? r.w / (r.w + r.l) : 0.5;
      const d = pct < 0.45 ? 4 : pct >= 0.55 ? -5 : 0;
      addOwner(this, d);
      const shock = Rand.pick([1, -1]);
      this.team.players.forEach(p => { if (Rand.chance(0.5)) p.changeCondition(shock); });
      extra = `${d > 0 ? 'オーナー「よく決断した」（評価+4）。' : d < 0 ? 'オーナー「勝っているのに、なぜだ？」（評価-5）。' : ''}選手たちに${shock > 0 ? '「やるしかない」と火がついた。' : '動揺が広がった…。'}`;
    }
    const text = `${STAFF_ROLES[role].name}の${st.name}を解任した${fee ? `（違約金 ${Util.money(fee)}）` : ''}。${extra}`;
    if (!silent) this.addNews('move', text);
    return { ok: true, text };
  }
  staffHireCost(c) {
    const fee = Math.round(c.salary * 0.3 / 100) * 100;   // 就任の支度金
    const cur = this.staff[c.role];
    return { fee, fireFee: cur ? this.staffFireFee(cur) : 0 };
  }
  hireStaff(id) {
    const c = this.staffMarket.find(x => x.id === id);
    if (!c) return { ok: false, text: 'その候補はもういません' };
    const { fee, fireFee } = this.staffHireCost(c);
    if (this.finance.funds < fee + fireFee) return { ok: false, text: '資金が足りません' };
    const pre = this.staff[c.role] ? this.fireStaff(c.role, { silent: true }).text : '';
    this.finance.funds -= fee;
    this.staff[c.role] = c;
    this.staffMarket = this.staffMarket.filter(x => x !== c);
    this.gmCount('hire');
    const text = `${pre}${c.name}が${STAFF_ROLES[c.role].name}に就任！（${c.years}年契約・年俸${Util.money(c.salary)}・支度金${Util.money(fee)}）`;
    this.addNews('move', text);
    return { ok: true, text };
  }
  extendStaff(role) {
    const st = this.staff[role];
    if (!st) return { ok: false, text: 'その役職は空席です' };
    if (st.years >= 4) return { ok: false, text: '契約は最長4年までです' };
    st.years++;
    st.salary = Math.round(st.salary * 1.1 / 100) * 100;
    const text = `${STAFF_ROLES[role].name}の${st.name}と契約を1年延長（残り${st.years}年・年俸${Util.money(st.salary)}）`;
    this.addNews('move', text);
    return { ok: true, text };
  }
  // オフ：契約が切れた首脳陣は退団する
  renewStaff() {
    for (const [role, st] of Object.entries(this.staff)) {
      if (!st) continue;
      st.age++;
      if (--st.years <= 0) {
        this.staff[role] = null;
        this.addNews('move', `${STAFF_ROLES[role].name}の${st.name}が契約満了で退団。補強タブで後任を選ぼう`);
      }
    }
  }

  // ---- ネーミングライツ ----
  namingName(brand) { return `${brand}${NAMING_WORD[this.finance.stadiumId] || 'スタジアム'}${this.team.short}`; }
  makeNamingOffers() {
    const f = this.finance;
    return Rand.shuffle(NAMING_BRANDS).slice(0, 3).map(b => {
      const base = f.capacity / 1000 * Rand.int(180, 300) * Math.sqrt(Math.max(f.fans, 8000) / 20000);
      return { company: b.company, brand: b.brand, odd: !!b.odd, years: Rand.int(2, 5),
        amount: Math.round(base * (b.odd ? 1.4 : 1) / 100) * 100 };
    });
  }
  signNaming(i) {
    const o = (this.namingOffers || [])[i];
    if (!o) return { ok: false, text: 'その話はもうありません' };
    if (this.naming) return { ok: false, text: 'すでにネーミングライツを契約中です' };
    const name = this.namingName(o.brand);
    this.finance.sponsors.push({ name: o.company, tier: 'ネーミングライツ', amount: o.amount, years: o.years, naming: true });
    this.naming = { company: o.company, brand: o.brand, original: this.profile.stadium };
    this.profile.stadium = name;
    this.namingOffers = [];
    this.gmCount('sponsor');
    let extra = '';
    if (o.odd) { this.finance.fans = Math.max(3000, Math.round(this.finance.fans * 0.97)); extra = '「えっ、この名前！？」とファンはびっくり（ファン−3%）。でも話題にはなった。'; }
    else { addOwner(this, 2); extra = 'オーナー「いい契約だ」（オーナー評価+2）。'; }
    this.addNews('move', `ネーミングライツ契約：球場名が「${name}」になった（年${Util.money(o.amount)}×${o.years}年）`);
    return { ok: true, text: `契約成立！ 球場名が「${name}」になりました（年${Util.money(o.amount)}×${o.years}年）。${extra}` };
  }
  cancelNaming() {
    if (!this.naming) return { ok: false, text: '' };
    const sp = this.finance.sponsors.find(x => x.name === this.naming.company && x.naming);
    const fee = sp ? Math.round(sp.amount * sp.years * 0.3 / 100) * 100 : 0;
    this.finance.funds -= fee;
    this.finance.sponsors = this.finance.sponsors.filter(x => x !== sp);
    this.profile.stadium = this.naming.original;
    this.naming = null;
    this.addNews('move', `ネーミングライツを解約した（違約金 ${Util.money(fee)}）。球場名が「${this.profile.stadium}」に戻った`);
    return { ok: true, text: `解約しました（違約金 ${Util.money(fee)}）。球場名は「${this.profile.stadium}」に戻りました` };
  }

  // ---- 資金繰り（借入・返済・見通し） ----
  get loanRate() { return LOAN_RATE * (this.finance.hasPerk('loan') ? 0.5 : 1); }   // メインバンクのスポンサーがいると半分
  borrow(amount) {
    const room = LOAN_MAX - (this.loan || 0);
    if (room <= 0) return { ok: false, text: `借入は${Util.money(LOAN_MAX)}までです` };
    if (this.ownerRating < 20) return { ok: false, text: '銀行「オーナーの信頼が低い球団には貸せません」（オーナー評価20以上が必要）' };
    const a = Math.min(amount, room);
    this.loan = (this.loan || 0) + a;
    this.finance.funds += a;
    this.addNews('move', `銀行から${Util.money(a)}を借りた（借入残高 ${Util.money(this.loan)}）`);
    return { ok: true, text: `${Util.money(a)}を借りました。利息は1試合ごとに${(this.loanRate * 100).toFixed(2)}%（今は1試合 ${Util.money(Math.round(this.loan * this.loanRate))}）` };
  }
  repay(amount) {
    if (!this.loan) return { ok: false, text: '借入はありません' };
    const a = Math.min(amount, this.loan);
    if (this.finance.funds < a) return { ok: false, text: '返すお金が足りません' };
    this.loan -= a;
    this.finance.funds -= a;
    this.addNews('move', `銀行に${Util.money(a)}を返した（残り ${Util.money(this.loan)}）`);
    return { ok: true, text: this.loan ? `${Util.money(a)}を返しました（残り ${Util.money(this.loan)}）` : '借金を完済しました！' };
  }
  // 今シーズンの資金の見通し（このままのペースなら）
  get cashForecast() {
    const f = this.finance, R = this.rules;
    const b = f.breakdown({ payroll: this.costPayroll, gamesPerSeason: R.gamesPerSeason });
    const interest = this.loan > 0 ? Math.round(this.loan * this.loanRate) : 0;
    const perGame = b.net - interest;
    const left = Math.max(0, R.gamesPerSeason - this.gameIndex);
    // 見込みは「今の条件で毎試合同じ収支」として計算する（雨・勝敗・出来事は入れない）
    const seasonEnd = f.funds + perGame * left;
    const profit = (seasonEnd - (this.loan || 0)) - (this.seasonStart.funds - (this.seasonStart.loan || 0));
    const tax = profit > 0 ? Math.round(profit * this.diff.tax / 100) * 100 : 0;
    const afterOff = seasonEnd - tax - this.diff.offFixed + (this.diff.support || 0);
    return { perGame, interest, left, seasonEnd, profit, tax, afterOff };
  }

  // ---- 投資 ----
  // ---- チャレンジ・今日のお題 ----
  get challengeDef() { return this.profile.challenge ? CHALLENGES[this.profile.challenge.id] : null; }
  get challengeText() { return this.challengeDef ? this.challengeDef.name : ''; }
  get challengeDone() { return this.profile.challenge ? this.profile.challenge.done || null : null; }
  get dailyText() { return this.daily ? Daily.label({ ...this.daily, team: teamDef(this.profile.pick), difficulty: this.profile.difficulty }) : ''; }
  checkChallenge() {
    const ch = this.profile.challenge, C = this.challengeDef;
    if (!C || ch.done) return null;
    const used = this.season - ch.start + 1;
    if (C.check(this)) { ch.done = 'clear'; ch.doneSeason = this.season; this.addNews('event', `チャレンジ「${C.name}」を達成！（${used}年目）`); this.addStory(`チャレンジ「${C.name}」を${used}年目で達成`); }
    else if ((C.fail && C.fail(this)) || used >= C.years) { ch.done = 'fail'; ch.doneSeason = this.season; this.addNews('bad', `チャレンジ「${C.name}」は失敗…（このまま続けて遊べる）`); }
    return ch.done;
  }
  // ---- 選手のドラマ ----
  addStory(text) { this.stories = [{ season: this.season, text }, ...(this.stories || [])].slice(0, 40); }
  // ドラフトで取った選手が主力（総合75以上）に育ったら記録する
  checkStories() {
    for (const p of this.team.players) if (p.story && !p.story.star && p.overall >= 75) {
      p.story.star = this.season;
      const t = `${p.story.year}年ドラフト${p.story.label}の${p.name}が、総合${p.overall}の主力に成長！（入団時は${p.story.start}）`;
      this.addNews('grow', t); this.addStory(t); this.finance.fans += 500;
    }
  }
  retireNumber(p) {
    this.retiredNumbers = [...(this.retiredNumbers || []), { number: p.number, name: p.name, season: this.season }];
    this.addStory(`背番号${p.number}が${p.name}の永久欠番に`);
  }
  // 今季の宿敵：同じリーグでいちばん打つ他球団の打者
  pickNemesis() {
    const all = this.league.opponents.flatMap(t => t.players.filter(p => !p.isPitcher).map(p => ({ p, t })));
    const best = all.sort((a, b) => (b.p.stats.power + b.p.stats.contact) - (a.p.stats.power + a.p.stats.contact))[0];
    return best ? { id: best.p.id, name: best.p.name, team: best.t.name, color: best.t.color, won: 0, lost: 0 } : null;
  }
  get seasonMVP() {
    const sc = p => { const s = p.ss; if (!s) return -1; return p.isPitcher ? (s.outs / 3) * 0.9 - s.r * 1.2 : s.h + s.hr * 2.5 + s.rbi * 0.8; };
    const p = [...this.team.players].sort((a, b) => sc(b) - sc(a))[0];
    if (!p || sc(p) <= 0) return null;
    return { name: p.name, number: p.number, pos: p.isPitcher ? '投手' : p.position, line: ssLine(p, p.ss) };
  }
  // 引退する選手を送り出す（オフのはじめ）
  processRetirements() {
    const out = [...this.team.players, ...this.team.farm].filter(p => p.retiring || p.age >= 40);
    if (!out.length) return;
    this.team.players = this.team.players.filter(p => !out.includes(p));
    this.team.farm = this.team.farm.filter(p => !out.includes(p));
    out.forEach(p => {
      const t = `${p.name}が現役を引退${p.retiring === 'ceremony' ? '。引退試合で有終の美を飾った' : ''}${careerText(p)}`;
      this.addNews('move', t); this.addStory(t);
    });
  }
  // 永久欠番の背番号をつけている選手は、空いている番号に変える
  fixNumbers() {
    const ret = new Set((this.retiredNumbers || []).map(r => r.number));
    if (!ret.size) return;
    const all = [...this.team.players, ...this.team.farm];
    const used = new Set(all.map(p => p.number));
    all.filter(p => ret.has(p.number) && !p.retiring).forEach(p => {
      let n = p.isPitcher ? 11 : 0; while (used.has(n) || ret.has(n)) n++;
      used.add(n); p.number = n;
    });
  }
  // 新しいユニフォームを発表する（free：出来事などでお金がかからないとき）
  setUniform(u, { free = false, hype = UNIFORM_HYPE, keepColor = false, news = '新ユニフォームを発表！' } = {}) {
    if (!free && this.finance.funds < UNIFORM_COST) return { ok: false, text: `発表には${Util.money(UNIFORM_COST)}かかります` };
    if (!free) this.finance.funds -= UNIFORM_COST;
    this.profile.uniform = { ...u, text: String(u.text || chestText(this.profile)).slice(0, 10) };
    if (!keepColor) this.profile.color = this.team.color = u.main;
    this.finance.uniformHype = hype;
    this.finance.fans += 800;
    this.addNews('move', news);
    return { ok: true, text: `新ユニフォームを発表！ ファン+800人。これから${hype}試合はグッズが1人+300円売れる。` };
  }
  get itnavPartner() { return this.finance.hasPerk('equip'); }
  equipCost(k, sale = false) { return Math.round(EQUIPMENT[k].cost * (sale ? 0.8 : 1) * (this.itnavPartner ? 0.8 : 1) / 100) * 100; }
  // 投資できない理由（なければ null）
  investLock(key) {
    const lv = this.facilities[key];
    if (lv >= FACILITY_MAX) return 'もう最大レベルです';
    if (this.building) return `${FACILITIES[this.building.key].name}の工事中です（工事は1つずつ）`;
    const needOwner = FACILITY_OWNER[lv + 1];
    if (needOwner && this.ownerRating < needOwner) return `Lv.${lv + 1}にはオーナーの承認がいる（オーナー評価${needOwner}以上）`;
    if (this.finance.funds < FACILITIES[key].cost(lv)) return '資金が足りません';
    return null;
  }
  invest(key) {
    const lock = this.investLock(key);
    if (lock) return { ok: false, text: lock };
    const lv = this.facilities[key], cost = FACILITIES[key].cost(lv);
    this.finance.funds -= cost;
    this.building = { key, left: FACILITY_BUILD };
    this.gmCount('invest');
    this.addNews('move', `${FACILITIES[key].name}のレベル${lv + 1}への工事を始めた（${Util.money(cost)}）`);
    return { ok: true, text: `${FACILITIES[key].name}の工事を始めました。${FACILITY_BUILD}試合後に完成してレベル${lv + 1}になります` };
  }
  // 工事を1試合分すすめる（all なら一気に完成）
  progressBuilding(all = false) {
    const b = this.building;
    if (!b) return null;
    b.left = all ? 0 : b.left - 1;
    if (b.left > 0) return null;
    this.facilities[b.key]++;
    this.building = null;
    const text = `${FACILITIES[b.key].name}が完成！ レベル${this.facilities[b.key]}に`;
    this.addNews('grow', text);
    return text;
  }

  // ---- 編成 ----
  // 打順を1つ上げる／下げる（dir: -1 で上、+1 で下）
  moveBatting(id, dir) {
    const order = this.team.lineup.filter(p => this.team.players.includes(p)).map(p => p.id);
    const i = order.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    this.team.battingOrder = order;
  }
  autoBatting() { this.team.autoLineup(); }
  // ---- 出場選手登録（1軍）とベンチ入り ----
  get activeCount() { return this.team.players.filter(p => p.active).length; }
  // 1軍の人数が上限を超えたら、控えの力の弱い選手から2軍へ（新しく加わった選手など）
  fixActive() {
    this.fixNumbers();
    const max = this.rules.maxActive;
    const act = this.team.players.filter(p => p.active);
    if (act.length <= max) return;
    const prio = p => (p.starter ? 1000 : 0) + p.overall;
    const out = [...act].sort((a, b) => prio(a) - prio(b)).slice(0, act.length - max);
    out.forEach(p => { p.active = false; p.starter = false; p.benchOut = false; });
    this.addNews('move', `1軍の登録枠（${max}人）がいっぱいのため、${out.map(p => p.name).join('・')}を2軍に回した`);
  }
  registerLock(p) {
    if (p.active) return null;
    if (this.activeCount >= this.rules.maxActive) return `1軍は${this.rules.maxActive}人までです。先に誰かを抹消してください`;
    if (p.down > 0) return `抹消から${this.rules.reRegister}試合は再登録できません（あと${p.down}試合）`;
    return null;
  }
  unregisterLock(p) {
    if (!p.active) return null;
    const left = this.team.players.filter(x => x.active && x !== p);
    if (left.filter(x => !x.isPitcher).length < 9) return '1軍の野手が9人を下回ります';
    if (left.filter(x => x.isPitcher).length < 5) return '1軍の投手が5人を下回ります';
    return null;
  }
  toggleActive(id) {
    const p = this.team.players.find(x => x.id === id);
    if (!p) return { ok: false, text: '' };
    const lock = p.active ? this.unregisterLock(p) : this.registerLock(p);
    if (lock) return { ok: false, text: lock };
    if (p.active) {
      p.active = false; p.starter = false; p.benchOut = false;
      p.down = this.isSeasonOver ? 0 : this.rules.reRegister;
      this.addNews('move', `${p.name}の出場選手登録を抹消（2軍で調整）`);
      return { ok: true, text: `${p.name}を登録抹消しました。2軍で調整します${p.down ? `（${p.down}試合は再登録できません）` : ''}` };
    }
    p.active = true;
    this.addNews('move', `${p.name}を出場選手登録（1軍昇格）`);
    return { ok: true, text: `${p.name}を1軍に登録しました` };
  }
  toggleBench(id) {
    const p = this.team.players.find(x => x.id === id && x.active);
    if (!p) return { ok: false, text: '' };
    p.benchOut = !p.benchOut;
    if (p.benchOut) p.starter = false;
    return { ok: true, text: p.benchOut ? `${p.name}をベンチ外にしました` : `${p.name}をベンチに入れました` };
  }
  toggleStarter(id) {
    const p = this.team.batters.find(x => x.id === id);
    if (!p) return null;
    if (!p.starter && !p.active) return '2軍の選手はスタメンにできません。先に1軍に登録してください';
    if (!p.starter && p.benchOut) p.benchOut = false;
    if (!p.starter && this.team.batters.filter(x => x.starter).length >= 9) return 'スタメンは9人までです。先に誰かを外してください';
    if (!p.starter && !p.available) return 'ケガをしている選手はスタメンにできません';
    p.starter = !p.starter;
    return null;
  }
  setRole(id, role) {
    const p = this.team.pitchers.find(x => x.id === id);
    if (!p) return;
    if (role === '抑え') this.team.pitchers.forEach(x => { if (x.role === '抑え') x.role = '中継ぎ'; });
    p.role = role;
  }
  // 守備位置のコンバート。新しい位置にはしばらく不慣れ（守備力マイナス）で、試合と練習で慣れていく
  static CONVERT_POS = ['捕手', '一塁手', '二塁手', '三塁手', '遊撃手', '左翼手', '中堅手', '右翼手', '外野手', '指名打者'];
  convertPosition(id, pos) {
    const p = [...this.team.batters, ...this.team.farm.filter(x => !x.isPitcher)].find(x => x.id === id);
    if (!p || !GameState.CONVERT_POS.includes(pos) || p.position === pos) return { ok: false, text: '' };
    const from = p.position;
    // 元の位置に戻すなら不慣れはなし。それ以外は「本職外で守ったときのマイナス」から慣れていく
    const conv = pos === p.formerPos || pos === '指名打者' ? 0 : isNatural(p, pos) ? 0 : offPositionPenalty({ position: from }, pos);
    p.formerPos = from;
    p.position = pos;
    p.conv = conv;
    const text = `${p.name}を${from}から${pos}にコンバート${conv ? `（はじめは不慣れで守備力 -${conv}。試合と練習で慣れていく）` : ''}`;
    this.addNews('move', text);
    return { ok: true, text };
  }
}

// ---------- 画面描画 ----------
const $ = id => document.getElementById(id);
const E = Util.esc;
// チケット料金のスライダー：前半で1,000〜6,000円（100円きざみ）、後半で6,000〜100,000円（1,000円きざみ）
const TICKET_MIN = 1000, TICKET_MAX = 100000;
const ticketFromPos = v => (v <= 500 ? 1000 + Math.round(v / 10) * 100 : 6000 + Math.round((v - 500) / 500 * 94) * 1000);
const ticketToPos = p => (p <= 6000 ? Math.round((p - 1000) / 10) : 500 + Math.round((p - 6000) / 94000 * 500));
const capText = n => (n != null ? `/${n}人` : '人（上限なし）');   // 「5/30人」や「5人（上限なし）」

const UI = {
  rosterFilter: 'all',
  rosterSort: 'number',
  trade: { mine: '', theirs: '' },
  marketMsg: null,
  officeMsg: null,
  armed: null,                           // 自由契約・セーブ削除の「もう一度押して確定」状態
  draftSel: null,                        // ドラフトで選んでいる候補
  draftFilter: 'all',
  draftSort: 'fit',
  salesMsg: null,
  offMsg: null,
  planGoal: null,                        // 開幕前に選んでいる目標・方針
  planStrategy: null,
  parkSel: null,                         // 移転先として選んでいる球場
  draftMsg: null,

  // はじめてのガイド（1年目だけ。profile.tut：進んだ手順、-1 で終わり）
  renderTutorial() {
    let box = $('tutorial');
    const tut = game && game.profile.tut;
    if (!game || tut == null || tut < 0 || !$('start').hidden) { if (box) box.hidden = true; document.querySelectorAll('.tut-target').forEach(e => e.classList.remove('tut-target')); return; }
    let i = tut;
    while (i < TUTORIAL.length && TUTORIAL[i].done(game)) i++;
    game.profile.tut = i;
    if (i >= TUTORIAL.length) { game.profile.tut = -1; return this.renderTutorial(); }
    const st = TUTORIAL[i];
    if (!box) { box = document.createElement('div'); box.id = 'tutorial'; box.className = 'tutorial'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    box.hidden = false;
    box.innerHTML = `<div class="tut-step">ガイド ${i + 1}/${TUTORIAL.length}</div><b>${E(st.title)}</b><p>${E(st.text)}</p>
      <div class="tut-actions">${st.last ? '<button class="btn-sm go" data-act="tutEnd">はじめる！</button>' : '<button class="btn-sm" data-act="tutSkip">ガイドを閉じる</button>'}</div>`;
    document.querySelectorAll('.tut-target').forEach(e => e.classList.remove('tut-target'));
    const t = st.target && document.querySelector(st.target);
    if (t && !t.closest('[hidden]')) {
      t.classList.add('tut-target');
      if (this.tutShown !== i) setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);   // 新しい手順になったら、光らせた場所を見せる
    }
    this.tutShown = i;
  },
  renderAll() {
    if (!game) return;
    Save.write(game);                    // 画面が変わるたびに自動セーブ
    this.renderHeader();
    this.renderDashboard();
    this.renderRoster();
    this.renderMarket();
    this.renderGame();
    this.renderOffice();
    this.renderTutorial();
  },
  // セーブを読み込んだ直後など、開くべき画面があれば開く
  resume() {
    this.renderAll();
    Tabs.show(Tabs.current || 'dashboard');
    if (game.isFired) this.showFired();
    else if (game.seasonSummary && !game.draft && !game.off) this.showResult();
  },

  renderHeader() {
    const s = game;
    $('clubMark').textContent = s.team.name[0];
    $('clubName').textContent = s.team.name;
    $('clubMark').style.boxShadow = `inset 0 0 0 3px ${s.team.color}`;
    const when = s.draft ? 'ドラフト会議' : s.off ? 'オフシーズン' : s.post && !s.seasonSummary ? 'ポストシーズン' : s.isSeasonOver ? '全日程終了' : `第${s.gameIndex + 1}戦`;
    $('clubSub').textContent = `${s.season}年 ／ ${when} ／ GM ${s.profile.gm}`;
    $('topFunds').textContent = Util.money(s.finance.funds);
    $('topFunds').classList.toggle('bad', s.finance.funds < 0);
    $('eventDot').hidden = !s.pendingEvent;
    $('tradeDot').hidden = !s.tradeOffer;
  },

  // ① ホーム
  renderDashboard() {
    if (game.draft) { $('view-dashboard').innerHTML = this.draftHTML(); return; }
    if (game.off) { $('view-dashboard').innerHTML = this.offHTML(); return; }
    const s = game, f = s.finance, g = s.nextGame, r = s.record;
    const b = f.breakdown({ payroll: s.costPayroll, gamesPerSeason: s.rules.gamesPerSeason });
    let html = '';

    if (f.funds < 0 && !s.isFired) {
      html += `<div class="alert">資金がマイナスです！ シーズン中の解任はないが、来季の開幕前にマイナスのまま（銀行からも借りられない）だと解任される。チケット料金・年俸・スポンサーを見直そう。</div>`;
    }

    // 開幕前：目標と方針を決める
    if (s.needsPlan) html += this.planHTML();

    // 出来事（試合の前に答える）。方針を決めてから出す
    const ev = s.needsPlan ? null : s.pendingEvent;
    if (ev) {
      html += `<div class="event-card">
        <div class="eyebrow">GMの決断　試合の前に答えてください</div>
        <div class="event-q">${E(ev.def.text(s, ev.data))}</div>
        <div class="choices">${ev.def.choices.map((c, i) => {
          if (c.hide && c.hide(s, ev.data)) return '';   // 状況によって出さない選択肢
          const ok = !c.ok || c.ok(s, ev.data);
          const desc = evText(c.desc, s, ev.data);
          return `<button class="choice" data-act="choose" data-i="${i}" ${ok ? '' : 'disabled'}><b>${E(evText(c.label, s, ev.data))}</b>${desc ? `<span>${E(desc)}</span>` : ''}${ok ? '' : '<span>（今は選べません）</span>'}</button>`;
        }).join('')}</div>
      </div>`;
    }

    // ポストシーズン中は「次の試合」の代わりにポストシーズンの画面
    const inPost = s.post && !s.seasonSummary && !s.isFired;
    if (inPost) html += this.postHTML();
    // 次の試合
    if (!inPost) html += `<div class="hero">
      <div class="hero-text">
        <div class="eyebrow">${g ? `次の試合　第${g.no}戦 / 全${s.rules.gamesPerSeason}戦` : 'シーズン終了'}</div>
        <div class="matchup">${g ? E(g.home ? `${s.team.name} vs ${g.opponent.name}` : `${g.opponent.name} vs ${s.team.name}`) : `${E(s.season)}年シーズンおつかれさまでした`}</div>
        ${g && g.home && spList(s).length ? `<div class="hero-presents">本日の冠スポンサー <b>${E(spList(s)[s.gameIndex % spList(s).length].name)}</b> presents</div>` : ''}
        <div class="hero-sub">${!g && !s.isFired ? 'シーズンが終わりました。ドラフト会議で新しい選手を指名しよう' : ''}${g ? `${g.home ? `ホーム（${E(s.profile.stadium)}・${E(s.finance.park.type)}）` : 'ビジター'}　相手の総合 ${Util.rankOf(g.opponent.overall)}（${g.opponent.overall}）／ 自チーム ${Util.rankOf(s.team.overall)}（${s.team.overall}）<br>予告先発 ${E(s.team.starterFor(s.gameIndex).name)} ${condIcon(s.team.starterFor(s.gameIndex).condition)}${s.goal ? `<br>目標「${E(GOALS[s.goal].name)}」・方針「${E(STRATEGIES[s.strategy].name)}」` : ''}` : ''}</div>
      </div>
      ${s.isSeasonOver && s.seasonSummary && !s.isFired
        ? `<button class="btn btn-play" data-act="startDraft"><span>ドラフト会議へ</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg></button>`
        : `<button class="btn btn-play" data-act="play" ${s.canPlay ? '' : 'disabled'}>
        <span>${s.needsPlan ? '先に方針を' : ev ? '先に決断を' : '試合をする'}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>
      </button>`}
    </div>`;

    // 直前の試合結果
    const L = s.lastGame;
    if (L) {
      const word = { win: '勝利！', lose: '敗戦…', draw: '引き分け' }[L.outcome];
      html += `<div class="result-home ${L.outcome}">
        <div class="result-top"><span class="result-word">${L.label ? E(L.label) : `第${L.no}戦`} ${word}</span><span class="result-score">${E(s.team.short)} ${L.myRuns} - ${L.oppRuns} ${E(L.opp)}</span></div>
        ${L.highlights.length ? `<ul>${L.highlights.map(h => `<li>${E(h)}</li>`).join('')}</ul>` : ''}
        <div class="result-grid">
          <div><small>収支</small><b>${Util.signedMoney(L.report.net)}</b></div>
          <div><small>来場者</small><b>${L.report.attendance.toLocaleString()}人${L.report.sellout ? '（満員）' : ''}</b></div>
          <div><small>ファン</small><b>${Util.signed(L.report.fansAfter - L.report.fansBefore)}人</b></div>
          <div><small>オーナー評価</small><b>${Util.signed(L.ownerDelta)}%</b></div>
        </div>
        ${L.changes.length ? `<div class="changes">${L.changes.slice(0, 10).map(c => `<span>${E(c)}</span>`).join('')}</div>` : ''}
      </div>`;
    }

    // 指標
    const gm = E(s.profile.gm);
    const ownerNote = s.ownerRating >= 80 ? `オーナー「${gm}GM、最高だ！」` : s.ownerRating >= 50 ? `オーナー「${gm}GM、期待しているぞ」` : s.ownerRating >= 30 ? `オーナー「${gm}GM、このままで大丈夫か？」` : `オーナー「${gm}GM、次はないと思え」`;
    html += `<div class="stats">
      <div class="card stat"><div class="label">資金</div><div class="value num ${f.funds < 0 ? 'bad' : ''}">${Util.money(f.funds)}</div><div class="note">1試合の収支見込み ${Util.signedMoney(b.net)}</div></div>
      <div class="card stat"><div class="label">オーナー評価</div><div class="value num">${s.ownerRating}<small>%</small></div>
        <div class="meter"><i class="${s.ownerRating < 30 ? 'low' : ''}" style="width:${s.ownerRating}%"></i></div><div class="note">${ownerNote}</div></div>
      <div class="card stat"><div class="label">今季の成績</div><div class="value num">${r.w}勝 ${r.l}敗${r.d ? ` ${r.d}分` : ''}</div>
        <div class="recent">${s.results.map(x => `<span class="${x.outcome[0]}">${x.outcome === 'win' ? '○' : x.outcome === 'lose' ? '●' : '△'}</span>`).join('')}</div>
        <div class="note">${r.w + r.l + r.d ? `勝率 ${Util.winRate(r.w, r.l)} ／ 現在 ${s.league.rankOf(s.team.id)}位` : `全${s.rules.gamesPerSeason}試合`}</div></div>
      <div class="card stat"><div class="label">ファン人数</div><div class="value num">${f.fans.toLocaleString()}人</div><div class="note">今季 ${Util.signed(f.fans - s.seasonStart.fans)}人</div></div>
    </div>`;

    // 順位表とニュース
    html += `<div class="dash-grid">
      <div class="card"><h2 class="card-title">${E(s.leagueName)} 順位表</h2>${this.standingsTable(s.league)}
        <details class="other-league"><summary>${E(s.league2Name)}の順位を見る</summary>${this.standingsTable(s.league2)}</details>
        <p class="muted small" style="margin:6px 0 0">上位3球団がプレーオフへ。勝ち抜くと${E(s.league2Name)}の代表と日本一決定シリーズ。</p></div>
      <div class="card"><h2 class="card-title">球団ニュース</h2>
        <ul class="news">${s.news.map(n => `<li><span class="nt ${n.type}">${{ game: '試合', grow: '成長', cond: '調子', event: '決断', move: '球団', bad: '注意' }[n.type]}</span><span>${E(n.text)}</span></li>`).join('') || '<li><span class="nt event">球団</span><span>シーズン開幕を待っています</span></li>'}</ul>
      </div>
    </div>`;
    html += this.modeHTML();
    html += this.nemesisHTML();
    html += this.sponsorStripHTML();
    html += this.gmCardHTML();
    $('view-dashboard').innerHTML = html;
  },

  // チャレンジ・今日のお題の進み具合
  modeHTML() {
    const s = game;
    if (s.daily) return `<div class="card mode-card"><span class="tag-mode">今日のお題</span><b>${E(s.dailyText)}</b><span class="muted small">1シーズンだけの勝負。GM評価が高いほどよい${Daily.best(s.daily.date) ? `（今日のベスト ${Daily.best(s.daily.date)}点）` : ''}</span></div>`;
    const C = s.challengeDef;
    if (!C) return '';
    const ch = s.profile.challenge, left = ch.start + C.years - 1 - s.season;
    const state = ch.done === 'clear' ? `<b class="good">達成！（${ch.doneSeason}年）</b>` : ch.done === 'fail' ? '<b class="bad">失敗（このまま続けて遊べる）</b>' : `期限：${ch.start + C.years - 1}年まで（${left > 0 ? `あと${left + 1}シーズン` : '今シーズンが最後'}）`;
    return `<div class="card mode-card"><span class="tag-mode">チャレンジ</span><b>${E(C.name)}</b><span class="muted small">${E(C.desc)}　${state}</span></div>`;
  },
  // 今季の宿敵（同じリーグでいちばん打つ他球団の打者）
  nemesisHTML() {
    const nm = game.nemesis;
    if (!nm) return '';
    const p = game.findPlayer(nm.id);
    return `<div class="card nemesis"><div class="nm-row"><div><div class="eyebrow">今季の宿敵</div>
        <div class="nm-name"><span class="tdot" style="background:${E(nm.color)}"></span>${E(nm.team)}の ${E(nm.name)}${p ? ` ${Util.rankBadge(p.overall, 'sm')}` : ''}</div>
        <div class="muted small">リーグ屈指の強打者。ノーヒットに抑えるとファンが増える</div></div>
      <div class="nm-score"><span><b class="good">${nm.won || 0}</b>抑えた</span><span><b class="bad">${nm.lost || 0}</b>打たれた</span></div></div></div>`;
  },
  // 球団の歴史：永久欠番と、これまでの物語
  historyHTML() {
    const s = game, ret = s.retiredNumbers || [], st = s.stories || [];
    const stars = s.team.players.filter(p => p.story && p.story.star);
    return `<div class="card"><h2 class="card-title">球団の歴史</h2>
      <h3 class="plan-sub">永久欠番</h3>
      ${ret.length ? `<div class="ret-nums">${ret.map(r => `<div class="ret-num"><b>${r.number}</b><span>${E(r.name)}</span><small>${r.season}年</small></div>`).join('')}</div>`
        : '<p class="muted small" style="margin:0">まだありません。長く活躍した選手が引退するとき、背番号を永久欠番にできる</p>'}
      ${stars.length ? `<h3 class="plan-sub">生え抜きの星</h3><p class="small" style="margin:0">${stars.map(p => `${E(p.name)}（${p.story.year}年${E(p.story.label)}）`).join('・')}</p>` : ''}
      <h3 class="plan-sub">球団の物語</h3>
      ${st.length ? `<ul class="news open">${st.slice(0, 12).map(x => `<li><span class="nt event">${x.season}年</span><span>${E(x.text)}</span></li>`).join('')}</ul>`
        : '<p class="muted small" style="margin:0">ドラフトで取った選手がエースに育つ、ベテランが引退する…。球団の物語がここに残っていく</p>'}
    </div>`;
  },
  // ホームに出すスポンサー一覧（営業は営業タブ）
  sponsorStripHTML() {
    const f = game.finance;
    return `<div class="card"><div class="sp-head"><h2 class="card-title">スポンサー（${f.sponsors.length}社・年${Util.money(f.sponsorTotal)}）</h2>
        <button class="btn-sm" data-act="goTab" data-tab2="sales">営業に行く</button></div>
      <ul class="sp-strip">${f.sponsors.map(sp => {
        const perk = sponsorPerk(sp);
        return `<li><b>${E(sp.name)}</b><span class="tier">${E(sp.tier)}</span><span class="muted small">年${Util.money(sp.amount)}・残り${sp.years}年${perk ? `・${E(SPONSOR_PERKS[perk])}` : ''}</span></li>`;
      }).join('')}</ul></div>`;
  },

  gmModalHTML() {
    return `<div class="modal-body gm-modal">${this.gmCardHTML()}
      <div class="modal-actions"><button class="btn btn-main" data-act="shareGm">GM成績をシェア</button><button class="btn btn-ghost" data-act="gmClose">閉じる</button></div></div>`;
  },
  // GMとしての成績（称号・通算・シーズンごと）
  gmCardHTML() {
    const s = game, c = s.gmCareer, h = s.gmHistory || [], log = s.gmLog || {};
    const pct = c.w + c.l ? Util.winRate(c.w, c.l) : '-';
    const lot = s.lottery || { win: 0, lose: 0 };
    return `<div class="card gm-card" id="gmCard">
      <div class="gm-head">
        <div><div class="eyebrow">GM ${E(s.profile.gm)} の成績</div>
          <div class="gm-title">${c.title.name}</div><div class="muted small">${c.seasons ? `${c.title.desc}（GM評価 平均${c.avg}点）` : '1シーズン終えると、GM評価と称号がつきます'}</div></div>
        <div class="gm-score num">${c.avg ?? '-'}<small>点</small></div>
      </div>
      <div class="gm-stats">
        <div><span>在任</span><b>${c.seasons}<small>シーズン</small></b></div>
        <div><span>通算</span><b>${c.w}勝${c.l}敗${c.d ? `${c.d}分` : ''}</b></div>
        <div><span>勝率</span><b>${pct}</b></div>
        <div><span>リーグ優勝</span><b>${c.league}<small>回</small></b></div>
        <div><span>日本一</span><b>${c.japan}<small>回</small></b></div>
        <div><span>プレーオフ進出</span><b>${c.cs}<small>回</small></b></div>
        <div><span>目標達成</span><b>${c.goals}<small>/${c.seasons}</small></b></div>
        <div><span>ドラフトくじ</span><b>${lot.win}勝${lot.lose}敗</b></div>
      </div>
      <div class="gm-log">${Object.entries(GM_COUNTS).map(([k, l]) => `<span>${l} <b>${log[k] || 0}</b></span>`).join('')}</div>
      ${h.length ? `<div class="table-wrap"><table class="gm-table"><thead><tr><th>年</th><th>順位</th><th>成績</th><th>ポストシーズン</th><th>目標</th><th>オーナー</th><th>GM評価</th></tr></thead>
        <tbody>${[...h].reverse().map(x => `<tr class="${c.best === x ? 'best' : ''}"><td>${x.season}</td><td>${x.rank}位</td><td class="num">${x.w}-${x.l}${x.d ? `-${x.d}` : ''}</td>
          <td>${E(x.post)}</td><td>${x.achieved ? '<span class="good">達成</span>' : '<span class="bad">未達成</span>'}<div class="muted small">${E(x.goal)}</div></td><td class="num">${x.owner}%</td><td class="num"><b>${gmSeasonScore(x)}</b>点${c.best === x && h.length > 1 ? ' <span class="tag-now">ベスト</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="empty-note">まだシーズンを終えていません。今季の結果がここに記録されます。</p>'}
      <p class="muted small" style="margin:0">GM評価は、順位・ポストシーズン・目標達成・オーナー評価で決まる（1シーズン100点満点）。</p>
    </div>`;
  },

  // ② 編成
  // 編成タブの切り替え（オーダー／1軍・ベンチ）
  rosterTabs() {
    const v = this.rosterView || 'order';
    return `<div class="seg" role="tablist" aria-label="編成の画面">
      <button class="seg-btn" role="tab" data-act="rosterView" data-k="order" aria-selected="${v === 'order'}">オーダー・選手一覧</button>
      <button class="seg-btn" role="tab" data-act="rosterView" data-k="bench" aria-selected="${v === 'bench'}">1軍登録・ベンチ入り</button>
    </div>`;
  },
  // 1軍登録（31人）とベンチ入り（26人）の管理
  benchHTML() {
    const s = game, t = s.team, R = s.rules;
    const next = s.nextGame, gi = s.gameIndex;
    const bench = t.benchFor(gi, R.benchMax), sp = t.starterFor(gi), nine = t.lineup;
    const act = t.players.filter(p => p.active), ni = t.players.filter(p => !p.active);
    const agari = act.filter(p => !p.benchOut && !bench.includes(p));
    const outs = act.filter(p => p.benchOut);
    const role = p => (p === sp ? '今日の先発' : p.isPitcher ? p.role : nine.includes(p) ? `スタメン（${nine.indexOf(p) + 1}番）` : `控え・${POS_ABBR[p.position] || ''}`);
    const row = (p, kind) => {
      const reg = kind === 'farm' ? s.registerLock(p) : s.unregisterLock(p);
      return `<div class="bm ${kind}">
        <span class="bm-pos ${posCls(p.isPitcher ? '投手' : p.position)}">${p.isPitcher ? '投' : POS_ABBR[p.position] || '?'}</span>
        <div class="bm-main"><div class="bm-name">${condIcon(p.condition)} ${E(p.name)} ${Util.rankBadge(p.overall, 'sm')}${p.injured ? `<span class="inj">ケガ あと${p.injured}</span>` : ''}${p.away ? `<span class="p-flag">日本代表 あと${p.away}</span>` : ''}</div>
          <div class="p-meta">${kind === 'out' ? `<b class="${p.benchOut ? 'warn-text' : 'good'}">${p.benchOut ? 'GMがベンチ外に' : '上がり'}</b>・` : ''}${E(role(p))}${p.down ? `・再登録まで あと${p.down}試合` : ''}${kind === 'farm' ? `・${p.age}歳` : ''}</div></div>
        <div class="bm-act">
          ${kind !== 'farm' ? `<button class="btn-sm" data-act="benchToggle" data-id="${p.id}" ${p === sp && !p.benchOut ? 'disabled title="今日の先発です"' : ''}>${p.benchOut ? 'ベンチに入れる' : 'ベンチ外へ'}</button>` : ''}
          <button class="btn-sm ${kind === 'farm' ? 'go' : ''}" data-act="regToggle" data-id="${p.id}" ${reg ? `disabled title="${E(reg)}"` : ''}>${kind === 'farm' ? '1軍に登録' : '登録抹消'}</button>
        </div></div>`;
    };
    const benchP = bench.filter(p => p.isPitcher), benchB = bench.filter(p => !p.isPitcher);
    const sortB = l => [...l].sort((a, b) => (nine.includes(b) - nine.includes(a)) || b.overall - a.overall);
    const sortP = l => [...l].sort((a, b) => (b === sp) - (a === sp) || ['先発', '抑え', '中継ぎ'].indexOf(a.role) - ['先発', '抑え', '中継ぎ'].indexOf(b.role) || b.overall - a.overall);
    return `
      <div class="bench-sum">
        <div><span>出場選手登録（1軍）</span><b class="${act.length > R.maxActive ? 'bad' : ''}">${act.length}<small>/${R.maxActive}人</small></b></div>
        <div><span>${next ? `第${next.no}戦のベンチ入り` : 'ベンチ入り'}</span><b>${bench.length}<small>/${R.benchMax}人</small></b></div>
        <div><span>ベンチ外（上がり・GM判断）</span><b>${agari.length + outs.length}<small>人</small></b></div>
        <div><span>2軍（支配下・未登録）</span><b>${ni.length}<small>人</small></b></div>
        <div><span>育成</span><b>${t.farm.length}<small>人</small></b></div>
      </div>
      <div class="card rule-card"><h2 class="card-title">プロ野球の登録ルール</h2>
        <ul class="rule-list">
          <li><b>支配下登録</b>：最大${R.maxRoster}人（NPBと同じ）。育成選手は人数の上限なし（NPBと同じ）。このうち試合に出られるのは1軍に登録した選手だけ。</li>
          <li><b>出場選手登録（1軍）</b>：最大<b>${R.maxActive}人</b>（NPBは2020年から31人）。登録していない選手は2軍で調整し、調子が戻りやすく、練習で少し育つ。</li>
          <li><b>ベンチ入り</b>：1試合<b>${R.benchMax}人</b>まで。1軍でも外れた選手は「上がり」。ふつうはその日に投げない先発投手が外れる。</li>
          <li><b>登録抹消</b>：一度抹消すると${R.reRegister}試合は再登録できない（NPBは10日間）。</li>
        </ul></div>
      <div class="bench-cols">
        <div class="card"><h2 class="card-title">${next ? `第${next.no}戦 vs ${E(next.opponent.short)}` : '次の試合'}のベンチ入り <span class="muted small">${bench.length}/${R.benchMax}人</span></h2>
          <h3 class="sub-title">投手 ${benchP.length}人</h3><div class="bm-list">${sortP(benchP).map(p => row(p, 'in')).join('')}</div>
          <h3 class="sub-title">野手 ${benchB.length}人</h3><div class="bm-list">${sortB(benchB).map(p => row(p, 'in')).join('')}</div>
        </div>
        <div>
          <div class="card"><h2 class="card-title">ベンチ外 <span class="muted small">${agari.length + outs.length}人</span></h2>
            ${agari.length || outs.length ? `<div class="bm-list">${[...agari, ...outs].map(p => row(p, 'out')).join('')}</div>` : '<p class="empty-note">1軍の全員がベンチに入っています。</p>'}
            <p class="muted small" style="margin:6px 0 0">「上がり」は${R.benchMax}人を超えた分を自動で外した選手（その日に投げない先発投手から）。「ベンチ外へ」で、GMが外す選手を決めることもできる。</p></div>
          <div class="card"><h2 class="card-title">2軍（支配下・未登録） <span class="muted small">${ni.length}人</span></h2>
            ${ni.length ? `<div class="bm-list">${[...ni].sort((a, b) => b.overall - a.overall).map(p => row(p, 'farm')).join('')}</div>` : `<p class="empty-note">支配下の全員が1軍に登録されています（${R.maxActive}人まで）。</p>`}</div>
        </div>
      </div>`;
  },
  renderRoster() {
    if ((this.rosterView || 'order') === 'bench') {
      const t = game.team;
      $('view-roster').innerHTML = `<div class="view-head"><h1 class="view-title">編成</h1>
        <div class="view-sub">支配下 ${t.players.length}/${game.rules.maxRoster}人 ／ 1軍 ${game.activeCount}/${game.rules.maxActive}人 ／ 育成 ${t.farm.length}${capText(game.rules.maxFarm)}</div></div>
        ${this.rosterTabs()}${this.benchHTML()}`;
      return;
    }
    const s = game, t = s.team;
    const sorters = { number: (a, b) => a.number - b.number, overall: (a, b) => b.overall - a.overall, salary: (a, b) => b.salary - a.salary, condition: (a, b) => b.condition - a.condition };
    const pitchers = t.pitchers.sort(sorters[this.rosterSort]);
    const group = g => t.batters.filter(p => posGroup(p) === g).sort(sorters[this.rosterSort]);
    const show = g => this.rosterFilter === 'all' || this.rosterFilter === g;
    const order = t.lineup.map(p => p.id);
    const field = t.fieldAssign();
    const fieldOf = Object.fromEntries(Object.entries(field).map(([pos, v]) => [v.p.id, { pos, penalty: v.penalty }]));
    const starters = t.batters.filter(p => p.starter).length;

    const nameCell = p => `<div class="p-name">${condIcon(p.condition)} ${E(p.name)}${!p.active ? '<span class="p-flag ni">2軍</span>' : p.benchOut ? '<span class="p-flag">ベンチ外</span>' : ''}${p.injured ? `<span class="inj">ケガ あと${p.injured}試合</span>` : ''}${p.away ? `<span class="p-flag">日本代表 あと${p.away}試合</span>` : ''}${p.rest ? '<span class="p-flag">休養中</span>' : ''}${p.retiring ? '<span class="p-flag gold">今季で引退</span>' : ''}${p.story && p.story.star ? '<span class="p-flag gold">生え抜きの星</span>' : ''}</div>
      <div class="p-meta">${p.age}歳・${p.throws}投${p.bats}打・伸びしろ ${Util.rankOf(p.potential)}</div><div class="exp" title="経験値 ${p.exp}/10"><i style="width:${p.exp * 10}%"></i></div>`;
    const releaseBtn = p => {
      const why = s.canRelease(p);
      return `<button class="btn-sm ${this.armed === p.id ? 'warn' : ''}" data-act="release" data-id="${p.id}" ${why ? `disabled title="${why}"` : ''}>${this.armed === p.id ? '本当に放出' : '自由契約'}</button>`;
    };
    const pitcherRow = p => `<tr>
      <td class="uni">${p.number}</td><td>${nameCell(p)}</td>
      <td><select class="role-select" data-act="role" data-id="${p.id}" aria-label="${E(p.name)}の役割">${['先発', '中継ぎ', '抑え'].map(r => `<option ${p.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
      <td class="c">${Util.rankBadge(p.overall)}</td>
      <td><div class="abil"><span><span class="velo">${p.stats.velocity}</span>球速</span><span>${Util.rankBadge(p.stats.control, 'sm')}制球</span><span>${Util.rankBadge(p.stats.stamina, 'sm')}スタミナ</span><span>${Util.rankBadge(p.stats.breaking, 'sm')}変化球</span></div></td>
      <td class="r num">${Util.money(p.salary)}</td><td>${releaseBtn(p)}</td></tr>`;
    // 守備位置のコンバート（選ぶとすぐ変わる）
    const convSelect = p => `<select class="role-select conv-select" data-act="convert" data-id="${p.id}" aria-label="${E(p.name)}の守備位置をコンバート">
        ${GameState.CONVERT_POS.map(pos => `<option value="${pos}" ${p.position === pos ? 'selected' : ''}>${p.position === pos ? `${pos}（本職）` : `${pos}へコンバート`}</option>`).join('')}</select>
      ${p.conv ? `<div class="p-meta"><b class="off-tag">コンバート中</b> 不慣れ 守備-${p.conv}（元：${E(p.formerPos || '-')}）</div>` : ''}`;
    const batterRow = p => `<tr>
      <td class="uni">${p.number}</td><td>${nameCell(p)}</td>
      <td><div class="pos-cell"><span class="pos-badge ${posCls(p.position)}" title="本職：${E(p.position)}">${POS_ABBR[p.position] || '?'}</span>
          <button class="switch" data-act="starter" data-id="${p.id}" aria-pressed="${p.starter}" aria-label="${E(p.name)}をスタメンにする"></button></div>
        ${convSelect(p)}
        <div class="p-meta">${fieldOf[p.id] ? `${order.indexOf(p.id) + 1}番・${fieldOf[p.id].pos === '指名打者' ? 'DH' : `${E(fieldOf[p.id].pos)}を守る`}${fieldOf[p.id].penalty ? `<b class="off-tag">${isNatural(p, fieldOf[p.id].pos) ? '不慣れ' : '本職外'}</b>` : ''}` : '控え'}</div></td>
      <td class="c">${Util.rankBadge(p.overall)}</td>
      <td><div class="abil"><span>${Util.rankBadge(p.stats.contact, 'sm')}ミート</span><span>${Util.rankBadge(p.stats.power, 'sm')}パワー</span><span>${Util.rankBadge(p.stats.speed, 'sm')}走力</span><span>${Util.rankBadge(p.stats.defense, 'sm')}守備</span></div></td>
      <td class="r num">${Util.money(p.salary)}</td><td>${releaseBtn(p)}</td></tr>`;

    $('view-roster').innerHTML = `
      <div class="view-head"><h1 class="view-title">編成</h1>
        <div class="view-sub">支配下 ${t.players.length}/${s.rules.maxRoster}人 ／ 1軍 ${s.activeCount}/${s.rules.maxActive}人 ／ 育成 ${t.farm.length}${capText(s.rules.maxFarm)} ／ スタメン ${starters}/9人 ／ 年俸総額 ${Util.money(t.payroll)} ／ チーム総合 ${Util.rankOf(t.overall)}（${t.overall}）</div></div>
      ${this.rosterTabs()}
      <p class="muted small" style="margin:0">調子の顔を見て、スタメンと先発ローテを決めよう。試合に出ると経験値がたまり、能力が上がる（若い選手ほど早い）。スタメンが9人に足りないときは控えから自動で補う。</p>
      <div class="two-col">${this.fieldHTML(field)}${this.battingHTML(fieldOf)}</div>
      <div class="toolbar">
        <div class="chips" role="group" aria-label="表示する選手">
          ${[['all', '全員'], ...Object.entries(POS_GROUPS)].map(([k, l]) => `<button class="chip" data-act="filter" data-k="${k}" aria-pressed="${this.rosterFilter === k}">${l}</button>`).join('')}
        </div>
        <label class="select"><span>並び順</span><select id="rosterSort">
          ${[['number', '背番号'], ['overall', '総合力'], ['condition', '調子'], ['salary', '年俸']].map(([k, l]) => `<option value="${k}" ${this.rosterSort === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      </div>
      <div class="table-card"><div class="table-scroll"><table class="roster">
        <thead><tr><th>#</th><th>名前</th><th>役割 / スタメン</th><th class="c">総合</th><th>能力</th><th class="r">年俸</th><th></th></tr></thead>
        <tbody>
          ${show('P') ? `<tr class="group"><td colspan="7">投手 ${pitchers.length}人（先発ローテ：${E(t.rotation.map(p => p.shortName).join(' → '))}）</td></tr>${pitchers.map(pitcherRow).join('')}` : ''}
          ${['C', 'IF', 'OF'].filter(show).map(g => `<tr class="group"><td colspan="7">${POS_GROUPS[g]} ${group(g).length}人</td></tr>${group(g).map(batterRow).join('') || '<tr><td colspan="7" class="muted">いません</td></tr>'}`).join('')}
        </tbody></table></div></div>
      ${this.farmHTML()}
      <p class="legend">調子　${[2, 1, 0, -1, -2].map(c => `${condIcon(c)} ${CONDITION[c]}`).join('　')}</p>
      <p class="legend pos-legend">守備位置 ${['投手', '捕手', '一塁手', '二塁手', '三塁手', '遊撃手', '左翼手', '中堅手', '右翼手', '外野手', '指名打者'].map(x => `<span class="lg-item"><span class="pos-badge ${posCls(x)}">${POS_ABBR[x]}</span>${x === '指名打者' ? '指名打者' : x === '外野手' ? '外野（どこでも）' : x.replace('手', '')}</span>`).join('')}</p>
      <p class="legend">能力ランク　<b class="rk rk-S">S</b> 85以上　<b class="rk rk-A">A</b> 75〜　<b class="rk rk-B">B</b> 65〜　<b class="rk rk-C">C</b> 50〜　<b class="rk rk-D">D</b> 50未満</p>`;
  },

  standingsTable(league) {
    const s = game;
    return `<div class="table-scroll"><table class="standings">
      <thead><tr><th>順位</th><th>球団</th><th class="r">勝</th><th class="r">敗</th><th class="r">分</th><th class="r">勝率</th><th class="r">差</th></tr></thead><tbody>
      ${league.standings.map((row, i) => `<tr class="${row.team.id === s.team.id ? 'me' : ''} ${i === 2 ? 'cs-line' : ''}"><td>${i + 1}</td><td><span class="tdot" style="background:${row.team.color}"></span>${E(row.team.name)}</td>
        <td class="r num">${row.w}</td><td class="r num">${row.l}</td><td class="r num">${row.d}</td><td class="r num">${Util.winRate(row.w, row.l)}</td><td class="r num">${i ? row.gb : '-'}</td></tr>`).join('')}
      </tbody></table></div>`;
  },

  // ポストシーズン（プレーオフ・日本一決定シリーズ）
  postHTML() {
    const s = game, P = s.post, me = s.team.id;
    const T = id => s.teamById(id);
    const stageName = P.stage === 'done' ? '日本一決定！' : POSTSEASON[P.stage].name;
    const myLive = s.myPostSeries;
    const status = P.stage === 'done'
      ? (P.champion === me ? '日本一！ おめでとう！' : `${POST_RESULT[P.myLevel].name}`)
      : myLive ? `${E(s.team.name)}は${POSTSEASON[myLive.stage].short}で戦っています` : P.myLevel ? `${POST_RESULT[P.myLevel].name}` : 'プレーオフ進出ならず';
    const leagueName = sr => (sr.league === 'A' ? s.leagueName : sr.league === 'B' ? s.league2Name : '両リーグ');
    const seriesCard = sr => {
      const R = POSTSEASON[sr.stage];
      const a = T(sr.a), b = T(sr.b), mine = sr.a === me || sr.b === me;
      const dots = sr.games.map(g => `<span class="${g.winner === sr.a ? 'w' : g.winner === sr.b ? 'l' : 'd'}" title="第${g.no}戦 ${E(T(g.home).short)}の本拠地 ${E(g.score)}">${g.winner === sr.a ? '○' : g.winner === sr.b ? '●' : '△'}</span>`).join('');
      const next = sr.winner ? '' : `次：第${sr.games.length + 1}戦（${E(T(s.seriesHome(sr, sr.games.length)).short)}の本拠地）`;
      return `<div class="series ${mine ? 'mine' : ''} ${sr.winner ? 'over' : ''}">
        <div class="series-head"><span class="muted small">${E(leagueName(sr))}　${E(R.short)}</span><span class="muted small">先に${R.need}勝${R.adv ? '（上位に1勝のアドバンテージ）' : ''}</span></div>
        <div class="series-teams">
          <span class="${sr.winner === sr.a ? 'won' : ''}"><span class="tdot" style="background:${a.color}"></span>${E(a.name)}</span>
          <span class="series-score num">${sr.wa + R.adv}${R.adv ? '<small>(+1)</small>' : ''} - ${sr.wb}${sr.draws ? `<small> ${sr.draws}分</small>` : ''}</span>
          <span class="${sr.winner === sr.b ? 'won' : ''}"><span class="tdot" style="background:${b.color}"></span>${E(b.name)}</span>
        </div>
        <div class="recent">${dots}</div>
        <div class="muted small">${sr.winner ? `${E(T(sr.winner).name)}が勝ち抜け` : next}</div>
      </div>`;
    };
    const history = P.done.map(sr => `<li><span class="nt ${sr.a === me || sr.b === me ? 'grow' : 'move'}">${E(POSTSEASON[sr.stage].short)}</span><span>${E(leagueName(sr))}：${E(T(sr.a).short)} ${sr.wa + POSTSEASON[sr.stage].adv}-${sr.wb} ${E(T(sr.b).short)} → <b>${E(T(sr.winner).name)}</b></span></li>`).join('');
    return `<div class="post-card ${P.stage === 'done' && P.champion === me ? 'champ' : ''}">
      <div class="eyebrow">${s.season}年 ポストシーズン</div>
      <h2 class="post-title">${E(stageName)}</h2>
      <div class="post-status">${status}</div>
      ${P.stage === 'done'
        ? `<div class="champion"><span class="muted small">日本一</span><div class="champion-name"><span class="tdot" style="background:${T(P.champion).color}"></span>${E(T(P.champion).name)}</div></div>
           <div class="row-actions"><button class="btn btn-main" data-act="postClose">シーズンを締めくくる（結果発表へ）</button></div>`
        : `<div class="series-grid">${P.series.map(seriesCard).join('')}</div>
           <div class="row-actions">
             <button class="btn btn-main" data-act="postNext">${myLive ? `${POSTSEASON[myLive.stage].short} 第${myLive.games.length + 1}戦をする` : '次の試合へ進める'}</button>
             <button class="btn btn-ghost" data-act="postStage">このステージを最後まで</button>
             ${myLive ? '' : '<button class="btn btn-ghost" data-act="postAll">ポストシーズンを最後まで</button>'}
           </div>`}
      ${history ? `<h3 class="plan-sub">これまでの結果</h3><ul class="news open">${history}</ul>` : ''}
      <p class="muted small" style="margin:0">ホームのポストシーズンは観客がふだんの1.5倍（収容人数まで）・チケット1.2倍（運営費と選手の出場ボーナスを引いた分が収入）。日本一の賞金は${Util.money(POST_RESULT[4].prize)}。</p>
    </div>`;
  },

  // 開幕前の方針決め
  planHTML() {
    const s = game;
    const goal = this.planGoal, strat = this.planStrategy || s.strategy;
    return `<div class="plan-card">
      <div class="eyebrow">${s.season}年シーズン 開幕前</div>
      <h2 class="plan-title">今シーズンの目標と方針を決めよう</h2>
      ${s.lastRenewal && s.lastRenewal.season === s.season ? `<div class="renewal"><b>契約更改の結果</b>　年俸総額 ${Util.money(s.lastRenewal.before)} → <b>${Util.money(s.lastRenewal.after)}</b>（${s.lastRenewal.count}人が変動）
        <ul>${s.lastRenewal.top.map(c => `<li>${E(c.name)}　${Util.money(c.from)} → <span class="${c.to > c.from ? 'bad' : 'good'}">${Util.money(c.to)}</span></li>`).join('')}</ul>
        <span class="muted small">成長した選手ほど年俸が上がる。高すぎると思ったらトレードや自由契約も考えよう。</span></div>` : ''}
      <p class="muted small" style="margin:0">目標を達成するとシーズン終了時にオーナー評価が上がり、届かないと下がる。方針は試合・成長・補強・ドラフトに効く。</p>
      <h3 class="plan-sub">目標</h3>
      <div class="plan-grid">${Object.entries(GOALS).map(([k, g]) => `<button class="plan-opt" data-act="planGoal" data-k="${k}" aria-pressed="${goal === k}">
        <b>${E(g.name)}</b><span>${E(g.desc)}</span><span class="plan-odds"><em class="good">達成 +${g.win}%</em> ／ <em class="bad">未達成 ${g.lose}%</em></span></button>`).join('')}</div>
      <h3 class="plan-sub">戦略方針</h3>
      <div class="plan-grid">${Object.entries(STRATEGIES).map(([k, st]) => `<button class="plan-opt" data-act="planStrategy" data-k="${k}" aria-pressed="${strat === k}">
        <b>${E(st.name)}</b><span>${E(st.desc)}</span><span class="plan-odds">ドラフトでは：${E(st.draft)}</span></button>`).join('')}</div>
      <div class="row-actions"><button class="btn btn-main" data-act="planSet" ${goal ? '' : 'disabled'}>この目標と方針でシーズン開幕</button>
        ${goal ? '' : '<span class="muted small">目標を選んでください</span>'}</div>
    </div>`;
  },

  // 守備位置の図（グラウンドにスタメンを置く）
  fieldHTML(field) {
    const s = game, t = s.team;
    const SPOT = { '中堅手': [50, 13], '左翼手': [19, 27], '右翼手': [81, 27], '遊撃手': [34, 47], '二塁手': [66, 47], '三塁手': [20, 66], '一塁手': [80, 66], '捕手': [50, 91], '指名打者': [13, 92] };
    const sp = t.starterFor(s.gameIndex);
    const chip = (pos, v) => {
      const [x, y] = SPOT[pos];
      return `<div class="fchip ${v.penalty ? 'off' : ''} ${pos === '指名打者' ? 'dh' : ''}" style="left:${x}%;top:${y}%">
        <span class="fpos ${posCls(pos)}">${POS_ABBR[pos]}</span>${condIcon(v.p.condition)}<span class="fname">${E(v.p.shortName)}</span>${v.penalty ? '<b class="off-tag">本職外</b>' : ''}</div>`;
    };
    const offs = Object.entries(field).filter(([, v]) => v.penalty);
    return `<div class="card">
      <h2 class="card-title">守備位置</h2>
      <div class="fieldmap">
        <svg viewBox="0 0 100 92" preserveAspectRatio="none" aria-hidden="true">
          <rect width="100" height="92" class="fd-bg"/>
          <path d="M50 88 L4 42 A65 65 0 0 1 96 42 Z" class="fd-grass"/>
          <path d="M50 88 L26 64 L50 40 L74 64 Z" class="fd-dirt"/>
          <path d="M50 81 L33 64 L50 47 L67 64 Z" class="fd-grass2"/>
          <path d="M50 88 L4 42 M50 88 L96 42" class="fd-line"/>
          <circle cx="50" cy="63" r="3.2" class="fd-dirt"/>
          <rect x="48.6" y="86.6" width="2.8" height="2.8" class="fd-base"/><rect x="72.6" y="62.6" width="2.8" height="2.8" class="fd-base" transform="rotate(45 74 64)"/>
          <rect x="48.6" y="38.6" width="2.8" height="2.8" class="fd-base" transform="rotate(45 50 40)"/><rect x="24.6" y="62.6" width="2.8" height="2.8" class="fd-base" transform="rotate(45 26 64)"/>
        </svg>
        <div class="fchip pitcher" style="left:50%;top:63%"><span class="fpos pc-P">投</span>${condIcon(sp.condition)}<span class="fname">${E(sp.shortName)}</span></div>
        ${Object.entries(field).map(([pos, v]) => chip(pos, v)).join('')}
      </div>
      ${offs.length ? `<ul class="off-list">${offs.map(([pos, v]) => isNatural(v.p, pos)
        ? `<li><b>${E(v.p.name)}</b>は${E(pos)}にコンバートしたばかりで不慣れ。守備力 -${v.penalty}</li>`
        : `<li><b>${E(v.p.name)}</b>（本職：${E(v.p.position)}）が${E(pos)}を守っています。守備力 -${v.penalty}</li>`).join('')}</ul>`
        : '<p class="muted small" style="margin:8px 0 0">全員が本職の位置を守っています。</p>'}
      <p class="muted small" style="margin:4px 0 0">投手は予告先発。本職と違う位置を守ると守備力が下がる。スタメンの入れ替えとコンバートは下の表で。</p>
    </div>`;
  },

  // 打順（1番〜9番を▲▼で入れ替える）
  battingHTML(fieldOf = {}) {
    const s = game, t = s.team;
    const order = t.lineup;
    return `<div class="card">
      <div class="row-actions" style="justify-content:space-between"><h2 class="card-title" style="margin:0">打順 <span class="muted small">（${t.battingOrder ? '手動' : '自動'}）</span></h2>
        <button class="btn-sm go" data-act="batAuto">おまかせで組む</button></div>
      <p class="muted small" style="margin:6px 0 10px">▲▼で入れ替える。1・2番は出塁（ミート・走力）、3・4番は長打（パワー）の選手を置くのが基本。「おまかせで組む」と、控えも含めて守備位置に合った能力の高い9人を選び、打順も組み直す。</p>
      <ol class="batting">${order.map((p, i) => {
        const real = t.players.includes(p);
        return `<li>
          <span class="bo-num">${i + 1}</span>
          <span class="bo-name">${fieldOf[p.id] ? `<span class="pos-badge ${posCls(fieldOf[p.id].pos)} ${fieldOf[p.id].penalty ? 'off' : ''}">${POS_ABBR[fieldOf[p.id].pos]}</span>` : ''} ${condIcon(p.condition)} <b>${E(p.name)}</b></span>
          <span class="abil bo-abil"><span>${Util.rankBadge(p.stats.contact, 'sm')}ミート</span><span>${Util.rankBadge(p.stats.power, 'sm')}パワー</span><span>${Util.rankBadge(p.stats.speed, 'sm')}走力</span></span>
          <span class="bo-move">${real ? `<button class="btn-sm" data-act="batUp" data-id="${p.id}" ${i === 0 ? 'disabled' : ''} aria-label="${E(p.name)}の打順を上げる">▲</button><button class="btn-sm" data-act="batDown" data-id="${p.id}" ${i === order.length - 1 ? 'disabled' : ''} aria-label="${E(p.name)}の打順を下げる">▼</button>` : '<span class="muted small">2軍から</span>'}</span>
        </li>`;
      }).join('')}</ol>
    </div>`;
  },

  // 育成選手（2軍）
  farmHTML() {
    const s = game, farm = [...s.team.farm].sort((a, b) => b.overall - a.overall);
    return `<h2 class="section-title">育成選手（2軍） ${farm.length}${capText(s.rules.maxFarm)}</h2>
      <p class="muted small" style="margin:0">育成選手は試合に出られないが、2軍で毎試合練習して育つ。力がついたら「支配下登録」で1軍の枠へ。</p>
      ${farm.length ? `<div class="table-card"><div class="table-scroll"><table class="roster">
        <thead><tr><th>名前</th><th>ポジション</th><th class="c">総合</th><th class="c">伸びしろ</th><th>能力</th><th class="r">年俸</th><th></th></tr></thead><tbody>
        ${farm.map(p => `<tr>
          <td><div class="p-name">${E(p.name)}</div><div class="p-meta">${p.age}歳・${E(p.draft || '')}・${E(p.school || '')}</div><div class="exp" title="経験値 ${p.exp}/10"><i style="width:${p.exp * 10}%"></i></div></td>
          <td>${posLabel(p)}</td>
          <td class="c">${Util.rankBadge(p.overall)}</td><td class="c">${Util.rankBadge(p.potential)}</td>
          <td><div class="abil">${p.isPitcher
            ? `<span><span class="velo">${p.stats.velocity}</span>球速</span><span>${Util.rankBadge(p.stats.control, 'sm')}制球</span><span>${Util.rankBadge(p.stats.stamina, 'sm')}スタミナ</span><span>${Util.rankBadge(p.stats.breaking, 'sm')}変化球</span>`
            : `<span>${Util.rankBadge(p.stats.contact, 'sm')}ミート</span><span>${Util.rankBadge(p.stats.power, 'sm')}パワー</span><span>${Util.rankBadge(p.stats.speed, 'sm')}走力</span><span>${Util.rankBadge(p.stats.defense, 'sm')}守備</span>`}</div></td>
          <td class="r num">${Util.money(p.salary)}</td>
          <td><div class="row-actions">
            <button class="btn-sm go" data-act="promote" data-id="${p.id}" ${s.rosterFull ? 'disabled title="支配下がいっぱいです"' : ''}>支配下登録</button>
            <button class="btn-sm ${this.armed === p.id ? 'warn' : ''}" data-act="release" data-id="${p.id}">${this.armed === p.id ? '本当に放出' : '自由契約'}</button>
          </div></td></tr>`).join('')}
        </tbody></table></div></div>` : '<p class="empty-note">育成選手はいません。ドラフト会議の育成ドラフトで指名できる。</p>'}`;
  },

  // 他球団からのトレード申し込み
  tradeOfferHTML(abil) {
    const s = game, o = s.tradeOffer;
    if (!o) return '';
    const t = s.league.team(o.team);
    const mine = s.team.players.find(p => p.id === o.wantId), theirs = t && t.players.find(p => p.id === o.giveId);
    if (!mine || !theirs) return '';
    const side = (p, label) => `<div class="offer-side"><div class="muted small">${label}</div>
      <div class="p-name">${condIcon(p.condition)} ${E(p.name)} ${Util.rankBadge(p.overall)}</div>
      <div class="p-meta">${posLabel(p)}・${p.age}歳・伸びしろ ${Util.rankOf(p.potential)}・年俸 ${Util.money(p.salary)}</div>
      <div class="abil">${abil(p)}</div></div>`;
    const diff = theirs.value - mine.value;
    const hint = diff >= 3 ? 'こちらに得な話かも' : diff <= -3 ? '相手に得な話かも' : 'ほぼ釣り合った交換';
    return `<div class="card offer-card">
      <h2 class="card-title">${E(t.name)}からトレードの申し込み</h2>
      <div class="offer-grid">${side(mine, 'あなたが出す選手')}<div class="offer-arrow" aria-hidden="true">⇄</div>${side(theirs, `${E(t.short)}が出す選手`)}</div>
      <p class="muted small" style="margin:6px 0 10px">${E(t.short)}は${E(POS_GROUPS[posGroup(mine)])}を補強したいようだ。スカウトの見立て：<b>${hint}</b>。返事の期限は第${o.until}戦まで。</p>
      <div class="row-actions"><button class="btn btn-main" data-act="tradeYes">受ける</button><button class="btn btn-ghost" data-act="tradeNo">断る</button></div>
    </div>`;
  },

  // ===== オフシーズン（ホームの中に表示） =====
  offHTML() {
    const s = game, o = s.off;
    const stepIdx = OFF_STEPS.findIndex(x => x.id === o.step);
    const playerLine = p => `<div class="p-name">${condIcon(p.condition)} ${E(p.name)} ${Util.rankBadge(p.overall)}</div>
      <div class="p-meta">${posLabel(p)}・${p.age}歳・伸びしろ ${Util.rankOf(p.potential)}・在籍${p.service}年</div>`;
    const abil = p => `<div class="abil">${p.isPitcher
      ? `<span><span class="velo">${p.stats.velocity}</span>球速</span><span>${Util.rankBadge(p.stats.control, 'sm')}制球</span><span>${Util.rankBadge(p.stats.stamina, 'sm')}スタミナ</span><span>${Util.rankBadge(p.stats.breaking, 'sm')}変化球</span>`
      : `<span>${Util.rankBadge(p.stats.contact, 'sm')}ミート</span><span>${Util.rankBadge(p.stats.power, 'sm')}パワー</span><span>${Util.rankBadge(p.stats.speed, 'sm')}走力</span><span>${Util.rankBadge(p.stats.defense, 'sm')}守備</span>`}</div>`;
    let html = `<div class="draft-head"><div class="eyebrow">${s.season}年 オフシーズン</div><h1 class="draft-title">${E(OFF_STEPS[stepIdx].name)}</h1>
      <div class="draft-steps">${OFF_STEPS.map((x, i) => `<span class="${i < stepIdx ? 'done' : i === stepIdx ? 'now' : ''}">${i + 1}. ${E(x.name)}</span>`).join('')}<span>契約更改 → ${s.season + 1}年へ</span></div>
      <div class="muted small">資金 ${Util.money(s.finance.funds)} ／ 支配下 ${s.team.players.length}/${s.rules.maxRoster}人 ／ 年俸総額 ${Util.money(s.team.payroll)}</div></div>`;
    if (this.offMsg) html += `<div class="msg ${this.offMsg.ok ? '' : 'ng'}">${E(this.offMsg.text)}</div>`;

    if (o.step === 'tryout') {
      html += `<div class="card"><h2 class="card-title">合同トライアウト（戦力外・自由契約の選手）</h2>
        <p class="muted small" style="margin:0 0 10px">各球団から戦力外になった選手たち。契約金なし・安い年俸で獲得できる。ベテランの掘り出し物を探そう。</p>
        <div class="fa-grid">${o.tryout.map(p => `<div class="fa">${playerLine(p)}<div class="p-meta">元 ${E(p.from || '')}</div>${abil(p)}
          <div class="fa-money"><div><small class="muted">年俸</small><b>${Util.money(p.salary)}</b></div><div><small class="muted">契約金</small><b>なし</b></div></div>
          <button class="btn-sm go" data-act="tryoutSign" data-id="${p.id}" ${s.rosterFull ? 'disabled' : ''}>獲得する</button></div>`).join('') || '<p class="empty-note">残っている選手はいません。</p>'}</div>
      </div>
      <div class="row-actions"><button class="btn btn-main" data-act="offNext">FAへ進む</button></div>`;
    }

    if (o.step === 'fa') {
      const levels = ['現状維持', '1割アップ', '3割アップ', '5割アップ'];
      html += `<div class="card"><h2 class="card-title">自チームのFA宣言</h2>
        <p class="muted small" style="margin:0 0 10px">在籍${FA_YEARS}年で<b>国内FA権</b>、${FA_OVERSEAS_YEARS}年で<b>海外FA権</b>を得る。年俸を上げるほど残ってくれやすい。<br>
          ・国内FA：出ていかれても、A・Bランクなら補償がもらえる（A＝年俸がチーム上位3人、B＝4〜10位）<br>
          ・海外FA：総合${MLB_LEVEL}以上の選手が宣言することがある。メジャーへの夢は強く、引き止めにくい。行ってしまうと<b>補償はない</b>（壮行会でファンは増える）</p>
        ${o.faOut.length ? o.faOut.map(f => {
          const p = s.findPlayer(f.id);
          if (!p) return '';
          let body = '';
          if (!f.status) {
            body = `<div class="row-actions">${levels.map((l, i) => `<button class="btn-sm ${i ? 'go' : ''}" data-act="retain" data-id="${f.id}" data-k="${i}">${l}（${Util.money(Math.round(f.oldSalary * [1, 1.1, 1.3, 1.5][i] / 100) * 100)}・${Math.round(s.retainChance(f, i) * 100)}%）</button>`).join('')}
              <button class="btn-sm warn" data-act="letGo" data-id="${f.id}">引き止めない</button></div>`;
          } else if (f.status === 'stay') body = '<span class="tag-now">残留</span>';
          else if (f.overseas) body = '<div class="muted small">→ メジャーリーグへ移籍（補償なし）</div>';
          else {
            const to = s.league.team(f.to) || s.league2.team(f.to);
            body = `<div class="muted small">→ ${E(to.name)}へ移籍</div>`;
            if (f.rank !== 'C' && !f.comp) {
              body += `<div class="comp"><b>補償を選ぶ</b>
                <button class="btn-sm go" data-act="comp" data-id="${f.id}" data-k="money">金銭補償 ${Util.money(Math.round(f.oldSalary * FA_COMP[f.rank] / 100) * 100)}</button>
                <div class="muted small">または人的補償（${E(to.short)}の選手を1人）：</div>
                <div class="comp-grid">${f.compCands.map(id => { const c = s.findPlayer(id); return c ? `<div class="comp-c">${playerLine(c)}<button class="btn-sm" data-act="comp" data-id="${f.id}" data-k="${c.id}">この選手をもらう</button></div>` : ''; }).join('')}</div></div>`;
            } else if (f.comp) body += `<div class="muted small">補償：${f.comp === 'money' ? '金銭補償を受け取った' : `${E((s.findPlayer(f.comp) || {}).name || '')}を獲得`}</div>`;
            else body += '<div class="muted small">Cランクなので補償なし</div>';
          }
          return `<div class="fa-out"><div><span class="rank-tag ${f.overseas ? 'rMLB' : `r${f.rank}`}">${f.overseas ? '海外FA' : `${f.rank}ランク`}</span>${playerLine(p)}${abil(p)}<div class="p-meta">今の年俸 ${Util.money(f.oldSalary)}</div></div>${body}</div>`;
        }).join('') : '<p class="empty-note">今年、FA宣言した選手はいません。</p>'}
      </div>
      ${(o.mlbOut || []).length ? `<div class="card"><h2 class="card-title">今オフ、メジャーへ渡った選手</h2>
        <ul class="off-list">${o.mlbOut.map(m => `<li><b>${E(m.name)}</b>（${E(m.team)}・${E(m.pos)}・総合${Util.rankOf(m.overall)}）が海外FA権を行使してメジャーリーグへ</li>`).join('')}</ul>
        <p class="muted small" style="margin:6px 0 0">ライバル球団の主力が抜けた。今がチャンスかも。</p></div>` : ''}
      <div class="card"><h2 class="card-title">他球団のFA選手</h2>
        <p class="muted small" style="margin:0 0 10px">他球団からFA宣言した選手。条件を上乗せするほど来てくれやすい。A・Bランクの選手を取ると、元の球団に補償金を払う。交渉は1人1回まで。</p>
        <div class="fa-grid">${o.faIn.map(f => {
          const p = s.findPlayer(f.id);
          if (!p) return '';
          const from = f.team === 'mlb' ? { name: 'メジャーリーグから日本球界に復帰（どこにも所属していないので補償なし）' } : s.league.team(f.team) || s.league2.team(f.team);
          let body;
          if (f.status === 'won') body = '<span class="tag-now">獲得</span>';
          else if (f.status === 'lost') body = '<span class="park-lock">他球団へ</span>';
          else body = [0, 1, 2].map(i => { const c = s.faInCost(f, i); return `<button class="btn-sm ${i ? 'go' : ''}" data-act="faBid" data-id="${f.id}" data-k="${i}" ${s.finance.funds < c.now || s.rosterFull ? 'disabled' : ''}>${['希望どおり', '2割上乗せ', '4割上乗せ'][i]}：年俸${Util.money(c.salary)}・${Math.round(s.faInChance(f, i) * 100)}%</button>`; }).join('');
          const c0 = s.faInCost(f, 0);
          return `<div class="fa"><span class="rank-tag ${f.team === 'mlb' ? 'rMLB' : `r${f.rank}`}">${f.team === 'mlb' ? 'メジャー帰り' : `${f.rank}ランク`}</span>${playerLine(p)}<div class="p-meta">${E(from ? from.name : '')}</div>${abil(p)}
            <div class="muted small">契約金 年俸の半分${c0.comp ? `＋補償金 ${Util.money(c0.comp)}` : ''}（今払う）</div>
            <div class="bid-buttons">${body}</div></div>`;
        }).join('') || '<p class="empty-note">他球団からのFA宣言はありません。</p>'}</div>
      </div>
      <div class="row-actions"><button class="btn btn-main" data-act="offNext">現役ドラフトへ進む</button><span class="muted small">返事をしていない自チームの選手は残留、補償を選んでいなければ金銭補償になる</span></div>`;
    }

    if (o.step === 'genyaku') {
      const g = o.genyaku;
      if (!g.done) {
        const mine = s.team.players.filter(p => s.genyakuEligible(p)).sort((a, b) => a.value - b.value);
        html += `<div class="card"><h2 class="card-title">現役ドラフトのしくみ</h2>
          <ol class="rules-list">
            <li>各球団が、他球団に出してもいい選手を<b>2人</b>リストに載せる（年俸${Util.money(GENYAKU_SALARY_LIMIT)}以上・今年の新人・FAで取った選手は載せられない）</li>
            <li>他球団のリストから、欲しい選手を<b>1人</b>選ぶ</li>
            <li>リストの選手が<b>いちばん多く希望された球団</b>から指名。そのあとは、選手を取られた球団が次に指名する</li>
            <li>両リーグの<b>12球団すべて</b>が<b>必ず1人取って、1人出す</b>。出場機会の少ない選手に新しいチャンスを与えるしくみ</li>
          </ol></div>
        <div class="card"><h2 class="card-title">① リストに載せる選手（${g.myList.length}/2人）</h2>
          <div class="gy-grid">${mine.map(p => `<button class="gy ${g.myList.includes(p.id) ? 'on' : ''}" data-act="gyToggle" data-id="${p.id}" aria-pressed="${g.myList.includes(p.id)}">${playerLine(p)}<span class="p-meta">年俸 ${Util.money(p.salary)}${p.starter ? '・スタメン' : ''}</span></button>`).join('')}</div>
        </div>
        <div class="card"><h2 class="card-title">② 他球団（11球団）のリストから欲しい選手を1人</h2>
          ${[[s.leagueName, s.league.opponents], [s.league2Name, s.league2.teams]].map(([lname, teams]) => `<h3 class="plan-sub">${E(lname)}</h3>
          <div class="gy-teams">${teams.filter(t => g.lists[t.id]).map(t => `<div class="gy-team"><div class="gy-team-name"><span class="tdot" style="background:${t.color}"></span>${E(t.name)}</div>
            ${g.lists[t.id].map(id => { const p = s.findPlayer(id); return p ? `<button class="gy ${g.myWant === id ? 'on' : ''}" data-act="gyWant" data-id="${id}" aria-pressed="${g.myWant === id}">${playerLine(p)}${abil(p)}</button>` : ''; }).join('')}</div>`).join('')}</div>`).join('')}
        </div>
        <div class="row-actions"><button class="btn btn-main" data-act="gyRun" ${g.myList.length === 2 && g.myWant ? '' : 'disabled'}>現役ドラフトを行う</button>
          ${g.myList.length === 2 && g.myWant ? '' : '<span class="muted small">リスト2人と、欲しい選手1人を選んでください</span>'}</div>`;
      } else {
        html += `<div class="card"><h2 class="card-title">現役ドラフトの結果（指名順）</h2>
          <ul class="news open">${g.results.map((r, i) => `<li class="${r.to === s.team.id || r.from === s.team.id ? 'mine' : ''}"><span class="nt ${r.to === s.team.id ? 'grow' : 'move'}">${i + 1}番目</span>
            <span><b>${E(r.toName)}</b> が <b>${E(r.name)}</b>（${E(r.pos)}・${Util.rankOf(r.overall)}）を指名 ← ${E(r.fromName)}${r.wanted ? '' : '<span class="muted small">（希望の選手は先に取られた）</span>'}</span></li>`).join('')}</ul>
        </div>
        <div class="row-actions"><button class="btn btn-main" data-act="offNext">契約更改をして${s.season + 1}年シーズンへ</button></div>`;
      }
    }
    return html;
  },

  // ③ 補強
  renderMarket() {
    const s = game;
    const full = s.team.players.length >= s.rules.maxRoster;
    const abil = p => p.isPitcher
      ? `<span><span class="velo">${p.stats.velocity}</span>球速</span><span>${Util.rankBadge(p.stats.control, 'sm')}制球</span><span>${Util.rankBadge(p.stats.stamina, 'sm')}スタミナ</span><span>${Util.rankBadge(p.stats.breaking, 'sm')}変化球</span>`
      : `<span>${Util.rankBadge(p.stats.contact, 'sm')}ミート</span><span>${Util.rankBadge(p.stats.power, 'sm')}パワー</span><span>${Util.rankBadge(p.stats.speed, 'sm')}走力</span><span>${Util.rankBadge(p.stats.defense, 'sm')}守備</span>`;
    const faCard = p => {
      const fee = s.signingFee(p);
      const can = !full && s.finance.funds >= fee;
      return `<div class="fa">
        <div class="fa-top"><div><div class="fa-name">${condIcon(p.condition)} ${E(p.name)}</div><div class="p-meta">${posLabel(p)}・${p.age}歳・伸びしろ ${Util.rankOf(p.potential)}</div></div>${Util.rankBadge(p.overall)}</div>
        <div class="abil">${abil(p)}</div>
        <div class="fa-money"><div><small class="muted">年俸</small><b>${Util.money(p.salary)}</b></div><div><small class="muted">契約金（今払う）</small><b>${Util.money(fee)}</b></div></div>
        <button class="btn-sm go" data-act="sign" data-id="${p.id}" ${can ? '' : 'disabled'}>${full ? '登録枠がいっぱい' : s.finance.funds < fee ? '資金が足りない' : '獲得する'}</button>
      </div>`;
    };

    const mine = s.team.players.find(p => p.id === this.trade.mine);
    const theirsOwner = s.league.opponents.find(t => t.players.some(p => p.id === this.trade.theirs));
    const theirs = theirsOwner && theirsOwner.players.find(p => p.id === this.trade.theirs);
    const react = s.tradeReaction(mine, theirs);
    const label = p => `${p.name}（${p.isPitcher ? p.role : p.position}・${p.age}歳・総合${p.rank}${p.overall}・年俸${Util.money(p.salary)}）`;

    $('view-market').innerHTML = `
      <div class="view-head"><h1 class="view-title">補強</h1>
        <div class="view-sub">資金 ${Util.money(s.finance.funds)} ／ 登録 ${s.team.players.length}/${s.rules.maxRoster}人 ／ 年俸は1試合ごとに10分の1ずつ払う</div></div>
      ${this.marketMsg ? `<div class="msg ${this.marketMsg.ok ? '' : 'ng'}">${E(this.marketMsg.text)}</div>` : ''}
      ${this.tradeOfferHTML(abil)}
      ${this.staffHTML()}
      <h2 class="section-title">FA市場</h2>
      <p class="muted small" style="margin:0">契約金をその場で払い、年俸が毎試合の支出に加わる。3試合ごとに顔ぶれが入れ替わる。</p>
      <div class="fa-grid">${s.fa.map(faCard).join('') || '<p class="empty-note">今はFA選手がいません。</p>'}</div>

      <div class="card trade">
        <h2 class="card-title">トレード（今シーズン残り${s.tradesLeft}回）</h2>
        <div class="trade-row">
          <label>出す選手<select id="tradeMine"><option value="">選んでください</option>
            ${s.team.players.map(p => `<option value="${p.id}" ${p.id === this.trade.mine ? 'selected' : ''}>${E(label(p))}</option>`).join('')}</select></label>
          <span class="arrow" aria-hidden="true">⇄</span>
          <label>ほしい選手<select id="tradeTheirs"><option value="">選んでください</option>
            ${s.league.opponents.map(t => `<optgroup label="${E(t.name)}">${[...t.players].sort((a, b) => b.overall - a.overall).map(p => `<option value="${p.id}" ${p.id === this.trade.theirs ? 'selected' : ''}>${E(label(p))}</option>`).join('')}</optgroup>`).join('')}</select></label>
        </div>
        <div class="trade-compare">${[['出す選手', mine], ['ほしい選手', theirs]].map(([lab, p]) => `<div class="tc ${p ? '' : 'empty'}">
          <div class="tc-label">${lab}</div>
          ${p ? `<div class="p-name">${condIcon(p.condition)} ${E(p.name)} ${Util.rankBadge(p.overall)}</div>
            <div class="p-meta">${posLabel(p)}・${p.age}歳・伸びしろ ${Util.rankOf(p.potential)}・年俸 ${Util.money(p.salary)}</div>
            <div class="abil">${abil(p)}</div>` : '<div class="muted small">選んでください</div>'}
        </div>`).join('')}</div>
        <div class="react">${react ? `<span class="muted">${E(theirsOwner.short)}の反応</span><span class="react-msg ${react.level}">${E(react.text)}</span>` : '<span class="muted">選手を選ぶと、相手の反応がわかる</span>'}
          <button class="btn-sm go" data-act="trade" ${react && react.p && s.tradesLeft > 0 ? '' : 'disabled'}>交渉する</button></div>
        <p class="muted small" style="margin:0">相手は能力・若さ・伸びしろ・年俸・調子を見て決める。年俸の高いベテランは喜ばれにくい。</p>
      </div>`;
  },

  // 資金繰り：今シーズンの見通しと、銀行からの借入
  cashHTML() {
    const s = game, f = s.finance, c = s.cashForecast, loan = s.loan || 0;
    const steps = [5000, 10000];
    const warn = c.afterOff < 0 ? '<div class="alert">このままだと、来季の開幕時に資金がマイナスになる見込み。チケット料金・年俸・投資を見直すか、借入を考えよう。</div>' : '';
    return `<div class="card cash">
      <h2 class="card-title">資金繰り</h2>
      ${warn}
      <div class="cash-flow">
        <div><span>今の資金</span><b class="${f.funds < 0 ? 'bad' : ''}">${Util.money(f.funds)}</b></div>
        <div class="op">+</div>
        <div><span>1試合の収支 × 残り${c.left}試合</span><b class="${c.perGame >= 0 ? 'good' : 'bad'}">${Util.signedMoney(c.perGame)} × ${c.left}</b></div>
        <div class="op">=</div>
        <div><span>シーズン終了時（見込み）</span><b class="${c.seasonEnd < 0 ? 'bad' : ''}">${Util.money(c.seasonEnd)}</b></div>
      </div>
      <dl class="kv">
        <div><dt>今季の黒字（見込み）にかかる法人税 ${Math.round(s.diff.tax * 100)}%</dt><dd class="num ${c.tax ? 'bad' : ''}">${c.tax ? `-${Util.money(c.tax)}` : 'なし（赤字・トントン）'}</dd></div>
        <div><dt>オフの固定費（キャンプ・2軍運営・職員）</dt><dd class="num bad">-${Util.money(s.diff.offFixed)}</dd></div>
        ${s.diff.support ? `<div><dt>オフに親会社から入る支援金（難易度「${s.diff.name}」）</dt><dd class="num good">+${Util.money(s.diff.support)}</dd></div>` : ''}
        <div><dt>来季の開幕時の資金（見込み）</dt><dd class="num ${c.afterOff < 0 ? 'bad' : 'good'}">${Util.money(c.afterOff)}${loan ? `<br><small class="muted">借入${Util.money(loan)}を除くと ${Util.money(c.afterOff - loan)}</small>` : ''}</dd></div>
        <div><dt>年俸（選手${Util.money(s.team.payroll)}＋首脳陣${Util.money(s.staffPayroll)}）${s.diff.payroll < 1 ? `<br><small class="muted">うち${Math.round((1 - s.diff.payroll) * 100)}%は親会社が負担（難易度「${E(s.diff.name)}」）</small>` : ''}</dt><dd class="num">年 ${Util.money(s.totalPayroll)}${s.diff.payroll < 1 ? `<br><small>球団の負担 ${Util.money(s.costPayroll)}</small>` : ''}</dd></div>
      </dl>
      <div class="loan">
        <div class="loan-head"><span>銀行からの借入</span><b class="num ${loan ? 'bad' : ''}">${Util.money(loan)}<small> / 上限 ${Util.money(LOAN_MAX)}</small></b></div>
        <p class="muted small" style="margin:0">利息は1試合ごとに${(s.loanRate * 100).toFixed(2)}%${s.finance.hasPerk('loan') ? '（メインバンクの特典で半分）' : ''}${loan ? `（今は1試合 ${Util.money(c.interest)}）` : ''}。シーズン終了時に借金が残っているとオーナー評価-3%。開幕前に資金がマイナスなら自動で緊急融資を受けるが、上限を超える・オーナー評価20%未満で借りられないと解任。</p>
        <div class="row-actions">
          ${steps.map(a => `<button class="btn-sm" data-act="borrow" data-k="${a}" ${loan >= LOAN_MAX ? 'disabled' : ''}>${Util.money(a)}借りる</button>`).join('')}
          ${loan ? steps.map(a => `<button class="btn-sm go" data-act="repay" data-k="${a}" ${f.funds < Math.min(a, loan) ? 'disabled' : ''}>${Util.money(Math.min(a, loan))}返す</button>`).join('') : ''}
          ${loan ? `<button class="btn-sm go" data-act="repay" data-k="${loan}" ${f.funds < loan ? 'disabled' : ''}>全額返す</button>` : ''}
        </div>
      </div>
    </div>`;
  },

  // 首脳陣（監督・コーチ）：今の顔ぶれと効果、招へいできる候補
  staffHTML() {
    const s = game, e = s.staffEffect;
    const sg = x => (x > 0 ? `+${x}` : x < 0 ? `${x}` : '±0');
    const pct = x => sg(Math.round((x - 1) * 100)) + '%';
    const L = r => Math.round(staffLevel(s.staff[r]) * 10) / 10;
    const effect = (role, st) => {
      const l = st ? Math.round(staffLevel(st) * 10) / 10 : L(role);
      switch (role) {
        case 'manager': return `打者・投手 ${sg(Math.round(l * 5) / 10)}${st && st.style ? `　得意：${STRATEGIES[st.style].name}${st.style === s.strategy ? '（方針と一致 +1）' : ''}` : ''}`;
        case 'batting': return `打者 ${sg(l)}・野手の成長 ${pct(Math.max(0.6, 1 + l * 0.12))}`;
        case 'pitching': return `投手 ${sg(l)}・投手の成長 ${pct(Math.max(0.6, 1 + l * 0.12))}`;
        case 'fielding': return `守備 ${sg(Math.round(l * 20) / 10)}${st && st.ability >= 70 ? '・走塁◎' : ''}`;
        default: return `若手・育成の成長 ${pct(Math.max(0.6, 1 + l * 0.12))}`;
      }
    };
    const person = st => `<div class="st-name">${E(st.name)}　<span class="muted small">${st.age}歳・${E(st.trait)}</span></div>
      <div class="p-meta">${E(st.career)}</div>`;
    const cur = Object.entries(STAFF_ROLES).map(([role, R]) => {
      const st = s.staff[role];
      if (!st) return `<div class="staff vacant"><div class="st-role">${R.name}</div>
        <div class="st-name">空席<span class="muted small">（代行が指揮）</span></div><div class="st-eff bad">${effect(role, null)}</div>
        <div class="p-meta">下の候補から招へいしよう</div></div>`;
      const armed = this.armed === `fire-${role}`;
      return `<div class="staff"><div class="st-top"><span class="st-role">${R.name}</span>${Util.rankBadge(st.ability)}</div>
        ${person(st)}
        <div class="st-eff ${staffLevel(st) < 0 ? 'bad' : ''}">${effect(role, st)}</div>
        <div class="p-meta">年俸 ${Util.money(st.salary)}・残り${st.years}年${st.years <= 1 ? '<b class="warn-text">（今季で満了）</b>' : ''}</div>
        <div class="row-actions">
          <button class="btn-sm" data-act="staffExtend" data-k="${role}" ${st.years >= 4 ? 'disabled' : ''}>1年延長（年俸+10%）</button>
          <button class="btn-sm ${armed ? 'warn' : ''}" data-act="staffFire" data-k="${role}">${armed ? `本当に解任（違約金 ${Util.money(s.staffFireFee(st))}）` : '解任'}</button>
        </div></div>`;
    }).join('');
    const cands = s.staffMarket.map(c => {
      const { fee, fireFee } = s.staffHireCost(c), now = s.staff[c.role];
      return `<div class="staff cand"><div class="st-top"><span class="st-role">${STAFF_ROLES[c.role].name}候補</span>${Util.rankBadge(c.ability)}</div>
        ${person(c)}
        <div class="st-eff ${staffLevel(c) < 0 ? 'bad' : ''}">${effect(c.role, c)}</div>
        <div class="p-meta">${c.years}年契約・年俸 ${Util.money(c.salary)}・支度金 ${Util.money(fee)}</div>
        <button class="btn-sm go" data-act="staffHire" data-id="${c.id}" ${s.finance.funds < fee + fireFee ? 'disabled' : ''}>${now ? `${E(now.name)}と交代（違約金 ${Util.money(fireFee)}）` : '招へいする'}</button></div>`;
    }).join('');
    return `<h2 class="section-title">首脳陣（監督・コーチ）</h2>
      <p class="muted small" style="margin:0">指導力（ランク）が高いほど試合と成長に効く。年俸は毎試合の支出に入る（今は年 ${Util.money(s.staffPayroll)}）。解任すると残り契約の半分を違約金として払う。シーズン中に監督を代えると、オーナーと選手が反応する。</p>
      <div class="staff-sum">チーム全体の効果　打者 <b class="${e.bat < 0 ? 'bad' : ''}">${sg(e.bat)}</b>・投手 <b class="${e.pitch < 0 ? 'bad' : ''}">${sg(e.pitch)}</b>・守備 <b class="${e.def < 0 ? 'bad' : ''}">${sg(e.def)}</b>${e.run ? '・走塁◎' : ''}${e.fit ? '・監督と方針が一致' : ''}</div>
      <div class="staff-grid">${cur}</div>
      <h3 class="sub-title">招へいできる候補 <span class="muted small">（毎シーズン入れ替わる）</span></h3>
      <div class="staff-grid">${cands || '<p class="empty-note">今は候補がいません。</p>'}</div>`;
  },

  // ④ 試合
  renderGame() {
    const s = game, L = s.lastGame;
    let html = `<div class="view-head"><h1 class="view-title">試合</h1><div class="view-sub">${L ? `${L.label ? E(L.label) : `第${L.no}戦`}　${E(L.away.name)}（先攻） vs ${E(L.homeTeam.name)}（後攻）${L.home ? `　会場：${E(s.profile.stadium)}` : ''}` : 'まだ試合をしていません。ホームの「試合をする」で始まります'}</div></div>`;
    if (L) {
      const n = Math.max(9, L.board.away.length, L.board.home.length);
      const row = (team, side) => `<tr><td class="team">${E(team.short)}</td>${Array.from({ length: n }, (_, i) => L.board[side][i] === undefined ? '<td class="empty">-</td>' : `<td>${L.board[side][i]}</td>`).join('')}<td class="tot">${L.totals[side].R}</td><td>${L.totals[side].H}</td><td>${L.totals[side].E}</td></tr>`;
      html += `<div class="scoreboard-wrap"><div class="scoreboard-scroll"><table class="scoreboard">
        <thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>R</th><th>H</th><th>E</th></tr></thead>
        <tbody>${row(L.away, 'away')}${row(L.homeTeam, 'home')}</tbody></table></div></div>`;
      html += `<div class="dash-grid">
        <div class="card"><h2 class="card-title">打撃成績（${E(s.team.short)}）</h2><div class="table-scroll"><table class="box-score">
          <thead><tr><th>打順</th><th>選手</th><th class="r">打席</th><th class="r">安打</th><th class="r">本塁打</th><th class="r">打点</th><th class="r">三振</th></tr></thead><tbody>
          ${L.batting.map(b => `<tr><td>${b.order}</td><td>${E(b.name)}</td><td class="r num">${b.pa}</td><td class="r num">${b.h}</td><td class="r num">${b.hr}</td><td class="r num">${b.rbi}</td><td class="r num">${b.k}</td></tr>`).join('')}
          </tbody></table></div></div>
        <div class="card"><h2 class="card-title">投手成績（${E(s.team.short)}）</h2><div class="table-scroll"><table class="box-score">
          <thead><tr><th>投手</th><th class="r">投球回</th><th class="r">失点</th><th class="r">三振</th></tr></thead><tbody>
          ${L.pitching.map(x => `<tr><td>${E(x.name)}</td><td class="r num">${Util.innings(x.outs)}</td><td class="r num">${x.r}</td><td class="r num">${x.k}</td></tr>`).join('')}
          </tbody></table></div>
          <h2 class="card-title" style="margin-top:16px">ハイライト</h2><ul class="news">${L.highlights.map(h => `<li><span class="nt game">試合</span><span>${E(h)}</span></li>`).join('')}</ul>
        </div></div>`;
    }
    html += `<div class="card"><h2 class="card-title">今季の試合結果</h2><ul class="games-list">
      ${s.results.map(x => `<li><span class="muted">第${x.no}戦</span><span class="o ${x.outcome[0]}">${x.outcome === 'win' ? '○' : x.outcome === 'lose' ? '●' : '△'}</span><span>vs ${E(x.opponent)}（${x.home ? 'ホーム' : 'ビジター'}）</span><span class="num">${x.my} - ${x.opp}</span></li>`).join('') || '<li><span></span><span></span><span class="muted">まだ試合はありません</span><span></span></li>'}
    </ul></div>`;
    $('view-game').innerHTML = html;
  },

  // ドラフト会議（ホームの中に表示）
  draftHTML() {
    const s = game, d = s.draft;
    const ik = d.stage === 'ikusei';
    const sel = d.pool.find(p => p.id === this.draftSel);
    const myTurn = d.phase === 'bid' || (d.phase === 'pick' && s.draftTurnTeam === s.team.id);
    const title = d.phase === 'done' ? 'ドラフト会議 終了'
      : ik ? `育成ドラフト 第${d.round}巡`
      : d.round === 1 ? (d.hazure ? `1巡目 外れ${d.hazure}位 入札` : '1巡目 入札') : `第${d.round}巡 指名`;
    const mainMine = d.log.filter(l => l.mine && l.stage === 'main' && l.name !== '（指名終了）').length;
    const ikMine = d.log.filter(l => l.mine && l.stage === 'ikusei' && l.name !== '（指名終了）').length;
    let html = `<div class="draft-head"><div class="eyebrow">${s.season}年 ドラフト会議　${ik ? '育成ドラフト（育成5位まで）' : '支配下ドラフト（7位まで）'}</div><h1 class="draft-title">${title}</h1>
      <div class="draft-steps"><span class="${ik || d.phase === 'done' ? 'done' : 'now'}">支配下 ${mainMine}人指名</span><span class="${ik ? 'now' : d.phase === 'done' ? 'done' : ''}">育成 ${ikMine}人指名</span></div>
      <div class="muted small">支配下 ${s.team.players.length}/${s.rules.maxRoster}人 ／ 育成 ${s.team.farm.length}${capText(s.rules.maxFarm)} ／ 年俸 1位 ${Util.money(ROOKIE_SALARY[0])} 〜 7位 ${Util.money(ROOKIE_SALARY[6])}・育成 ${Util.money(IKUSEI_SALARY)}</div></div>`;
    if (d.phase !== 'done') {
      const st = STRATEGIES[s.strategy];
      html += `<div class="strategy-bar">
        <div><span class="muted small">チームの方針</span><div><b>${E(st.name)}</b>　<span class="muted small">ねらい目：${E(st.draft)}（◎・○の印）</span></div></div>
        <label class="select"><span>方針を変える</span><select id="draftStrategy">${Object.entries(STRATEGIES).map(([k, v]) => `<option value="${k}" ${s.strategy === k ? 'selected' : ''}>${E(v.name)}</option>`).join('')}</select></label>
      </div>`;
    }
    if (this.draftMsg) html += `<div class="msg ${this.draftMsg.ok ? '' : 'ng'}">${E(this.draftMsg.text)}</div>`;

    // 発表と抽選
    if (d.phase === 'reveal') {
      html += `<div class="card"><h2 class="card-title">${d.reveal.hazure ? `外れ${d.reveal.hazure}位` : '1巡目'} 入札結果</h2><div class="bids">
        ${d.reveal.rows.map((r, i) => `<div class="bid ${r.tid === s.team.id ? 'mine' : ''}" style="animation-delay:${i * 0.12}s">
          <span><span class="tdot" style="background:${r.color}"></span><b>${E(r.team)}</b></span>
          <span>${E(r.name)} <span class="muted small">${E(r.pos)}・${E(r.origin)}</span></span>
          <span class="st ${r.st.includes('外れ') ? 'bad' : r.st.includes('獲得') ? 'good' : ''}">${E(r.st)}</span></div>`).join('') || '<p class="empty-note">入札はありませんでした。</p>'}
      </div></div>`;
      const L = d.lot;
      if (L) {
        const done = L.choice !== null;
        const n = L.tids.length;
        const pct = Math.round(100 / n);
        const short = t => E(s.league.team(t).short);
        html += `<div class="lottery">
          <div class="eyebrow">${n}球団競合</div>
          <div class="lot-name">${E(L.name)}</div>
          <div class="muted small">${L.tids.map(t => E(s.league.team(t).name)).join('・')}</div>
          <div class="lot-odds">
            <span><b class="hit">当たり 1枚</b></span><span><b class="miss-c">はずれ ${n - 1}枚</b></span>
            <span>当たる確率 <b class="num">${pct}%</b>（${n}分の1）</span>
          </div>
          ${done ? '' : '<p class="lot-help">封筒を1枚選んでください。「交渉権確定」の印があれば当たり！ 残りの封筒は他球団が引きます。</p><div class="row-actions" style="justify-content:center"><button class="btn-sm auto-btn" data-act="draftAuto">くじも残りの指名もおまかせ</button></div>'}
          <div class="envs">${L.tids.map((_, i) => {
            if (!done) return `<button class="env" data-act="draftDraw" data-i="${i}" aria-label="封筒${i + 1}">くじ</button>`;
            const win = i === L.winEnv, mine = i === L.choice;
            return `<div class="env open ${mine ? 'mine' : ''}">${win ? '<span class="stamp">交渉権<br>確定</span>' : '<span class="miss">はずれ</span>'}<span class="who">${mine ? 'あなた' : short(L.owners[i])}</span></div>`;
          }).join('')}</div>
          ${done ? `<div class="lot-result ${L.winner === s.team.id ? 'win' : ''}">${L.winner === s.team.id ? '交渉権を獲得！' : `はずれ… ${E(s.league.team(L.winner).name)}が獲得`}</div>` : ''}
          <div class="muted small">くじ引き通算 ${s.lottery.win}勝${s.lottery.lose}敗</div>
        </div>`;
      }
      if (!L || L.choice !== null) {
        const next = d.pending.length ? (d.pending.includes(s.team.id) ? '外れ1位を入札する' : '他球団の外れ1位を見る') : '2巡目へ進む';
        html += `<div class="row-actions"><button class="btn btn-ghost auto-btn" data-act="draftAuto">残りをおまかせで指名</button><button class="btn btn-main" data-act="draftNext">${next}</button></div>`;
      }
    }

    // 指名の操作
    if (d.phase === 'bid' || d.phase === 'pick') {
      const turnTeam = d.phase === 'pick' ? s.league.team(s.draftTurnTeam) : null;
      const what = ik ? '育成' : '支配下';
      html += `<div class="draft-bar">
        <div>${d.phase === 'bid' ? '1位で入札する選手を選ぼう。他球団と重なったら抽選！' : `指名の番：<b>${E(turnTeam.name)}</b>（${s.draftLabel(d.round)}）`}
          ${sel ? `<div class="draft-sel">候補：<b>${E(sel.name)}</b>（${sel.isPitcher ? '投手' : E(sel.position)}・${E(sel.origin)}）</div>` : ''}</div>
        <div class="row-actions">
          <button class="btn btn-ghost auto-btn" data-act="draftAuto">おまかせで指名</button>
          ${d.phase === 'bid'
            ? '<button class="btn btn-ghost" data-act="draftBidSkip">支配下は指名しない</button>'
            : `<button class="btn btn-ghost" data-act="draftEnd">${what}の指名を終える</button>`}
          <button class="btn btn-main" data-act="${d.phase === 'bid' ? 'draftBid' : 'draftPick'}" ${sel ? '' : 'disabled'}>${d.phase === 'bid' ? 'この選手に入札' : `${s.draftLabel(d.round)}で指名`}</button>
        </div></div>`;
      if (s.myDraftFull) html += `<div class="msg ng">${what}の枠がいっぱいです（${ik ? `${s.rules.maxFarm}人` : `${s.rules.maxRoster}人`}）。編成タブで自由契約にすると枠が空きます。</div>`;
    }

    // スカウト部長のおすすめ
    const rec = d.phase === 'bid' || d.phase === 'pick' ? s.draftRecommend() : null;
    if (rec) {
      html += `<div class="card rec-card">
        <h2 class="card-title">スカウト部長のおすすめ</h2>
        <div class="depth"><span class="muted small">チームの主力の層</span>${Object.entries(rec.depth).map(([g, v]) => `<span class="depth-chip ${g === rec.weak ? 'weak' : ''}">${POS_GROUPS[g]} ${Util.rankBadge(v, 'sm')}${g === rec.weak ? '<span class="weak-label">▼弱点</span>' : ''}</span>`).join('')}</div>
        <div class="rec-grid">${rec.picks.map(({ p, reasons, kind }, i) => `<div class="rec ${this.draftSel === p.id ? 'picked' : ''}">
          <div class="rec-kind">${E(kind)}</div>
          <div class="rec-top"><span class="rec-no">${i + 1}</span><div><div class="p-name">${E(p.name)}${rec.bidding && rec.popular.has(p.id) ? '<span class="tag-hot">競合注意</span>' : ''}</div>
            <div class="p-meta">${posLabel(p)}・${E(p.origin)}・${E(p.school)}・${p.age}歳</div></div></div>
          <div class="rec-badges"><span>今の力 ${Util.rankBadge(p.overall, 'sm')}</span><span>伸びしろ ${Util.rankBadge(p.potential, 'sm')}</span></div>
          <ul class="rec-why">${reasons.map(r => `<li>${E(r)}</li>`).join('')}</ul>
          ${myTurn ? `<button class="btn-sm ${this.draftSel === p.id ? 'go' : ''}" data-act="draftSel" data-id="${p.id}">${this.draftSel === p.id ? '選択中' : 'この選手を候補にする'}</button>` : ''}
        </div>`).join('')}</div>
      </div>`;
    }

    // 候補選手
    if (d.phase !== 'done') {
      const fit = STRATEGIES[s.strategy].fit;
      const score = { fit, total: p => p.overall * 0.5 + p.potential * 0.6, now: p => p.overall, pot: p => p.potential }[this.draftSort];
      const list = d.pool.filter(p => this.draftFilter === 'all' || posGroup(p) === this.draftFilter).sort((a, b) => score(b) - score(a));
      const count = g => d.pool.filter(p => g === 'all' || posGroup(p) === g).length;
      // 方針に合う選手：残り候補の上位8人が◎、次の8人が○
      const ranked = [...d.pool].sort((a, b) => fit(b) - fit(a)).map(p => p.id);
      const mark = p => { const i = ranked.indexOf(p.id); return i < 8 ? '<span class="fit fit2" title="方針にぴったり">◎</span>' : i < 16 ? '<span class="fit fit1" title="方針に合う">○</span>' : ''; };
      html += `<div class="toolbar">
        <div class="chips" role="group" aria-label="表示する候補">${[['all', '全員'], ...Object.entries(POS_GROUPS)].map(([k, l]) => `<button class="chip" data-act="draftFilter" data-k="${k}" aria-pressed="${this.draftFilter === k}">${l}<span class="chip-count">${count(k)}</span></button>`).join('')}</div>
        <label class="select"><span>並び順</span><select id="draftSort">${[['fit', '方針に合う順'], ['total', '総合評価'], ['now', '今の力'], ['pot', '伸びしろ']].map(([k, l]) => `<option value="${k}" ${this.draftSort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <span class="muted small">残り候補 ${d.pool.length}人</span>
      </div>
      <div class="table-card"><div class="table-scroll"><table class="roster">
        <thead><tr><th>選手</th><th>区分・所属</th><th>ポジション</th><th class="c">今の力</th><th class="c">伸びしろ</th><th>能力</th><th></th></tr></thead><tbody>
        ${list.map(p => `<tr class="${this.draftSel === p.id ? 'picked' : ''}">
          <td><div class="p-name">${mark(p)}${E(p.name)}${rec && rec.bidding && rec.popular.has(p.id) ? '<span class="tag-hot">人気</span>' : ''}</div><div class="p-meta">${p.age}歳・${p.throws}投${p.bats}打</div></td>
          <td>${E(p.origin)}<div class="p-meta">${E(p.school)}</div></td>
          <td>${posLabel(p)}</td>
          <td class="c">${Util.rankBadge(p.overall)}</td><td class="c">${Util.rankBadge(p.potential)}</td>
          <td><div class="abil">${p.isPitcher
            ? `<span><span class="velo">${p.stats.velocity}</span>球速</span><span>${Util.rankBadge(p.stats.control, 'sm')}制球</span><span>${Util.rankBadge(p.stats.breaking, 'sm')}変化球</span>`
            : `<span>${Util.rankBadge(p.stats.contact, 'sm')}ミート</span><span>${Util.rankBadge(p.stats.power, 'sm')}パワー</span><span>${Util.rankBadge(p.stats.speed, 'sm')}走力</span>`}</div></td>
          <td>${myTurn ? `<button class="btn-sm ${this.draftSel === p.id ? 'go' : ''}" data-act="draftSel" data-id="${p.id}">${this.draftSel === p.id ? '選択中' : '選ぶ'}</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    }

    // 指名結果
    if (d.phase === 'done') {
      const mine = d.log.filter(l => l.mine && l.name !== '（指名終了）');
      html += `<div class="card"><h2 class="card-title">${E(s.team.name)}の指名選手（${mine.length}人）</h2><ul class="news open">
        ${mine.map(l => `<li><span class="nt ${l.stage === 'ikusei' ? 'cond' : 'grow'}">${E(l.label)}</span><span><b>${E(l.name)}</b> ${E(l.pos)}　<span class="muted">${E(l.origin)}</span></span></li>`).join('') || '<li><span class="nt grow">-</span><span>指名した選手はいません</span></li>'}
      </ul><p class="muted small" style="margin:10px 0 0">支配下の新人は控えからスタート。育成選手は2軍で練習して育ち、力がついたら編成画面で「支配下登録」すると試合に出られる。</p>
      <div class="row-actions"><button class="btn btn-main" data-act="finishDraft">${s.season + 1}年シーズンへ</button></div></div>`;
    }
    const log = [...d.log].reverse();
    html += `<div class="card"><h2 class="card-title">指名一覧（${d.log.filter(l => l.name !== '（指名終了）').length}人）</h2><ul class="news draft-log">
      ${log.map(l => `<li class="${l.mine ? 'mine' : ''}"><span class="nt ${l.stage === 'ikusei' ? 'cond' : l.mine ? 'grow' : 'move'}">${E(l.label)}</span><span><span class="tdot" style="background:${l.color}"></span>${E(l.team)}：<b>${E(l.name)}</b> ${E(l.pos)}</span></li>`).join('') || '<li><span class="nt move">-</span><span>まだ指名はありません</span></li>'}
    </ul></div>`;
    return html;
  },

  // ⑤ 経営
  renderOffice() {
    const s = game, f = s.finance;
    const b = f.breakdown({ payroll: s.costPayroll, gamesPerSeason: s.rules.gamesPerSeason });
    const r = f.lastReport, react = f.reaction();
    const msg = this.officeMsg ? `<div class="msg ${this.officeMsg.ok ? '' : 'ng'}">${E(this.officeMsg.text)}</div>` : '';
    const viewHead = (t, sub) => `<div class="view-head"><h1 class="view-title">${t}</h1><div class="view-sub">${sub}</div></div>${msg}`;
    // 経営：チケット・収支・資金繰り・投資
    $('view-office').innerHTML = `
      ${viewHead('経営', 'チケット料金・資金繰り・投資で球団のお金をやりくりする')}
      <div class="office">
        <div class="card">
          <h2 class="card-title">チケット料金</h2>
          <div class="price"><span class="price-value num" id="priceValue">${f.ticketPrice.toLocaleString()}</span><span class="price-unit">円 / 1枚</span></div>
          <input type="range" id="ticketPrice" min="0" max="1000" step="1" value="${ticketToPos(f.ticketPrice)}" aria-label="チケット料金">
          <div class="range-scale three"><span>1,000円<br><small>ファンが増えやすい</small></span><span>6,000円<br><small>ここから先はプレミア価格</small></span><span>100,000円<br><small>ほとんど売れない</small></span></div>
          <label class="price-input"><span>金額を入力</span><input type="number" id="ticketPriceNum" min="${TICKET_MIN}" max="${TICKET_MAX}" step="100" value="${f.ticketPrice}" inputmode="numeric">円</label>
          <dl class="kv">
            <div><dt>来場者数（見込み）</dt><dd class="num" id="estAttendance">${b.attendance.toLocaleString()}人 / ${f.capacity.toLocaleString()}人</dd></div>
            <div><dt>1試合の収支（見込み）</dt><dd class="num ${b.net >= 0 ? 'good' : 'bad'}" id="estNet">${Util.signedMoney(b.net)}</dd></div>
            <div><dt>ファンの反応</dt><dd id="estReaction" class="${react.cls}">${react.text}</dd></div>
          </dl>
        </div>
        <div class="card">
          <h2 class="card-title">前の試合の収支</h2>
          ${r ? `<dl class="report">
            <div><dt>チケット（${r.attendance.toLocaleString()}人 × ${r.price.toLocaleString()}円）</dt><dd class="good">+${Util.money(r.income.ticket)}</dd></div>
            <div><dt>グッズ・飲食</dt><dd class="good">+${Util.money(r.income.goods)}</dd></div>
            <div><dt>スポンサー（1試合分）</dt><dd class="good">+${Util.money(r.income.sponsor)}</dd></div>
            ${r.income.media ? `<div><dt>放映権・配信（ファン${r.fansBefore.toLocaleString()}人分）</dt><dd class="good">+${Util.money(r.income.media)}</dd></div>` : ''}
            ${r.income.channel ? `<div><dt>公式チャンネルの広告収入</dt><dd class="good">+${Util.money(r.income.channel)}</dd></div>` : ''}
            <div><dt>年俸（選手・首脳陣の1試合分${game.diff.payroll < 1 ? `、親会社の負担を引いた額` : ""}）</dt><dd class="bad">-${Util.money(r.expense.salary)}</dd></div>
            <div><dt>運営費（球場・遠征・スタッフ）</dt><dd class="bad">-${Util.money(r.expense.operation)}</dd></div>
            ${r.expense.show ? `<div><dt>興行経費（売上の原価・手数料・警備など）</dt><dd class="bad">-${Util.money(r.expense.show)}</dd></div>` : ''}
            ${r.expense.facility ? `<div><dt>施設・設備の維持費</dt><dd class="bad">-${Util.money(r.expense.facility)}</dd></div>` : ''}
            ${r.interest ? `<div><dt>借入金の利息</dt><dd class="bad">-${Util.money(r.interest)}</dd></div>` : ''}
            <div class="total"><dt>収支</dt><dd class="${r.net >= 0 ? 'good' : 'bad'}">${Util.signedMoney(r.net)}</dd></div>
          </dl>` : '<p class="empty-note">まだ試合をしていません。</p>'}
        </div>
      </div>
      ${this.cashHTML()}
      <div class="card">
        <h2 class="card-title">投資</h2>
        <p class="muted small" style="margin:0 0 10px">お金を使って球団を強くする。すぐには元が取れないが、シーズンをまたいで効いてくる。<br>
          ・上のレベルほど割高（Lv.4はオーナー評価${FACILITY_OWNER[4]}以上、Lv.5は${FACILITY_OWNER[5]}以上の承認がいる）<br>
          ・工事は1つずつ、${FACILITY_BUILD}試合かかる（オフに始めれば開幕までに完成）<br>
          ・施設はレベル1つにつき毎試合${Util.money(FACILITY_UPKEEP)}、最新設備は1つ${Util.money(EQUIPMENT_UPKEEP)}の維持費（今は1試合 ${Util.money(f.upkeep)}）</p>
        ${s.building ? `<div class="msg">工事中：${FACILITIES[s.building.key].name} Lv.${s.facilities[s.building.key] + 1}（あと${s.building.left}試合で完成）</div>` : ''}
        <div class="fac-grid">${Object.entries(FACILITIES).map(([k, d]) => {
          const lv = s.facilities[k], max = lv >= FACILITY_MAX, cost = d.cost(lv), lock = s.investLock(k);
          const building = s.building && s.building.key === k;
          return `<div class="fac ${building ? 'building' : ''}">
            <div class="fac-name">${d.name}　<span class="muted small">Lv.${lv}${building ? '（工事中）' : ''}</span></div>
            <div class="lv">${Array.from({ length: FACILITY_MAX }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div>
            <div class="eff">${d.effect(lv)}</div>
            <div class="muted small">${d.desc}${max ? '' : `<br>次のレベル：${d.effect(lv + 1)}`}</div>
            <button class="btn-sm go" data-act="invest" data-k="${k}" ${lock ? `disabled title="${E(lock)}"` : ''}>${max ? '最大レベル' : building ? `工事中（あと${s.building.left}試合）` : `投資する（${Util.money(cost)}）`}</button>
            ${lock && !max && !building ? `<div class="muted small lock-why">${E(lock)}</div>` : ''}
          </div>`;
        }).join('')}</div>
      </div>
      <div class="card">
        <h2 class="card-title">最新設備</h2>
        <p class="muted small" style="margin:0 0 10px">メーカーや地域からの「導入しませんか？」の話に乗ると手に入る（ホームの「GMの決断」で出てくる）。一度入れればずっと効くが、1つにつき毎試合${Util.money(EQUIPMENT_UPKEEP)}の保守費がかかる。${s.itnavPartner ? '<b class="warn-text" style="color:var(--lamp)">ITパートナーの企業と契約中：導入費2割引き</b>' : 'ITパートナーの企業と契約を結ぶと導入費が2割引きになる。'}</p>
        <div class="equip-grid">${Object.entries(EQUIPMENT).map(([k, d]) => `<div class="equip ${s.equipment.includes(k) ? 'on' : ''}">
          <b>${d.name}</b><span class="muted small">${d.effect}</span><span class="eq-state">${s.equipment.includes(k) ? '導入済み' : '未導入'}</span></div>`).join('')}</div>
      </div>
`;
    // 営業：ファン・スポンサー・ネーミングライツ・公式チャンネル
    $('view-sales').innerHTML = `
      ${viewHead('営業', 'ファンを増やし、スポンサーやネーミングライツで収入を広げる')}
      <div class="office">
        <div class="card"><h2 class="card-title">ファン</h2>
          <div class="price"><span class="price-value num">${f.fans.toLocaleString()}</span><span class="price-unit">人</span></div>
          <dl class="kv"><div><dt>今季のファン増減</dt><dd class="num">${Util.signed(f.fans - s.seasonStart.fans)}人</dd></div></dl></div>
        <div class="card"><h2 class="card-title">スポンサー（契約中）</h2>
          <ul class="sponsors">${f.sponsors.map(sp => `<li><span><span class="tier">${E(sp.tier)}</span>${E(sp.name)}${sponsorPerk(sp) ? `<small class="perk-mini">特典：${E(SPONSOR_PERKS[sponsorPerk(sp)])}</small>` : ''}</span><span><span class="num">${Util.money(sp.amount)}</span><span class="muted small">　残り${sp.years}年</span></span></li>`).join('') || '<li>スポンサーがいません。営業しよう</li>'}</ul>
          <dl class="kv"><div><dt>スポンサー収入（シーズン合計・球場の倍率×${f.park.sponsor}込み）</dt><dd class="num">${Util.money(f.sponsorTotal)}</dd></div></dl></div>
      </div>
      ${this.salesHTML()}
      ${this.namingHTML()}
      ${this.channelHTML()}
`;
    // 球団：本拠地・ユニフォーム・難易度・セーブ
    $('view-club').innerHTML = `
      ${viewHead('球団', '本拠地とユニフォーム、球団の歴史、ゲームの設定とセーブ')}
      ${this.stadiumHTML()}
      ${this.uniformHTML()}
      ${this.historyHTML()}
      <div class="card">
        <h2 class="card-title">難易度</h2>
        <p class="muted small" style="margin:0 0 10px">いつでも変えられる。試合での後押し・選手の成長の速さ・負けたときのオーナーの厳しさ・法人税・オフの固定費が変わる（はじめの戦力と資金は、始めるときの難易度で決まる）。</p>
        <div class="diff-opts">${Object.entries(DIFFICULTY).map(([k, d]) => `<button class="diff-opt ${game.diff === d ? 'on' : ''}" data-act="difficulty" data-k="${k}" aria-pressed="${game.diff === d}"><b>${d.name}</b><span>${d.desc}</span></button>`).join('')}</div>
      </div>
      <div class="card">
        <h2 class="card-title">セーブ</h2>
        <p class="muted small" style="margin:0 0 10px">いまは<b>スロット${Save.slot}</b>に自動で保存しています${Save.lastSaved ? `（最終保存 ${new Date(Save.lastSaved).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}）` : ''}。セーブは3つまで。別の端末やブラウザには引き継がれません。</p>
        <div class="save-slots">${Save.slots().map(n => {
          const m = Save.summary(n), cur = n === Save.slot, key = `copy-${n}`;
          return `<div class="slot ${cur ? 'cur' : ''} ${m ? '' : 'empty'}"><div class="slot-no">スロット${n}${cur ? '（遊んでいるデータ）' : ''}</div>
            ${m ? `<div class="small"><span class="tdot" style="background:${E(m.color)}"></span>${E(m.team)}　${m.season}年 ${E(m.when)}</div>` : '<div class="muted small">データなし</div>'}
            ${cur ? '' : `<button class="btn-sm ${this.armed === key ? 'warn' : ''}" data-act="saveCopy" data-k="${n}">${m ? (this.armed === key ? '本当に上書きする' : 'ここに上書き保存') : 'ここにも保存'}</button>`}</div>`;
        }).join('')}</div>
        <div class="row-actions">
          <button class="btn-sm" data-act="toTitle">タイトルに戻る</button>
          <button class="btn-sm ${this.armed === 'wipe' ? 'warn' : ''}" data-act="wipe">${this.armed === 'wipe' ? '本当に消す（元に戻せません）' : 'セーブを消して最初から'}</button>
        </div>
      </div>`;
  },
  // スポンサー営業
  salesHTML() {
    const s = game;
    return `<div class="card">
      <div class="row-actions" style="justify-content:space-between"><h2 class="card-title" style="margin:0">スポンサー営業</h2>
        <span class="muted small">今シーズンの営業 残り <b class="num">${s.salesLeft}</b>回（営業部Lv.${s.facilities.sales}）</span></div>
      <p class="muted small" style="margin:6px 0 10px">営業費を払って企業に提案する。成功率はファン数・オーナー評価・順位・営業部で変わる。「控えめ」なら金額は2割減るが通りやすく、「強気」なら金額は25%増えるが断られやすい。特典つきの会社もある（契約中だけ効く）。営業先はシーズンごとに6社入れ替わる。</p>
      ${this.salesMsg ? `<div class="msg ${this.salesMsg.ok ? '' : 'ng'}" style="margin-bottom:10px">${E(this.salesMsg.text)}</div>` : ''}
      <div class="fa-grid">${s.offers.map(o => {
        const c = s.offerDef(o);
        if (!c) return '';
        const lock = s.salesLock(c), pct = Math.round(s.salesChance(c) * 100);
        const can = s.salesLeft > 0 && s.finance.funds >= c.cost;
        const btn = o.status === 'ok' ? '<span class="tag-now">契約成立</span>'
          : o.status === 'ng' ? '<span class="park-lock">断られた（今シーズンは終了）</span>'
          : lock ? `<span class="park-lock">${E(lock)}</span>`
          : `<div class="muted small">営業費 ${Util.money(c.cost)}・提案のしかたを選ぶ</div><div class="sales-modes">${SALES_MODES.map((m, i) => {
              const cp = Math.round(Util.clamp(s.salesChance(c) + m.chance, 0.05, 0.97) * 100);
              return `<button class="btn-sm ${i === 1 ? 'go' : ''}" data-act="sales" data-k="${E(c.name)}" data-i="${i}" ${can ? '' : 'disabled'}><b>${m.short}</b><span>年${Util.money(Math.round(c.amount * m.amount / 100) * 100)}</span><span>成功${cp}%</span></button>`;
            }).join('')}</div>`;
        return `<div class="fa">
          <div class="fa-top"><div><div class="fa-name">${E(c.name)}</div><div class="p-meta">${E(c.tier)}${c.naming ? '（球場名が変わる）' : ''}</div></div></div>
          ${c.perk ? `<div class="perk">特典：${E(c.perk)}</div>` : ''}
          <div class="fa-money"><div><small class="muted">金額 / 年</small><b>${Util.money(c.amount)}</b></div><div><small class="muted">契約</small><b>${c.years}年</b></div></div>
          <div class="chance"><span class="muted small">成功率</span><span class="meter"><i style="width:${pct}%"></i></span><b class="num">${pct}%</b></div>
          ${btn}
        </div>`;
      }).join('')}</div>
    </div>`;
  },

  // ユニフォーム：今のデザインと、デザインを変えるボタン
  uniformHTML() {
    const s = game, u = s.profile.uniform, hype = s.finance.uniformHype || 0;
    const ace = s.team.players[0];
    return `<div class="card"><h2 class="card-title">ユニフォーム</h2>
      <div class="uni-now">${uniformSVG(u, ace ? ace.number : 18)}
        <div><p style="margin:0 0 6px"><b>${E(UNI_PATTERNS[u.pattern])}</b>・${E(UNI_FONTS[u.font])}「${E(u.text)}」</p>
          <p class="muted small" style="margin:0 0 10px">デザインを変えて発表すると、ファン+800人。発表後${UNIFORM_HYPE}試合はグッズが1人+300円売れる（発表費 ${Util.money(UNIFORM_COST)}）。${hype ? `<br><b style="color:var(--lamp)">新ユニフォーム効果 あと${hype}試合</b>` : ''}${s.limitedUniform ? `<br><b style="color:var(--lamp)">期間限定「${E(s.limitedUniform.name)}」着用中（あと${s.limitedUniform.left}試合）</b>` : ''}</p>
          <button class="btn btn-main" data-act="uniOpen">デザインを変える</button></div></div></div>`;
  },
  // ユニフォームのデザイン画面（モーダル）。決めるまでは下書き（this.uniDraft）
  uniEditorHTML() {
    const u = this.uniDraft;
    const swatches = k => `<div class="uni-row"><div class="uni-label">${UNI_PARTS[k]}</div><div class="uni-sw">${UNI_COLORS.map(c =>
      `<button type="button" class="sw ${u[k] === c ? 'on' : ''}" style="background:${c}" data-act="uniSet" data-k="${k}" data-v="${c}" aria-label="${UNI_PARTS[k]} ${c}"></button>`).join('')}</div></div>`;
    const opts = (k, list) => `<div class="uni-opts">${Object.entries(list).map(([v, name]) =>
      `<button type="button" class="btn-sm ${u[k] === v ? 'on' : ''}" data-act="uniSet" data-k="${k}" data-v="${v}">${name}</button>`).join('')}</div>`;
    const can = game.finance.funds >= UNIFORM_COST;
    return `<div class="modal-body uni-modal"><h2 class="card-title">ユニフォームをデザインする</h2>
      <div class="uni-edit"><div class="uni-preview" id="uniPreview">${uniformSVG(u, game.team.players[0] ? game.team.players[0].number : 18)}</div>
        <div class="uni-form">
          <div class="uni-row"><div class="uni-label">胸の文字（10文字まで）</div><input id="uniText" maxlength="10" value="${E(u.text)}" autocomplete="off"></div>
          <div class="uni-row"><div class="uni-label">テンプレートから選ぶ（色はチームカラーに合わせる）</div><div class="uni-opts">${UNI_TEMPLATES.map(t =>
            `<button type="button" class="btn-sm" data-act="uniTpl" data-v="${t.id}">${t.name}</button>`).join('')}</div></div>
          <div class="uni-row"><div class="uni-label">文字の書体</div>${opts('font', UNI_FONTS)}</div>
          <div class="uni-row"><div class="uni-label">模様</div>${opts('pattern', UNI_PATTERNS)}</div>
          ${['body', 'main', 'accent'].map(swatches).join('')}
          ${Object.entries(UNI_DETAILS).map(([k, d]) => `<div class="uni-row"><div class="uni-label">${d.name}</div>${opts(k, d.opts)}</div>`).join('')}
        </div></div>
      <div class="modal-actions"><button class="btn btn-main" data-act="uniSave" ${can ? '' : 'disabled'}>このデザインで発表する（${Util.money(UNIFORM_COST)}）</button>
        <button class="btn btn-ghost" data-act="uniClose">やめる</button></div>
      ${can ? '' : `<p class="muted small">資金が足りません（${Util.money(UNIFORM_COST)}必要）</p>`}</div>`;
  },

  // 公式YouTube・SNS：運営体制と登録者数
  channelHTML() {
    const ch = game.finance.channel;
    const body = ch.level
      ? `<p style="margin:0 0 6px"><b>${CHANNEL[ch.level].name}</b>で運営中 ／ 登録者 <b>${ch.subs.toLocaleString()}人</b></p>
         <p class="muted small" style="margin:0">試合のたびに登録者が増え、1試合あたり登録者1,000人ごとに${Util.money(CHANNEL_PER_SUB * 1000)}の広告収入。ファンも増えやすくなる（+${(CHANNEL[ch.level].fan * 100).toFixed(1)}%/試合）${CHANNEL[ch.level].upkeep ? `。専任チームの人件費 ${Util.money(CHANNEL[ch.level].upkeep)}/試合` : ''}</p>`
      : '<p class="muted small" style="margin:0">まだ球団公式のYouTube・SNSはありません。職員から提案が来たら始められます。</p>';
    return `<div class="card"><h2 class="card-title">公式YouTube・SNS</h2>${body}</div>`;
  },

  // ネーミングライツ：今の契約、または企業からの提案（毎シーズン3社）
  namingHTML() {
    const s = game, nm = s.naming;
    let body;
    if (nm) {
      const sp = s.finance.sponsors.find(x => x.name === nm.company && x.naming);
      const fee = sp ? Math.round(sp.amount * sp.years * 0.3 / 100) * 100 : 0;
      body = `<div class="naming-now"><span class="muted small">いまの球場名</span><b>${E(s.profile.stadium)}</b>
        <span class="muted small">${E(nm.company)}・${sp ? `年${Util.money(sp.amount)}・残り${sp.years}年` : ''}（もとの名前：${E(nm.original)}）</span></div>
        <div class="row-actions"><button class="btn-sm ${this.armed === 'naming' ? 'warn' : ''}" data-act="namingCancel">${this.armed === 'naming' ? `本当に解約する（違約金 ${Util.money(fee)}）` : '解約する'}</button></div>`;
    } else {
      const offers = s.namingOffers || [];
      body = offers.length ? `<div class="fa-grid">${offers.map((o, i) => `<div class="fa naming-offer">
          <div class="fa-name">${E(s.namingName(o.brand))}</div>
          <div class="p-meta">${E(o.company)}${o.odd ? '　<b class="warn-text">ちょっと変わった名前</b>' : ''}</div>
          <div class="fa-money"><div><small class="muted">金額 / 年</small><b>${Util.money(o.amount)}</b></div><div><small class="muted">契約</small><b>${o.years}年</b></div></div>
          ${o.odd ? '<div class="muted small">お金は多めだが、ファンが少し離れる（−3%）</div>' : '<div class="muted small">オーナー評価+2</div>'}
          <button class="btn-sm go" data-act="namingSign" data-i="${i}">この名前で契約する</button></div>`).join('')}</div>`
        : '<p class="empty-note">今シーズンの提案はありません。来シーズンにまた企業から話が来ます。</p>';
    }
    return `<div class="card"><h2 class="card-title">ネーミングライツ（球場の名前）</h2>
      <p class="muted small" style="margin:0 0 10px">球場の名前を企業に売って、毎年お金をもらう。金額は球場の大きさとファンの数で決まる。提案は毎シーズン3社。途中で解約すると、残り年数分の3割を違約金として払う。</p>
      ${body}</div>`;
  },
  // 本拠地（今の球場と、移転できる球場）
  stadiumHTML() {
    const s = game, f = s.finance, cur = f.park;
    const pct = v => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
    const spec = d => `<dl class="park-spec">
      <div><dt>収容</dt><dd>${d.capacity.toLocaleString()}人</dd></div>
      <div><dt>運営費</dt><dd>${Util.money(d.op)}/試合</dd></div>
      <div><dt>グッズ</dt><dd>1人 ${d.goods.toLocaleString()}円</dd></div>
      <div><dt>スポンサー</dt><dd>×${d.sponsor}</dd></div>
      <div><dt>ファン</dt><dd>${d.fan ? `${pct(d.fan)}/試合` : '±0'}</dd></div>
      <div><dt>雨の日</dt><dd>${d.rain ? `${Math.round(d.rain * 100)}%で客減` : '影響なし'}</dd></div>
      ${d.homeAdv ? `<div><dt>ホーム</dt><dd>強さ+${d.homeAdv}</dd></div>` : ''}
    </dl>`;
    const sel = this.parkSel && STADIUMS.find(d => d.id === this.parkSel);
    let confirm = '';
    if (sel && !s.stadiumLock(sel)) {
      const now = f.breakdown({ payroll: s.costPayroll, gamesPerSeason: s.rules.gamesPerSeason });
      const after = s.previewStadium(sel.id);
      const up = sel.capacity > cur.capacity;
      confirm = `<div class="park-confirm">
        <div class="eyebrow">${E(sel.type)}へ移転</div>
        <label class="field"><span>新しい球場の名前</span><input id="parkName" maxlength="20" value="${E(`${s.team.short}${sel.suffix}`)}" autocomplete="off"></label>
        <dl class="report">
          <div><dt>移転費（今払う）</dt><dd class="${sel.cost ? 'bad' : 'good'}">${sel.cost ? `-${Util.money(sel.cost)}` : '無料'}</dd></div>
          <div><dt>来場者（見込み）</dt><dd>${now.attendance.toLocaleString()}人 → ${after.attendance.toLocaleString()}人</dd></div>
          <div><dt>1試合の収支（見込み）</dt><dd class="${after.net >= now.net ? 'good' : 'bad'}">${Util.signedMoney(now.net)} → ${Util.signedMoney(after.net)}</dd></div>
          <div><dt>ファン・オーナー</dt><dd class="${up ? 'good' : 'bad'}">${up ? 'ファン+8%・評価+5%' : 'ファン-10%・評価-5%'}</dd></div>
        </dl>
        <div class="row-actions"><button class="btn btn-main" data-act="parkMove" data-id="${sel.id}">移転を決める</button><button class="btn btn-ghost" data-act="parkCancel">やめる</button></div>
      </div>`;
    }
    return `<div class="card">
      <h2 class="card-title">本拠地</h2>
      <div class="park-now">
        <div class="park-art park-${cur.id}" aria-hidden="true"></div>
        <div class="park-now-text">
          <div class="muted small">今の本拠地</div>
          <div class="park-name">${E(s.profile.stadium)}</div>
          <div class="park-type">${E(cur.type)}</div>
          <p class="muted small" style="margin:4px 0 0">${E(cur.desc)}</p>
        </div>
      </div>
      ${spec(cur)}
      ${s.stadiumHistory.length > 1 ? `<p class="muted small" style="margin:8px 0 0">これまでの本拠地：${s.stadiumHistory.map(h => `${h.season}年 ${E(h.name)}`).join(' → ')}</p>` : ''}
      <h3 class="section-title" style="margin-top:16px">移転先</h3>
      <p class="muted small" style="margin:0 0 10px">大きな球場ほど稼げるが運営費も高く、ファンが少ないと赤字になる。ファンが減って苦しいときは、小さな球場で地域密着からやり直す手もある。移転は次の試合から。</p>
      ${confirm}
      <div class="park-grid">${STADIUMS.map(d => {
        const lock = s.stadiumLock(d);
        const isCur = d.id === cur.id;
        return `<div class="park ${isCur ? 'current' : ''} ${lock && !isCur ? 'locked' : ''}">
          <div class="park-art park-${d.id}" aria-hidden="true"></div>
          <div class="park-type">${E(d.type)}</div>
          <div class="muted small">${E(d.desc)}</div>
          ${spec(d)}
          <div class="park-cost">${isCur ? '<span class="tag-now">今の本拠地</span>' : `移転費 <b>${d.cost ? Util.money(d.cost) : '無料'}</b>`}</div>
          ${isCur ? '' : lock
            ? `<div class="park-lock">${E(lock)}</div>`
            : `<button class="btn-sm go" data-act="parkSel" data-id="${d.id}">${this.parkSel === d.id ? '選択中' : 'ここに移転する'}</button>`}
        </div>`;
      }).join('')}</div>
    </div>`;
  },

  // スライダーを動かしている間は経営画面を作り直さず、数字だけ更新する
  updateTicket() {
    const s = game, f = s.finance;
    const b = f.breakdown({ payroll: s.costPayroll, gamesPerSeason: s.rules.gamesPerSeason });
    const react = f.reaction();
    $('priceValue').textContent = f.ticketPrice.toLocaleString();
    $('estAttendance').textContent = `${b.attendance.toLocaleString()}人 / ${f.capacity.toLocaleString()}人`;
    $('estNet').textContent = Util.signedMoney(b.net);
    $('estNet').className = `num ${b.net >= 0 ? 'good' : 'bad'}`;
    $('estReaction').textContent = react.text;
    $('estReaction').className = react.cls;
  },

  showResult() { if (game.daily) this.showDailyResult(); else this.showSeasonResult(); },
  // 今日のお題の結果（1シーズンで終わり）
  showDailyResult() {
    const S = game.seasonSummary, d = game.daily, best = Daily.best(d.date);
    this.openModal(`
      <div class="modal-head"><div class="eyebrow">今日のお題 ${E(game.dailyText)}</div><div class="big" id="modalTitle">GM評価 ${d.score}点</div>
        <div>${E(game.team.name)}　${ShareCard.headline(S)}・${S.record.w}勝${S.record.l}敗${S.record.d ? `${S.record.d}分` : ''}</div></div>
      <div class="modal-body">
        ${S.mvp ? `<div class="mvp"><span class="tag-mvp">今季のMVP</span><b>${E(S.mvp.name)}</b><span class="muted small">${E(S.mvp.line)}</span></div>` : ''}
        <dl class="report"><div><dt>今日のベスト</dt><dd class="good">${best}点</dd></div>
          <div><dt>オーナー評価</dt><dd>${S.owner}%</dd></div><div><dt>ポストシーズン</dt><dd>${E(S.post ? S.post.name : '-')}</dd></div></dl>
        <p class="muted small" style="margin:0">今日のお題は1シーズンだけの勝負。成績カードをシェアして、友だちとGM評価を比べよう。明日はまた新しいお題が出る。</p>
        <div class="modal-actions"><button class="btn btn-main" data-act="shareCard">成績カードを作る（シェア）</button>
          <button class="btn btn-ghost" data-act="toTitle">タイトルに戻る</button></div>
      </div>`);
  },
  showSeasonResult() {
    const S = game.seasonSummary;
    const word = ['優勝！', '2位', '3位', '4位', '5位', '最下位'][S.rank - 1];
    this.openModal(`
      <div class="modal-head ${S.rank >= 5 ? 'bad' : ''}"><div class="eyebrow">${S.season}年シーズン 結果発表</div><div class="big" id="modalTitle">${E(game.team.name)} ${S.post && S.post.name === '日本一！' ? '日本一！' : word}</div>
        <div>${S.record.w}勝 ${S.record.l}敗${S.record.d ? ` ${S.record.d}分` : ''}　勝率 ${Util.winRate(S.record.w, S.record.l)}</div></div>
      <div class="modal-body">
        ${S.challenge ? `<div class="ch-result ${S.challenge}"><b>${S.challenge === 'clear' ? 'チャレンジ達成！' : 'チャレンジ失敗…'}</b><span>「${E(game.challengeText)}」${S.challenge === 'clear' ? '成績カードで自慢しよう' : 'このまま続けて遊べる'}</span></div>` : ''}
        ${S.mvp ? `<div class="mvp"><span class="tag-mvp">今季のMVP</span><b>${E(S.mvp.name)}</b><span class="muted small">${E(S.mvp.pos)}・背番号${S.mvp.number}　${E(S.mvp.line)}</span></div>` : ''}
        <div class="table-scroll"><table class="standings"><thead><tr><th>順位</th><th>球団</th><th class="r">勝</th><th class="r">敗</th><th class="r">分</th></tr></thead><tbody>
          ${S.standings.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td><span class="tdot" style="background:${r.color}"></span>${E(r.name)}</td><td class="r num">${r.w}</td><td class="r num">${r.l}</td><td class="r num">${r.d}</td></tr>`).join('')}
        </tbody></table></div>
        <dl class="report">
          ${S.tax ? `<div><dt>法人税（黒字の${Math.round(game.diff.tax * 100)}%）</dt><dd class="bad">-${Util.money(S.tax)}</dd></div>` : ''}
          <div><dt>今季の資金の増減（税引き後）</dt><dd class="${S.fundsDelta >= 0 ? 'good' : 'bad'}">${Util.signedMoney(S.fundsDelta)}</dd></div>
          ${S.loan ? `<div><dt>借入残高（オーナー評価${S.debt}%）</dt><dd class="bad">${Util.money(S.loan)}</dd></div>` : ''}
          <div><dt>オフにかかる固定費（キャンプ・2軍運営・職員）</dt><dd class="bad">-${Util.money(game.diff.offFixed)}</dd></div>
          <div><dt>今季のファンの増減</dt><dd class="${S.fansDelta >= 0 ? 'good' : 'bad'}">${Util.signed(S.fansDelta)}人</dd></div>
          <div><dt>順位によるオーナー評価</dt><dd class="${S.bonus >= 0 ? 'good' : 'bad'}">${Util.signed(S.bonus)}%</dd></div>
          ${S.goal ? `<div><dt>目標「${E(S.goal.name)}」${S.goal.achieved ? '達成！' : '未達成'}</dt><dd class="${S.goal.achieved ? 'good' : 'bad'}">${Util.signed(S.goal.delta)}%</dd></div>` : ''}
          ${S.strategy ? `<div><dt>方針「${E(S.strategy)}」／ 若手の能力アップ</dt><dd>${S.youthGrowth}回</dd></div>` : ''}
          ${S.post ? `<div><dt>ポストシーズン：${E(S.post.name)}</dt><dd class="good">${Util.signed(S.post.owner)}%${S.post.prize ? `・賞金 ${Util.money(S.post.prize)}` : ''}</dd></div>
            ${S.post.income ? `<div><dt>ポストシーズンの主催試合の収入</dt><dd class="good">+${Util.money(S.post.income)}</dd></div>` : ''}
            ${S.post.champion ? `<div><dt>日本一</dt><dd>${E(S.post.champion)}</dd></div>` : ''}` : ''}
          ${S.hoard ? `<div><dt>オーナー「お金を眠らせるな」（資金${Util.money(game.rules.hoardLimit)}以上）</dt><dd class="bad">${S.hoard}%</dd></div>` : ''}
          <div class="total"><dt>オーナー評価</dt><dd>${S.owner}%</dd></div>
        </dl>
        <p class="muted small" style="margin:0">このあとドラフト会議で新人を指名し、次のシーズンへ。選手は1つ歳をとり、若手はオフの練習で伸び、ベテランは少し衰える。</p>
        <div class="modal-actions">
          ${game.isFired ? '<button class="btn btn-main" data-modal="fired">オーナーからの通告を聞く</button>'
            : '<button class="btn btn-main" data-modal="draft">ドラフト会議へ</button><button class="btn btn-ghost" data-act="shareCard">成績カードを作る（シェア）</button><button class="btn btn-ghost" data-modal="close">あとで</button>'}
        </div>
      </div>`);
  },
  // 成績カード（画像）を作って、保存・Xに投稿できるようにする。kind：'season' シーズン結果 / 'career' GM成績
  async showShareCard(kind = 'season', from = this.shareFrom || 'result') {
    const S = game.seasonSummary;
    if (kind === 'season' && !S) kind = 'career';
    this.shareKind = kind; this.shareFrom = from;
    this.openModal('<div class="modal-body"><p>成績カードを作っています…</p></div>');
    const c = kind === 'career' ? await ShareCard.drawCareer(game) : await ShareCard.draw(game, S);
    this.shareImage = c.toDataURL('image/png');
    this.shareText = kind === 'career' ? ShareCard.careerText(game) : ShareCard.text(game, S);
    this.shareBlob = await new Promise(r => c.toBlob(r, 'image/png'));
    const fname = kind === 'career' ? `DUGOUT_GM_${game.season}.png` : `DUGOUT_${S.season}.png`;
    this.openModal(`<div class="modal-body share-modal"><h2 class="card-title">成績カード</h2>
      <div class="seg share-kind" role="group" aria-label="カードの種類">
        <button class="${kind === 'season' ? 'on' : ''}" data-act="shareKind" data-k="season" ${S ? '' : 'disabled title="シーズンが終わると作れます"'}>シーズン結果</button>
        <button class="${kind === 'career' ? 'on' : ''}" data-act="shareKind" data-k="career">GM成績</button></div>
      ${S ? '' : '<p class="muted small" style="margin:0">「シーズン結果」のカードは、シーズンが終わると作れます。</p>'}
      <img class="share-img" src="${this.shareImage}" alt="成績カード">
      <p class="muted small" style="margin:0">${E(this.shareText)}</p>
      <div class="modal-actions">
        <button class="btn btn-main" data-act="sharePost">Xに投稿する</button>
        <a class="btn btn-ghost" href="${this.shareImage}" download="${fname}">画像を保存</a>
        <button class="btn btn-ghost" data-act="shareBack">戻る</button>
      </div>
      <p class="muted small" style="margin:0">スマホでは画像つきで投稿できます。PCでは投稿画面が開くので、保存した画像を添付してください。</p></div>`);
  },
  async sharePost() {
    const file = this.shareBlob && new File([this.shareBlob], 'DUGOUT.png', { type: 'image/png' });
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: this.shareText }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(this.shareText)}`, '_blank', 'noopener');
    this.toast('投稿画面を開きました。保存した画像を添付してください');
  },
  // おまかせ指名の結果（自分の指名選手の一覧）
  showDraftAuto(list) {
    const s = game;
    const row = l => {
      const p = s.findPlayer(l.pid);
      return `<tr><td><b>${E(l.label)}</b></td><td>${p ? posBadge(p) : ''}${E(l.name)}</td><td class="muted small">${E(l.origin)}</td>
        <td>${p ? `${p.age}歳` : ''}</td><td>${p ? Util.rankBadge(p.overall, 'sm') : ''}</td><td>${p ? Util.rankBadge(p.potential, 'sm') : ''}</td><td class="r num">${p ? Util.money(p.salary) : ''}</td></tr>`;
    };
    const main = list.filter(l => l.stage === 'main'), ik = list.filter(l => l.stage === 'ikusei');
    const lot = s.lottery || { win: 0, lose: 0 };
    this.openModal(`
      <div class="modal-head"><div class="eyebrow">${s.season}年 ドラフト会議</div><div class="big" id="modalTitle">おまかせ指名の結果</div>
        <div>支配下 ${main.length}人・育成 ${ik.length}人を指名しました</div></div>
      <div class="modal-body">
        <p class="muted small" style="margin:0">スカウト部長が、方針「${E(STRATEGIES[s.strategy].name)}」とチームの弱点をもとに選びました（支配下${DRAFT_AUTO.main}人・育成${DRAFT_AUTO.ikusei}人まで）。くじ引き通算 ${lot.win}勝${lot.lose}敗。</p>
        <div class="table-scroll"><table class="auto-picks"><thead><tr><th>順位</th><th>選手</th><th>出身</th><th>年齢</th><th>今の力</th><th>伸びしろ</th><th class="r">年俸</th></tr></thead>
          <tbody>${main.map(row).join('')}${ik.length ? `<tr class="sep"><td colspan="7">育成ドラフト</td></tr>${ik.map(row).join('')}` : ''}</tbody></table></div>
        ${list.length ? '' : '<p class="empty-note">指名できる枠がなく、今回は指名しませんでした。</p>'}
        <div class="modal-actions"><button class="btn btn-main" data-act="draftAutoClose">ドラフト結果を見る</button></div>
      </div>`);
  },
  showFired() {
    const reason = game.firedReason === 'owner' ? 'シーズンを終えて、オーナー評価が0%でした。' : '開幕前の時点で資金がマイナスで、銀行からも借りられませんでした。';
    const r = game.record;
    this.openModal(`
      <div class="modal-head bad"><div class="eyebrow">GAME OVER</div><div class="big" id="modalTitle">GM解任</div><div>${reason}</div></div>
      <div class="modal-body">
        <p style="margin:0">オーナー「${E(game.profile.gm)}GM、残念だが契約はここまでだ」</p>
        <dl class="report">
          <div><dt>${game.season}年シーズンの成績</dt><dd>${r.w}勝 ${r.l}敗${r.d ? ` ${r.d}分` : ''}</dd></div>
          <div><dt>資金</dt><dd class="${game.finance.funds >= 0 ? 'good' : 'bad'}">${Util.money(game.finance.funds)}</dd></div>
          <div><dt>オーナー評価</dt><dd>${game.ownerRating}%</dd></div>
        </dl>
        <div class="modal-actions"><button class="btn btn-main" data-modal="restart">最初からやり直す</button></div>
      </div>`);
  },
  openModal(html) {
    $('modalBox').innerHTML = html;
    $('modal').hidden = false;
    const btn = $('modalBox').querySelector('button');
    if (btn) btn.focus();
  },
  closeModal() { $('modal').hidden = true; },

  toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  },

  // ボタンはすべて data-act で受け取る（画面を作り直しても動くように）
  bindEvents() {
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-act], [data-modal]');
      if (!el || el.disabled || el.tagName === 'SELECT') return;
      const act = el.dataset.act, id = el.dataset.id;
      if (el.closest('#start')) return;   // タイトル・設定画面は StartScreen が処理
      if (!['release', 'wipe', 'staffFire', 'namingCancel', 'saveCopy'].includes(act)) this.armed = null;

      if (el.dataset.modal) {
        const m = el.dataset.modal;
        this.closeModal();
        if (m === 'restart') { Save.clear(); game = null; StartScreen.newSlot = Save.slot; StartScreen.show('setup'); return; }
        if (m === 'draft') game.startDraft();
        if (m === 'fired') { this.renderAll(); this.showFired(); return; }
        this.marketMsg = this.officeMsg = this.draftMsg = null;
        this.renderAll();
        Tabs.show('dashboard');
        return;
      }

      switch (act) {
        case 'play': {
          if (!game.playNextGame()) return;
          window.scrollTo({ top: 0, behavior: 'smooth' });
          this.renderAll();
          if (game.isFired) this.showFired();
          else if (game.seasonSummary) this.showResult();
          return;
        }
        case 'choose': {
          const text = game.resolveEvent(Number(el.dataset.i));
          if (text) this.toast(text);
          break;
        }
        case 'filter': this.rosterFilter = el.dataset.k; break;
        case 'starter': { const err = game.toggleStarter(id); if (err) this.toast(err); break; }
        case 'release': {
          if (this.armed !== id) { this.armed = id; break; }
          this.toast(game.release(id).text); this.armed = null; break;
        }
        case 'sign': this.marketMsg = game.signFA(id); break;
        case 'trade':
          this.marketMsg = game.proposeTrade(this.trade.mine, this.trade.theirs);
          if (this.marketMsg.ok) this.trade = { mine: '', theirs: '' };
          break;
        case 'gmOpen': this.openModal(this.gmModalHTML()); return;
        case 'gmClose': this.closeModal(); return;
        case 'shareCard': this.showShareCard('season', 'result'); return;
        case 'shareGm': this.showShareCard('career', 'gm'); return;
        case 'shareKind': this.showShareCard(el.dataset.k, this.shareFrom); return;
        case 'tutSkip': case 'tutEnd': game.profile.tut = -1; this.renderTutorial(); Save.write(game); return;
        case 'sharePost': this.sharePost(); return;
        case 'shareBack':
          if (this.shareFrom === 'gm') { this.openModal(this.gmModalHTML()); return; }
          if (game.daily) this.showDailyResult(); else if (game.seasonSummary) this.showSeasonResult(); else this.closeModal();
          return;
        case 'uniOpen': this.uniDraft = { ...UNI_DEFAULT_DETAIL, ...game.profile.uniform }; this.openModal(this.uniEditorHTML()); return;
        case 'uniSet': {
          this.uniDraft[el.dataset.k] = el.dataset.v;
          const y = $('modalBox').scrollTop; this.openModal(this.uniEditorHTML()); $('modalBox').scrollTop = y; return;
        }
        case 'uniTpl': {
          this.uniDraft = uniTemplate(el.dataset.v, game.team.color, this.uniDraft.text);
          const y = $('modalBox').scrollTop; this.openModal(this.uniEditorHTML()); $('modalBox').scrollTop = y; return;
        }
        case 'uniClose': this.closeModal(); return;
        case 'uniSave': { const r = game.setUniform(this.uniDraft); if (r.ok) game.limitedUniform = null; this.toast(r.text); if (!r.ok) return; this.closeModal(); break; }
        case 'invest': this.officeMsg = game.invest(el.dataset.k); break;
        case 'staffHire': this.marketMsg = game.hireStaff(id); this.toast(this.marketMsg.text); break;
        case 'staffExtend': this.marketMsg = game.extendStaff(el.dataset.k); break;
        case 'staffFire': {
          const key = `fire-${el.dataset.k}`;
          if (this.armed !== key) { this.armed = key; break; }
          this.armed = null; this.marketMsg = game.fireStaff(el.dataset.k); this.toast(this.marketMsg.text); break;
        }
        case 'parkSel': this.parkSel = id; this.officeMsg = null; break;
        case 'parkCancel': this.parkSel = null; break;
        case 'parkMove': {
          const name = $('parkName') ? $('parkName').value : '';
          this.officeMsg = game.moveStadium(id, name);
          if (this.officeMsg.ok) { this.parkSel = null; this.toast(this.officeMsg.text); window.scrollTo({ top: 0, behavior: 'smooth' }); }
          break;
        }
        // ドラフト
        case 'startDraft': game.startDraft(); this.draftSel = null; this.draftMsg = null; window.scrollTo({ top: 0 }); break;
        case 'draftSel': this.draftSel = id; this.draftMsg = null; break;
        case 'draftBid': {
          const r = game.draftBid(this.draftSel);
          this.draftMsg = r.ok ? null : r;
          if (r.ok) { this.draftSel = null; window.scrollTo({ top: 0, behavior: 'smooth' }); }
          break;
        }
        case 'draftBidSkip': { const r = game.draftBid(null); this.draftMsg = r.ok ? null : r; break; }
        case 'draftEnd': game.draftEnd(); this.draftSel = null; this.draftMsg = null; break;
        case 'draftAuto': {
          const list = game.draftAuto(); this.draftSel = null; this.draftMsg = null;
          this.renderAll(); window.scrollTo({ top: 0 }); this.showDraftAuto(list); return;
        }
        case 'draftAutoClose': this.closeModal(); break;
        case 'draftFilter': this.draftFilter = el.dataset.k; break;
        case 'promote': this.toast(game.promote(id).text); break;
        case 'tradeYes': case 'tradeNo': { this.marketMsg = game.answerTradeOffer(act === 'tradeYes'); if (this.marketMsg) this.toast(this.marketMsg.text); break; }
        case 'offNext':
          game.offNext(); this.offMsg = null; window.scrollTo({ top: 0 });
          if (game.isFired) { this.renderAll(); this.showFired(); return; }
          if (!game.off) this.toast(`契約更改を終えて、${game.season}年シーズン開幕！`);
          break;
        case 'tryoutSign': this.offMsg = game.signTryout(id); break;
        case 'retain': this.offMsg = game.retainFA(id, Number(el.dataset.k)); break;
        case 'letGo': { const f = game.off.faOut.find(x => x.id === id); if (f && !f.status) this.offMsg = game.loseFA(f, '引き止めなかった。'); break; }
        case 'comp': this.offMsg = game.takeCompensation(id, el.dataset.k); break;
        case 'faBid': this.offMsg = game.bidFA(id, Number(el.dataset.k)); break;
        case 'gyToggle': { const err = game.genyakuToggle(id); if (err) this.toast(err); break; }
        case 'gyWant': if (!game.off.genyaku.done) game.off.genyaku.myWant = id; break;
        case 'gyRun': this.offMsg = game.runGenyaku(); break;
        case 'postNext': game.postAdvance(); break;
        case 'postStage': { const st = game.post.stage; while (game.post.stage === st) game.postAdvance(); break; }
        case 'postAll': while (game.post.stage !== 'done') game.postAdvance(); break;
        case 'postClose': game.closePostseason(); this.renderAll(); this.showResult(); return;
        case 'sales': { this.salesMsg = game.doSales(el.dataset.k, Number(el.dataset.i ?? 1)); this.toast(this.salesMsg.text); break; }
        case 'planGoal': this.planGoal = el.dataset.k; break;
        case 'planStrategy': this.planStrategy = el.dataset.k; break;
        case 'planSet': {
          const r = game.setPlan(this.planGoal, this.planStrategy || game.strategy);
          this.toast(r.text);
          if (r.ok) { this.planGoal = null; this.planStrategy = null; }
          break;
        }
        case 'batUp': game.moveBatting(id, -1); break;
        case 'batDown': game.moveBatting(id, 1); break;
        case 'batAuto': game.autoBatting(); this.toast('スタメン・守備位置・打順をおまかせで組みました'); break;
        case 'draftDraw': {
          const won = game.draftDraw(Number(el.dataset.i));
          if (won !== null) this.toast(won ? '当たり！ 交渉権を獲得しました！' : 'はずれ…。外れ1位を入札しよう');
          break;
        }
        case 'draftNext': game.draftContinue(); this.draftSel = null; window.scrollTo({ top: 0, behavior: 'smooth' }); break;
        case 'draftPick': {
          const r = game.draftPick(this.draftSel);
          this.draftMsg = r.ok ? null : r;
          if (r.ok) this.draftSel = null;
          break;
        }
        case 'finishDraft': game.finishDraft(); this.toast(`${game.season}年シーズン開幕！`); window.scrollTo({ top: 0 }); break;
        // セーブ
        case 'goTab': Tabs.show(el.dataset.tab2); window.scrollTo(0, 0); return;
        case 'toTitle': Save.write(game); this.closeModal(); game = null; Daily.exit(); this.renderTutorial(); StartScreen.show('title'); UI.toast('進行を保存してタイトルに戻りました'); return;
        case 'wipe':
          if (this.armed !== 'wipe') { this.armed = 'wipe'; break; }
          this.armed = null; Save.clear(); game = null; StartScreen.newSlot = Save.slot; StartScreen.show('setup'); return;
        case 'rosterView': this.rosterView = el.dataset.k; break;
        case 'saveCopy': {
          const n = Number(el.dataset.k), key = `copy-${n}`;
          if (Save.read(n) && this.armed !== key) { this.armed = key; break; }
          this.armed = null; Save.write(game); Save.write(game, n); this.toast(`スロット${n}にも保存しました`); break;
        }
        case 'namingSign': this.officeMsg = game.signNaming(Number(el.dataset.i)); this.toast(this.officeMsg.text); break;
        case 'namingCancel': {
          if (this.armed !== 'naming') { this.armed = 'naming'; break; }
          this.armed = null; this.officeMsg = game.cancelNaming(); this.toast(this.officeMsg.text); break;
        }
        case 'difficulty': { const r = game.setDifficulty(el.dataset.k); if (r) this.toast(r.text); break; }
        case 'borrow': this.officeMsg = game.borrow(Number(el.dataset.k)); this.toast(this.officeMsg.text); break;
        case 'repay': this.officeMsg = game.repay(Number(el.dataset.k)); this.toast(this.officeMsg.text); break;
        case 'regToggle': { const r = game.toggleActive(id); if (r.text) this.toast(r.text); break; }
        case 'benchToggle': { const r = game.toggleBench(id); if (r.text) this.toast(r.text); break; }
        default: return;
      }
      if (game) game.fixActive();
      this.renderAll();
    });

    document.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'rosterSort') { this.rosterSort = t.value; this.renderRoster(); }
      else if (t.id === 'draftSort') { this.draftSort = t.value; this.renderDashboard(); }
      else if (t.id === 'draftStrategy') { game.setStrategy(t.value); this.draftSort = 'fit'; this.renderAll(); this.toast(`方針を「${STRATEGIES[t.value].name}」に変えました`); }
      else if (t.dataset.act === 'role') { game.setRole(t.dataset.id, t.value); this.renderAll(); }
      else if (t.dataset.act === 'convert') { const r = game.convertPosition(t.dataset.id, t.value); if (r.text) this.toast(r.text); this.renderAll(); }
      else if (t.id === 'tradeMine') { this.trade.mine = t.value; this.renderMarket(); }
      else if (t.id === 'tradeTheirs') { this.trade.theirs = t.value; this.renderMarket(); }
      else if (t.id === 'ticketPrice') { this.renderAll(); }
      else if (t.id === 'ticketPriceNum') {
        game.finance.ticketPrice = Util.clamp(Math.round((Number(t.value) || 2500) / 100) * 100, TICKET_MIN, TICKET_MAX);
        this.renderAll();
      }
    });
    document.addEventListener('input', e => {
      if (e.target.id === 'uniText' && this.uniDraft) {   // 胸の文字はその場で絵に反映
        this.uniDraft.text = e.target.value;
        $('uniPreview').innerHTML = uniformSVG(this.uniDraft, game.team.players[0] ? game.team.players[0].number : 18);
        return;
      }
      if (e.target.id === 'ticketPrice') {
        game.finance.ticketPrice = ticketFromPos(Number(e.target.value));
        if ($('ticketPriceNum')) $('ticketPriceNum').value = game.finance.ticketPrice;
      } else if (e.target.id === 'ticketPriceNum') {
        const v = Number(e.target.value);
        if (!v || v < TICKET_MIN || v > TICKET_MAX) return;   // 入力の途中は反映しない
        game.finance.ticketPrice = Math.round(v / 100) * 100;
        $('ticketPrice').value = ticketToPos(game.finance.ticketPrice);
      } else return;
      this.updateTicket();
      this.renderHeader();
    });
  },
};

// ---------- タブ切り替え ----------
const Tabs = {
  names: ['dashboard', 'roster', 'market', 'game', 'office', 'sales', 'club'],
  init() {
    document.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => this.show(btn.dataset.tab)));
    // 左上の球団名を押すとタイトルに戻る（data-act="toTitle"。キーボードでも押せるように）
    const club = document.querySelector('.club');
    club.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); club.click(); } });
    document.querySelector('.tabs').addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = this.names.indexOf(this.current);
      const next = this.names[(i + (e.key === 'ArrowRight' ? 1 : this.names.length - 1)) % this.names.length];
      this.show(next);
      $(`tab-${next}`).focus();
    });
    let saved = null;
    try { saved = localStorage.getItem('gm-tab'); } catch (e) { /* 保存できない環境では無視 */ }
    this.show(this.names.includes(saved) ? saved : 'dashboard');
  },
  show(name) {
    this.current = name;
    this.names.forEach(n => {
      const on = n === name;
      $(`view-${n}`).hidden = !on;
      const tab = $(`tab-${n}`);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    try { localStorage.setItem('gm-tab', name); } catch (e) { /* 無視 */ }
    window.scrollTo({ top: 0 });
    if (game) UI.renderTutorial();
  },
};

// ---------- セーブ ----------
// セーブは3つのスロットに分けて保存する（今遊んでいるスロットに自動で保存）
const Save = {
  OLD: 'dugout-public-save-v1',      // 以前の1つだけのセーブ（スロット1に引っ越す）
  PREFIX: 'dugout-public-slot-',
  SLOTS: 3,
  slot: 1,
  lastSaved: null,
  key(n = this.slot) { return this.PREFIX + n; },
  migrate() {
    try {
      const old = localStorage.getItem(this.OLD);
      if (old && !localStorage.getItem(this.key(1))) localStorage.setItem(this.key(1), old);
      if (old) localStorage.removeItem(this.OLD);
    } catch (e) { /* 無視 */ }
  },
  write(g, n = this.slot) {
    try { localStorage.setItem(this.key(n), JSON.stringify(g)); if (n === this.slot) this.lastSaved = Date.now(); } catch (e) { /* 保存できない環境では無視 */ }
  },
  read(n = this.slot) {
    try { const raw = localStorage.getItem(this.key(n)); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  },
  load(n = this.slot) {
    const j = this.read(n);
    if (!j) return null;
    try { const g = GameState.load(j); this.slot = n; this.lastSaved = j.savedAt; return g; } catch (e) { console.warn('セーブを読み込めませんでした', e); return null; }
  },
  clear(n = this.slot) { try { localStorage.removeItem(this.key(n)); } catch (e) { /* 無視 */ } },
  slots() { return Array.from({ length: this.SLOTS }, (_, i) => i + 1); },
  any() { return this.slots().some(n => this.read(n)); },
  // スロットの中身をひとことで
  summary(n) {
    const j = this.read(n);
    if (!j) return null;
    const r = (j.league && j.league.table[j.team.id]) || { w: 0, l: 0, d: 0 };
    return { team: j.team.name, color: j.team.color, gm: j.profile.gm, season: j.season,
      when: j.draft ? 'ドラフト会議' : j.off ? 'オフシーズン' : `${r.w}勝${r.l}敗`, funds: j.finance.funds, savedAt: j.savedAt };
  },
};

// ---------- はじめてのガイド（1年目の開幕前から、順に案内する） ----------
// done：この手順が終わったかどうか。target：光らせる場所
const TUTORIAL = [
  { title: 'まずは今季の目標と方針を決めよう', text: 'ホームの「目標」と「戦略方針」を1つずつ選んで、「この目標と方針でシーズン開幕」を押そう。目標を達成するとオーナー評価が上がる。',
    target: '.plan-card', tab: 'dashboard', done: g => !!g.goal },
  { title: '試合をしよう', text: '「試合をする」を押すと1試合が自動で進む。試合前に「GMの決断」が出たら、選択肢を選んでから試合へ。',
    target: '[data-act=play]', tab: 'dashboard', done: g => g.gameIndex >= 1 },
  { title: '経営タブを見てみよう', text: '試合の結果はホームと「試合」タブで見られる。次はお金。「経営」タブでチケット料金を動かすと、来場者と1試合の収支の見込みが変わる。',
    target: '#tab-office', done: () => Tabs.current === 'office' },
  { title: 'あとは自由に！', text: '「編成」で打順や1軍、「補強」でトレードやFA、「営業」でスポンサー、「球団」でユニフォームを変えられる。左上の球団名を押すと、保存してタイトルに戻る。',
    target: null, done: () => false, last: true },
];

// ---------- チャレンジモード（条件つきの遊び方） ----------
// setup：はじめに条件をつける / check：達成したか / fail：期限前でも失敗になるか
const CHALLENGES = {
  poor:    { name: '貧乏球団の逆襲', desc: '資金0・親会社の支援なしで始めて、3年以内に日本一', years: 3, noSupport: true,
             setup: g => { g.finance.funds = 0; }, check: g => (g.japanTitles || 0) >= 1 },
  weak:    { name: '最弱からの下克上', desc: '選手の力が大きく下がった状態から、3年以内にリーグ優勝', years: 3,
             setup: g => g.team.players.forEach(p => Object.keys(p.stats).forEach(k => { p.stats[k] = Math.max(20, p.stats[k] - (k === 'velocity' ? 4 : 8)); })),
             check: g => (g.titles || 0) >= 1 },
  fans:    { name: 'ファン3,000人からの再建', desc: 'ファン3,000人から、3年以内にファン5万人', years: 3,
             setup: g => { g.finance.fans = 3000; }, check: g => g.finance.fans >= 50000 },
  rookie:  { name: '1年目で日本一', desc: '就任1年目のシーズンで日本一（難易度「ふつう」以上がおすすめ）', years: 1,
             setup: () => {}, check: g => (g.japanTitles || 0) >= 1 },
  dynasty: { name: '常勝軍団', desc: '5年連続でAクラス（3位以内）', years: 5,
             setup: () => {}, check: g => (g.gmHistory || []).length >= 5 && g.gmHistory.slice(-5).every(h => h.rank <= 3),
             fail: g => (g.gmHistory || []).some(h => h.rank > 3) },
};

// ---------- 今日のお題（日付ごとに、全員が同じ条件で1シーズンだけ戦う） ----------
const DAILY_RULES = [
  { name: '資金が半分', apply: g => { g.finance.funds = Math.round(g.finance.funds / 2 / 100) * 100; } },
  { name: 'ファンが2倍', apply: g => { g.finance.fans *= 2; } },
  { name: 'エースが開幕から故障', apply: g => { const ace = [...g.team.players].filter(p => p.isPitcher).sort((a, b) => b.overall - a.overall)[0]; if (ace) ace.injured = 6; } },
  { name: 'スポンサーがいない', apply: g => { g.finance.sponsors = []; } },
  { name: 'チケットが最初から5,000円', apply: g => { g.finance.ticketPrice = 5000; } },
  { name: 'ベテランが不調', apply: g => g.team.players.filter(p => p.age >= 30).forEach(p => { p.condition = -2; }) },
  { name: '超強力打線・投手は不安', apply: g => g.team.players.forEach(p => { if (p.isPitcher) p.stats.control = Math.max(20, p.stats.control - 6); else p.stats.power = Math.min(99, p.stats.power + 8); }) },
];
const Daily = {
  origRandom: Math.random,
  today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  // 日付の文字列をよく混ぜた数にする（となりの日どうしで似た結果にならないように）
  seedOf(date) { let h = 2166136261; for (const ch of `dugout:${date}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; },
  shiftDate(date, n) { const [y, m, d] = date.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; },
  raw(date) {
    const seed = this.seedOf(date), r = this.rng(seed);
    return { seed, team: Math.floor(r() * ALL_TEAMS.length), diff: Math.floor(r() * 3), rule: Math.floor(r() * DAILY_RULES.length) };
  },
  // 日付から、球団・難易度・特別ルールを決める（だれが遊んでも同じ）。前の日と同じ球団・同じルールにはしない
  cond(date = this.today(), depth = 0) {
    const c = this.raw(date);
    const prev = depth < 6 ? this.cond(this.shiftDate(date, -1), depth + 1) : null;   // 前の日（調整したあと）とくらべる
    if (prev) { prev.team = ALL_TEAMS.indexOf(prev.team); }
    else return { date, seed: c.seed, pick: ALL_TEAMS[c.team].id, team: ALL_TEAMS[c.team], difficulty: ['easy', 'normal', 'hard'][c.diff], rule: c.rule };
    if (c.team === prev.team) c.team = (c.team + 1 + (c.seed % (ALL_TEAMS.length - 1))) % ALL_TEAMS.length;
    if (c.rule === prev.rule) c.rule = (c.rule + 1 + (c.seed % (DAILY_RULES.length - 1))) % DAILY_RULES.length;
    const t = ALL_TEAMS[c.team];
    return { date, seed: c.seed, pick: t.id, team: t, difficulty: ['easy', 'normal', 'hard'][c.diff], rule: c.rule };
  },
  label(c) { const [, m, d] = c.date.split('-').map(Number); return `${m}/${d}・${c.team.short}・${DIFFICULTY[c.difficulty].name}・${DAILY_RULES[c.rule].name}`; },
  rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; },
  // お題の間は乱数を日付で固定する（同じ選択なら同じ展開になりやすい）
  enter(g) { Math.random = this.rng(g.daily.seed * 1000 + g.gameIndex * 7 + 1); },
  exit() { Math.random = this.origRandom; },
  bestKey(date) { return `dugout-public-daily-best-${date}`; },
  best(date = this.today()) { try { return Number(localStorage.getItem(this.bestKey(date))) || null; } catch (e) { return null; } },
  setBest(date, v) { try { if (!(this.best(date) >= v)) localStorage.setItem(this.bestKey(date), String(v)); } catch (e) { /* 無視 */ } },
  start(gm) {
    const c = this.cond(), t = c.team;
    const g0 = { daily: { date: c.date, seed: c.seed, rule: c.rule } };
    Math.random = this.rng(c.seed);
    const g = new GameState(INITIAL_DATA, { teamName: t.name, short: t.short, stadium: `${t.short}市民球場`, gm, color: t.color, difficulty: c.difficulty, pick: t.id });
    Object.assign(g, g0);
    DAILY_RULES[c.rule].apply(g);
    g.seasonStart = { funds: g.finance.funds, fans: g.finance.fans, owner: g.ownerRating, loan: 0 };
    return g;
  },
};

// ---------- ホーム画面に追加（アプリのように全画面で遊べる） ----------
const Install = {
  deferred: null,   // Android・PCの Chrome などで「インストールしますか？」を出すための合図
  get standalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; },
  get ios() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },
  get mobile() { return this.ios || /android/i.test(navigator.userAgent); },
  init() {
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); this.deferred = e; });
    window.addEventListener('appinstalled', () => { this.deferred = null; document.querySelectorAll('.install-card').forEach(x => { x.hidden = true; }); UI.toast('ホーム画面に追加しました'); });
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  },
  // iPhone の手順の絵（1：共有ボタン／2：ホーム画面に追加／3：追加）。本物の画面ではなく、場所がわかるだけの簡単な絵
  iosStepSVG(n) {
    const gold = '#ffd23f', frame = `<rect x="6" y="4" width="148" height="232" rx="22" fill="#0b1430" stroke="#5c6b93" stroke-width="3"/><rect x="58" y="12" width="44" height="8" rx="4" fill="#2a3556"/>`;
    const share = (x, y, c) => `<g transform="translate(${x} ${y})" stroke="${c}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M-7 -1 h-3 v13 h20 v-13 h-3"/><path d="M0 -12 v15 M-5 -7 l5 -5 l5 5"/></g>`;
    const ring = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${gold}" stroke-width="3.5"><animate attributeName="r" values="${r};${r + 4};${r}" dur="1.4s" repeatCount="indefinite"/></circle>`;
    const page = `<rect x="18" y="30" width="124" height="150" rx="6" fill="#16244a"/><text x="80" y="95" text-anchor="middle" font-size="22" font-weight="900" fill="#fff" font-style="italic">DUG<tspan fill="${gold}">OUT</tspan></text>`;
    if (n === 1) return `<svg viewBox="0 0 160 240" class="ios-step">${frame}${page}
      <rect x="10" y="186" width="140" height="44" rx="0" fill="#1c2747"/><text x="30" y="214" font-size="16" fill="#8fa0c8">‹</text><text x="56" y="214" font-size="16" fill="#8fa0c8">›</text>
      ${share(80, 208, '#4da3ff')}${ring(80, 206, 17)}<rect x="108" y="200" width="12" height="12" rx="2" fill="none" stroke="#8fa0c8" stroke-width="2"/></svg>`;
    if (n === 2) return `<svg viewBox="0 0 160 240" class="ios-step">${frame}<rect x="18" y="30" width="124" height="60" rx="6" fill="#16244a" opacity=".5"/>
      <rect x="14" y="96" width="132" height="136" rx="14" fill="#1c2747"/>
      ${['コピー', 'ブックマーク', 'ホーム画面に追加', 'リーディングリスト'].map((t, i) => `<rect x="22" y="${106 + i * 30}" width="116" height="24" rx="6" fill="${i === 2 ? 'rgba(255,210,63,.18)' : '#25325a'}"/>
        <text x="28" y="${123 + i * 30}" font-size="${i === 2 ? 10 : 11}" font-weight="${i === 2 ? 900 : 400}" fill="${i === 2 ? '#fff' : '#9fb0d6'}">${t}</text>
        ${i === 2 ? `<rect x="120" y="${111 + i * 30}" width="13" height="13" rx="3" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M126.5 ${114 + i * 30} v7 M123 ${117.5 + i * 30} h7" stroke="#fff" stroke-width="1.8"/>` : ''}`).join('')}
      <rect x="20" y="165" width="120" height="30" rx="8" fill="none" stroke="${gold}" stroke-width="3"/></svg>`;
    return `<svg viewBox="0 0 160 240" class="ios-step">${frame}<rect x="10" y="26" width="140" height="206" rx="0" fill="#1c2747"/>
      <text x="18" y="48" font-size="9" fill="#4da3ff">キャンセル</text>
      <text x="140" y="48" text-anchor="end" font-size="12" font-weight="900" fill="#4da3ff">追加</text>${ring(129, 44, 14)}
      <text x="80" y="72" text-anchor="middle" font-size="10" font-weight="900" fill="#fff">ホーム画面に追加</text>
      <rect x="22" y="86" width="34" height="34" rx="8" fill="#0b1a44"/><text x="39" y="101" text-anchor="middle" font-size="9" font-weight="900" fill="#fff" font-style="italic">DUG</text><text x="39" y="113" text-anchor="middle" font-size="9" font-weight="900" fill="${gold}" font-style="italic">OUT</text>
      <rect x="64" y="92" width="76" height="22" rx="4" fill="#25325a"/><text x="70" y="107" font-size="11" fill="#fff">DUGOUT</text></svg>`;
  },
  // Android の手順の絵（1：右上のメニュー／2：ホーム画面に追加／3：インストール）
  androidStepSVG(n) {
    const gold = '#ffd23f', frame = `<rect x="6" y="4" width="148" height="232" rx="18" fill="#0b1430" stroke="#5c6b93" stroke-width="3"/><circle cx="80" cy="14" r="3.5" fill="#2a3556"/>`;
    const ring = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${gold}" stroke-width="3.5"><animate attributeName="r" values="${r};${r + 4};${r}" dur="1.4s" repeatCount="indefinite"/></circle>`;
    const bar = `<rect x="10" y="22" width="140" height="28" fill="#1c2747"/><rect x="18" y="28" width="104" height="16" rx="8" fill="#25325a"/><text x="26" y="40" font-size="9" fill="#9fb0d6">gohho113.github.io</text>
      <g fill="#cfd8f0"><circle cx="138" cy="30" r="1.8"/><circle cx="138" cy="36" r="1.8"/><circle cx="138" cy="42" r="1.8"/></g>`;
    const page = `<rect x="18" y="58" width="124" height="168" rx="6" fill="#16244a"/><text x="80" y="140" text-anchor="middle" font-size="22" font-weight="900" fill="#fff" font-style="italic">DUG<tspan fill="${gold}">OUT</tspan></text>`;
    if (n === 1) return `<svg viewBox="0 0 160 240" class="ios-step">${frame}${page}${bar}${ring(138, 36, 13)}</svg>`;
    if (n === 2) return `<svg viewBox="0 0 160 240" class="ios-step">${frame}${page}${bar}<rect x="18" y="58" width="124" height="168" rx="6" fill="#000" opacity=".35"/>
      <rect x="54" y="46" width="94" height="150" rx="8" fill="#25325a"/>
      ${['新しいタブ', '履歴', 'ブックマーク', 'ホーム画面に追加', '共有…'].map((t, i) => `<rect x="58" y="${52 + i * 28}" width="86" height="24" rx="5" fill="${i === 3 ? 'rgba(255,210,63,.18)' : 'none'}"/>
        <text x="64" y="${68 + i * 28}" font-size="${i === 3 ? 9 : 10}" font-weight="${i === 3 ? 900 : 400}" fill="${i === 3 ? '#fff' : '#9fb0d6'}">${t}</text>`).join('')}
      <rect x="56" y="134" width="90" height="28" rx="7" fill="none" stroke="${gold}" stroke-width="3"/></svg>`;
    return `<svg viewBox="0 0 160 240" class="ios-step">${frame}${page}${bar}<rect x="10" y="22" width="140" height="210" fill="#000" opacity=".5"/>
      <rect x="18" y="78" width="124" height="100" rx="12" fill="#25325a"/>
      <text x="80" y="98" text-anchor="middle" font-size="10" font-weight="900" fill="#fff">アプリをインストール</text>
      <rect x="28" y="108" width="26" height="26" rx="6" fill="#0b1a44"/><text x="41" y="119" text-anchor="middle" font-size="7" font-weight="900" fill="#fff" font-style="italic">DUG</text><text x="41" y="129" text-anchor="middle" font-size="7" font-weight="900" fill="${gold}" font-style="italic">OUT</text>
      <text x="62" y="125" font-size="11" fill="#fff">DUGOUT</text>
      <text x="48" y="162" text-anchor="middle" font-size="8" fill="#8fd0ff">キャンセル</text>
      <rect x="78" y="148" width="58" height="20" rx="10" fill="#4da3ff"/><text x="107" y="161.5" text-anchor="middle" font-size="8.5" font-weight="900" fill="#06213f">インストール</text>
      <rect x="74" y="144" width="66" height="28" rx="14" fill="none" stroke="${gold}" stroke-width="3"><animate attributeName="stroke-width" values="3;5;3" dur="1.4s" repeatCount="indefinite"/></rect></svg>`;
  },
  // いま使っている端末（最初に開くタブ）
  get os() { return this.ios ? 'ios' : /android/i.test(navigator.userAgent) ? 'android' : 'pc'; },
  // 端末ごとの追加のしかた（iPhone／Android／PC をタブで切りかえ。表示するのは1つだけ）
  helpHTML(os = this.os) {
    const steps = (svg, caps) => `<div class="ios-steps">${caps.map((c, i) => `<figure>${svg(i + 1)}<figcaption><b>${i + 1}</b> ${c}</figcaption></figure>`).join('')}</div>`;
    const body = {
      ios: steps(n => this.iosStepSVG(n), ['画面の下の<b>共有ボタン</b>（□に↑）を押す', '下にスクロールして「<b>ホーム画面に追加</b>」', '右上の「<b>追加</b>」を押す'])
        + `<p class="muted small" style="margin:8px 0 0">※ <b>Safari</b> で開いているときだけできます。LINE・Slack・X などのアプリの中で開いているときは、メニューから「Safariで開く」を選んでからやってください。</p>`,
      android: steps(n => this.androidStepSVG(n), ['右上の <b>︙</b>（メニュー）を押す', '「<b>ホーム画面に追加</b>」を押す', '「<b>インストール</b>」を押す'])
        + `<p class="muted small" style="margin:8px 0 0">※ <b>Chrome</b> で開いてください。2 は「アプリをインストール」という名前のこともあります。アプリの中で開いているときは、メニューから「ブラウザで開く」を選んでからやってください。</p>`,
      pc: `<ol><li><b>Chrome</b> か <b>Edge</b> で開く</li><li>アドレスバーの右はしにある <b>インストール</b>のマーク（画面に矢印）を押す。見つからなければ右上のメニューから「アプリをインストール」</li>
        <li>「<b>インストール</b>」を押すと、デスクトップやスタートメニューから開けるようになる</li></ol>`,
    };
    const tabs = [['ios', 'iPhone'], ['android', 'Android'], ['pc', 'PC']];
    return `<div class="os-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-start="installOs" data-os="${k}" aria-selected="${k === os}">${l}</button>`).join('')}</div>
      <div class="os-body">${body[os]}</div>`;
  },
  async prompt() {
    if (this.deferred) { const d = this.deferred; this.deferred = null; d.prompt(); try { await d.userChoice; } catch (e) { /* 無視 */ } return true; }
    return false;
  },
};

// ---------- シーズン結果の「成績カード」（SNSにシェアする画像） ----------
const ShareCard = {
  W: 1200, H: 675,
  // 結果をひとことで
  headline(S) {
    if (S.post && S.post.name === '日本一！') return '日本一！';
    if (S.rank === 1) return 'リーグ優勝';
    return `${S.rank}位`;
  },
  text(g, S) {
    const head = this.headline(S);
    const extra = g.dailyText ? `【今日のお題 ${g.dailyText}】` : g.challengeText ? `【チャレンジ「${g.challengeText}」】` : '';
    const url = /^https?:/.test(location.protocol) ? ` ${location.origin}${location.pathname}` : '';
    return `${extra}${g.team.name}で${S.season}年シーズンは${head}（${S.record.w}勝${S.record.l}敗）${head.endsWith('！') ? '' : '！'} GM「${g.gmCareer.title.name}」 #DUGOUT #プロ野球GM${url}`;
  },
  // GM成績カードの投稿文
  careerText(g) {
    const c = g.gmCareer;
    const url = /^https?:/.test(location.protocol) ? ` ${location.origin}${location.pathname}` : '';
    if (!c.seasons) return `GM ${g.profile.gm}（${g.team.name}）、就任1年目のシーズンに挑戦中！ #DUGOUT #プロ野球GM${url}`;
    return `GM ${g.profile.gm}（${g.team.name}）は「${c.title.name}」！ ${c.seasons}シーズン ${c.w}勝${c.l}敗・リーグ優勝${c.league}回・日本一${c.japan}回 #DUGOUT #プロ野球GM${url}`;
  },
  // 背景（夜空の紺と、チームカラーの斜めの帯）とユニフォームを描いたキャンバスを返す
  async base(g, num) {
    const W = this.W, H = this.H;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    // 日本語フォントは文字ごとに分けて配られるので、使う文字を渡して読みこむ
    const glyphs = '日本一！リーグ優勝位' + (g.gmCareer && g.gmCareer.title ? g.gmCareer.title.name : '');
    try { await Promise.all(['400 40px "Dela Gothic One"', '900 30px "M PLUS 1p"', '700 30px "Oswald"'].map(f => document.fonts.load(f, glyphs + '0123456789'))); } catch (e) { /* フォントがなくても描く */ }
    const color = g.team.color || '#1f7bff';
    const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0b1a44'); bg.addColorStop(1, '#050913');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.save(); x.globalAlpha = 0.9; x.fillStyle = color;
    x.beginPath(); x.moveTo(W * 0.56, 0); x.lineTo(W, 0); x.lineTo(W, H); x.lineTo(W * 0.42, H); x.closePath(); x.fill(); x.restore();
    x.save(); x.globalAlpha = 0.18; x.fillStyle = '#fff';
    for (let i = -H; i < W; i += 26) { x.beginPath(); x.moveTo(i, H); x.lineTo(i + H * 0.45, 0); x.lineTo(i + H * 0.45 + 3, 0); x.lineTo(i + 3, H); x.fill(); }
    x.restore();
    // ユニフォーム：うしろからスポットライト、少し傾けて光沢と陰影をつける
    const ux = W - 260, uy = 330;
    const spot = x.createRadialGradient(ux, uy - 40, 20, ux, uy, 330); spot.addColorStop(0, 'rgba(255,255,255,.55)'); spot.addColorStop(0.45, 'rgba(255,255,255,.12)'); spot.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = spot; x.fillRect(ux - 340, 0, 680, H);
    try {
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(uniformSVG(g.profile.uniform, num));
      await img.decode();
      const size = 460, u = document.createElement('canvas'); u.width = u.height = size;
      const ux2 = u.getContext('2d'); ux2.drawImage(img, 0, 0, size, size);
      ux2.globalCompositeOperation = 'source-atop';   // ユニフォームの形の中だけに光と影をのせる
      const sh = ux2.createLinearGradient(0, 0, size, size * 0.9);
      sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.36, 'rgba(255,255,255,0)'); sh.addColorStop(0.42, 'rgba(255,255,255,.32)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,.28)');
      ux2.fillStyle = sh; ux2.fillRect(0, 0, size, size);
      x.save(); x.fillStyle = 'rgba(0,0,0,.35)'; x.filter = 'blur(10px)'; x.beginPath(); x.ellipse(ux, uy + 225, 170, 22, 0, 0, Math.PI * 2); x.fill(); x.restore();
      x.save(); x.translate(ux, uy); x.rotate(-0.07); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 40; x.shadowOffsetY = 18; x.drawImage(u, -size / 2, -size / 2); x.restore();
    } catch (e) { /* 絵が描けなくても続ける */ }
    const txt = (t, px, py, size, col = '#fff', font = '"M PLUS 1p"', weight = 700) => { x.font = `${weight} ${size}px ${font}, sans-serif`; x.fillStyle = col; x.fillText(t, px, py); };
    const fit = (t, size, maxW, font, weight) => { let sz = size; x.font = `${weight} ${sz}px ${font}, sans-serif`; while (x.measureText(t).width > maxW && sz > 18) { sz -= 2; x.font = `${weight} ${sz}px ${font}, sans-serif`; } return sz; };
    x.textBaseline = 'alphabetic';
    txt('DUG', 60, 88, 46, '#fff', '"Oswald"', 700); const dw = x.measureText('DUG').width; txt('OUT', 60 + dw, 88, 46, '#ffd23f', '"Oswald"', 700);
    x.textAlign = 'right'; txt('#DUGOUT', W - 50, H - 34, 26, '#fff', '"Oswald"'); x.textAlign = 'left';
    return { c, x, txt, fit };
  },
  // パターン②：GMの通算成績
  async drawCareer(g) {
    const cr = g.gmCareer, W = this.W;
    const { c, x, txt, fit } = await this.base(g, 18);
    txt('GM CAREER', 60, 138, 26, '#a9b6d8', '"Oswald"');
    const nm = `GM ${g.profile.gm}`;
    txt(nm, 60, 215, fit(nm, 60, 640, '"M PLUS 1p"', 900), '#fff', '"M PLUS 1p"', 900);
    x.save(); const gr = x.createLinearGradient(0, 240, 0, 330); gr.addColorStop(0, '#fff1a8'); gr.addColorStop(0.5, '#ffd23f'); gr.addColorStop(1, '#d99a00');
    x.fillStyle = gr; x.font = `400 ${fit(cr.title.name, 84, 640, '"Dela Gothic One"', 400)}px "Dela Gothic One", sans-serif`; x.fillText(cr.title.name, 56, 318); x.restore();
    const sub = cr.seasons ? `${g.team.name}　${cr.seasons}シーズン　GM評価 平均${cr.avg}点` : `${g.team.name}　就任1年目`;
    txt(sub, 60, 368, fit(sub, 28, 620, '"M PLUS 1p"', 700), '#eef3ff');
    // 数字のマス
    const cells = [['通算', `${cr.w}勝${cr.l}敗`], ['勝率', cr.w + cr.l ? Util.winRate(cr.w, cr.l) : '-'], ['リーグ優勝', `${cr.league}回`], ['日本一', `${cr.japan}回`],
      ['プレーオフ', `${cr.cs}回`], ['目標達成', `${cr.goals}回`], ['ドラフト指名', `${(g.gmLog || {}).draft || 0}人`], ['永久欠番', `${(g.retiredNumbers || []).length}`]];
    cells.forEach(([k, v], i) => {
      const cx = 60 + (i % 4) * 152, cy = 400 + Math.floor(i / 4) * 92;
      x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(cx, cy, 144, 82);
      txt(k, cx + 12, cy + 28, 17, '#ffd23f', '"M PLUS 1p"', 900);
      txt(v, cx + 12, cy + 66, fit(v, 30, 124, '"Oswald"', 700), '#fff', '"Oswald"', 700);
    });
    const b = cr.best;
    if (b) { const t = `ベスト：${b.season}年 ${b.post && b.post !== 'ポストシーズン進出ならず' ? b.post : `${b.rank}位`}（${b.w}勝${b.l}敗）`; txt(t, 60, 630, fit(t, 24, 640, '"M PLUS 1p"', 700), '#eef3ff'); }
    else txt('1年目のシーズンを戦っている最中', 60, 630, 24, '#a9b6d8');
    return c;
  },
  // パターン①：シーズンの結果
  async draw(g, S) {
    const W = this.W, H = this.H;
    const { c, x, txt, fit } = await this.base(g, S.mvp ? S.mvp.number : 18);
    const head = this.headline(S), japan = head === '日本一！';
    // 優勝・日本一は紙吹雪（今日のお題の乱数をずらさないよう、ここだけの乱数で）
    if (japan || S.rank === 1) {
      let r = 12345; const rnd = () => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648;
      const cols = japan ? ['#ffd23f', '#fff1a8', '#ffffff', '#d99a00'] : ['#ffd23f', '#ffffff'];
      for (let i = 0; i < 70; i++) {
        const px = 560 + rnd() * 640, py = rnd() * H * 0.9;
        x.save(); x.translate(px, py); x.rotate(rnd() * Math.PI); x.globalAlpha = 0.55 + rnd() * 0.45; x.fillStyle = cols[i % cols.length];
        x.fillRect(-6, -3, 10 + rnd() * 6, 5 + rnd() * 3); x.restore();
      }
    }
    txt(`${S.season}年シーズン 結果`, 60, 138, 26, '#a9b6d8');
    const tn = g.team.name, tsz = fit(tn, 64, 640, '"M PLUS 1p"', 900);   // 漢字が多い球団名もそろって見えるように
    txt(tn, 60, 220, tsz, '#fff', '"M PLUS 1p"', 900);
    // 結果
    x.save();
    if (japan) { const gr = x.createLinearGradient(60, 250, 60, 360); gr.addColorStop(0, '#fff1a8'); gr.addColorStop(0.5, '#ffd23f'); gr.addColorStop(1, '#d99a00'); x.fillStyle = gr; }
    else x.fillStyle = S.rank === 1 ? '#ffd23f' : '#ffffff';
    x.font = `400 ${japan ? 110 : 96}px "Dela Gothic One", sans-serif`; x.fillText(head, 56, 352); x.restore();
    const post = S.post && S.post.name && !japan && S.post.name !== 'ポストシーズン進出ならず' ? `（${S.post.name}）` : '';
    txt(`${S.record.w}勝 ${S.record.l}敗${S.record.d ? ` ${S.record.d}分` : ''}　勝率 ${Util.winRate(S.record.w, S.record.l)}${post}`, 60, 405, 30, '#eef3ff');
    // GM と MVP
    const hist = g.gmHistory || [], last = hist[hist.length - 1];
    const score = last ? gmSeasonScore(last) : 0;
    x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(60, 440, 600, 70); x.fillRect(60, 520, 600, 70);
    txt('GM', 80, 486, 24, '#ffd23f', '"Oswald"'); txt(`${g.profile.gm}　「${g.gmCareer.title.name}」 GM評価 ${score}点`, 140, 486, fit(`${g.profile.gm}　「${g.gmCareer.title.name}」 GM評価 ${score}点`, 28, 500, '"M PLUS 1p"', 700));
    txt('MVP', 80, 566, 24, '#ffd23f', '"Oswald"');
    const mv = S.mvp ? `#${S.mvp.number} ${S.mvp.name}（${S.mvp.line}）` : '―';
    txt(mv, 150, 566, fit(mv, 28, 490, '"M PLUS 1p"', 700));
    // チャレンジ・今日のお題
    const badge = g.dailyText ? `今日のお題 ${g.dailyText}` : g.challengeText ? `チャレンジ「${g.challengeText}」${g.challengeDone === 'clear' ? ' 達成！' : ''}` : '';
    if (badge) { x.font = '900 22px "M PLUS 1p", sans-serif'; const bw = x.measureText(badge).width + 32; x.fillStyle = '#ff4d5e'; x.fillRect(60, 610, bw, 40); txt(badge, 76, 639, 22, '#fff', '"M PLUS 1p"', 900); }
    return c;
  },
};

// ---------- タイトル・はじめの設定 ----------
const TEAM_COLORS = [
  ['#1f7a45', '芝生グリーン'], ['#c2452f', 'ファイヤーレッド'], ['#2a5db0', 'オーシャンブルー'],
  ['#d38b1c', 'サンセットオレンジ'], ['#6d5fc7', 'ナイトパープル'], ['#222831', 'ブラック'],
];
const StartScreen = {
  color: TEAM_COLORS[0][0],
  shortEdited: false,
  show(mode) {
    const el = $('start');
    el.hidden = false;
    document.body.classList.add('on-start');
    $('modal').hidden = true;
    el.innerHTML = mode === 'title' ? this.titleHTML() : mode === 'saves' ? this.savesHTML() : this.setupHTML();
    const first = el.querySelector('input, button');
    if (first) first.focus();
  },
  hide() {
    $('start').hidden = true;
    document.body.classList.remove('on-start');
  },
  titleHTML() {
    return `<div class="start-box title-box"><div class="tb-hero">
      <div class="start-logo">DUG<span>OUT</span></div>
      <div class="start-tag">ダグアウト ─ 仲間が集う場所から、<wbr>頂点へ。</div>
      <p class="start-lead">プロ野球球団のGMになって、選手を集め、育て、お金をやりくりしてリーグ優勝をめざそう。</p>
      ${this.mainCtaHTML()}
      </div><div class="tb-main">
      <div class="other-head">ほかの遊び方</div>
      ${this.dailyHTML()}
      <div class="daily-card ch-card"><div class="daily-head"><span class="tag-mode">チャレンジモード</span><b>条件つきでGMの腕をためす</b></div>
        <div class="muted small">${Object.values(CHALLENGES).map(c => `<span class="nb">${E(c.name)}</span>`).join('／')}</div>
        <div class="row-actions"><button class="btn-sm go" data-start="challenge">チャレンジを選んで始める</button></div>
        <div class="muted small">「新しく始める」の設定画面の「遊び方」でも選べます</div></div>
      </div><div class="tb-side">
      ${Install.standalone ? '' : `<div class="install-card"><button class="btn btn-ghost install-btn" data-start="install">📲 ${Install.mobile ? 'ホーム画面に追加する（アプリのように遊べる）' : 'PCにアプリとして追加する'}</button>
        <div class="install-help" ${this.installOpen ? '' : 'hidden'}>${Install.helpHTML()}</div></div>`}
      <p class="start-credit"><span class="nb">登場する球団・選手・企業はすべて架空です（企業名は有名企業をもじったパロディで、実在の企業とは関係ありません）。</span><span class="nb">お祭りなどの地名・行事は実在のものですが、主催者・関係団体とは関係ありません。</span><span class="nb">セーブはこのブラウザの中だけに保存され、外部には送信しません。</span><br><span class="nb">個人のファンメイド作品で、プロ野球の団体・球団・企業とは関係ありません。</span><br>© 2026 ゴッホ</p>
    </div></div>`;
  },
  // セーブデータの画面（「続きから遊ぶ」で開く）
  savesHTML() {
    const cards = Save.slots().map(n => {
      const m = Save.summary(n);
      const armed = this.armedDel === n;
      if (!m) return `<div class="slot empty"><div class="slot-no">スロット${n}</div><div class="muted small">データなし</div>
        <button class="btn-sm go" data-start="new" data-slot="${n}">ここで新しく始める</button></div>`;
      const t = m.savedAt ? new Date(m.savedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      return `<div class="slot"><div class="slot-no">スロット${n}${t ? `<span class="muted small">　${t} 保存</span>` : ''}</div>
        <div class="save-team"><span class="tdot" style="background:${E(m.color)}"></span>${E(m.team)}</div>
        <div class="muted small">GM ${E(m.gm)} ／ ${m.season}年 ${E(m.when)} ／ 資金 ${Util.money(m.funds)}</div>
        <div class="row-actions"><button class="btn-sm go" data-start="continue" data-slot="${n}">続きから</button>
          <button class="btn-sm ${armed ? 'warn' : ''}" data-start="del" data-slot="${n}">${armed ? '本当に消す' : '消す'}</button></div></div>`;
    }).join('');
    const any = Save.slots().some(n => Save.summary(n));
    return `<div class="start-box saves-box">
      <div class="eyebrow">セーブデータ</div>
      <h2 class="saves-title">どのデータで遊ぶ？</h2>
      <div class="muted small">3つまで。遊んでいるスロットに自動で保存されます</div>
      ${any ? '' : '<p class="muted">セーブデータはありません。</p>'}
      <div class="slots">${cards}</div>
      <div class="row-actions"><button type="button" class="btn btn-ghost" data-start="back">タイトルに戻る</button></div>
    </div>`;
  },
  // いちばん大きな入口（ふつうに遊ぶ）。セーブがあれば、最後に遊んだものの「続きから」も出す
  mainCtaHTML() {
    const saved = Save.slots().map(n => ({ n, m: Save.summary(n) })).filter(x => x.m).sort((a, b) => (b.m.savedAt || 0) - (a.m.savedAt || 0));
    const last = saved[0];
    return `<div class="main-cta">
      ${last ? `<button class="btn btn-play cta-btn" data-start="saves"><span>続きから遊ぶ</span><small>セーブデータを選ぶ（最後に遊んだのは ${E(last.m.team)}　${last.m.season}年 ${E(last.m.when)}）</small></button>` : ''}
      <button class="btn ${last ? 'btn-ghost' : 'btn-play'} cta-btn" data-start="newAuto"><span>${last ? '新しく始める' : 'ゲームをはじめる'}</span><small>12球団から1つを選んでGMに。何年でもじっくり遊べる</small></button>
    </div>`;
  },
  // 今日のお題（タイトルに出す）
  dailyHTML() {
    const c = Daily.cond(), best = Daily.best(c.date);
    const j = Save.read('daily'), going = j && j.daily && j.daily.date === c.date && !j.daily.done;
    return `<div class="daily-card"><div class="daily-head"><span class="tag-mode">今日のお題</span><b>${E(Daily.label(c))}</b></div>
      <div class="muted small">全員が同じ条件で1シーズンだけ戦う。GM評価で友だちと勝負！${best ? `　今日のベスト <b class="good">${best}点</b>` : ''}</div>
      <div class="row-actions">${going ? '<button class="btn-sm go" data-start="dailyContinue">続きから</button>' : ''}
        <button class="btn-sm ${going ? '' : 'go'}" data-start="daily">${going ? '最初から挑戦しなおす' : best ? 'もう一度挑戦する' : '挑戦する'}</button></div></div>`;
  },
  setupHTML() {
    const d = INITIAL_DATA.profile;
    const hasSave = !!Save.read(this.newSlot);
    this.newSlot = this.newSlot || 1;
    this.pick = this.pick || 'bib';
    const pd = teamDef(this.pick);
    this.color = pd.color; this.shortEdited = false;
    try { this.gmName = localStorage.getItem('dugout-public-gm') || ''; } catch (e) { this.gmName = ''; }   // 前に使ったGM名を入れておく
    return `<form class="start-box setup" id="setupForm" novalidate>
      <div class="eyebrow">はじめの設定</div>
      <h1 class="setup-title">担当する球団を選ぼう</h1>
      <label class="field"><span>あなたのGM名（名前・ニックネーム）</span><input id="setGm" maxlength="12" value="${E(this.gmName || '')}" placeholder="例：たろう" required autocomplete="off"></label>
      <fieldset class="field"><legend>担当する球団（12球団から選ぶ）</legend>
        ${[TEAM_CATALOG.central, TEAM_CATALOG.pacific].map(lg => `<div class="pick-lg">${lg.name}</div><div class="pick-grid">${lg.teams.map(t =>
          `<button type="button" class="pick" data-pick="${t.id}" aria-pressed="${t.id === this.pick}" style="--tc:${t.color}"><span class="pick-dot"></span><b>${E(t.name)}</b><small><span class="pk-lbl">本拠地：</span>${E(t.city)}</small></button>`).join('')}</div>`).join('')}
      </fieldset>
      <fieldset class="field"><legend>難易度（あとから球団タブで変えられる）</legend><div class="diff-opts">
        ${Object.entries(DIFFICULTY).map(([k, d]) => `<label class="diff-opt"><input type="radio" name="setDiff" value="${k}" ${k === 'easy' ? 'checked' : ''}><b>${d.name}</b><span>${d.desc}</span></label>`).join('')}
      </div></fieldset>
      <fieldset class="field" id="modeField"><legend>遊び方</legend>
        <label class="diff-opt mode-normal"><input type="radio" name="setMode" value="" ${this.modePick ? '' : 'checked'}><b>ふつうに遊ぶ</b><span>期限なし。じっくり球団を育てよう</span></label>
        <details class="setup-more" ${this.modePick ? 'open' : ''}><summary>チャレンジモードで遊ぶ（${Object.keys(CHALLENGES).length}種類）</summary><div class="diff-opts mode-opts">
        ${Object.entries(CHALLENGES).map(([k, c]) => `<label class="diff-opt"><input type="radio" name="setMode" value="${k}" ${this.modePick === k ? 'checked' : ''}><b>${E(c.name)}</b><span>${E(c.desc)}</span></label>`).join('')}
        </div></details>
      </fieldset>
      <details class="setup-more" id="nameMore"><summary>球団名・球場名・チームカラーを変える（そのままでもOK）</summary>
      <label class="field"><span>球団名</span><input id="setTeam" maxlength="16" value="${E(pd.name)}" required autocomplete="off"></label>
      <label class="field"><span>略称（スコアボードに出る2〜3文字）</span><input id="setShort" maxlength="3" value="${E(pd.short)}" required autocomplete="off"></label>
      <label class="field"><span>本拠地の球場名（最初は市民球場。強くなったら大きな球場へ移転できる）</span><input id="setStadium" maxlength="20" value="${E(pd.short)}市民球場" required autocomplete="off"></label>
      <fieldset class="field"><legend>チームカラー</legend><div class="swatches">
        ${TEAM_COLORS.map(([c, n], i) => `<button type="button" class="swatch" data-color="${c}" aria-pressed="${i === 0}" aria-label="${n}" title="${n}" style="background:${c}"></button>`).join('')}
      </div></fieldset>
      </details>
      <p class="setup-error" id="setupError" hidden></p>
      <div class="start-actions setup-go">
        <button type="submit" class="btn btn-play"><span class="go-long">${hasSave ? `この内容で始める（スロット${this.newSlot}を上書き）` : `この内容で始める（スロット${this.newSlot}）`}</span><span class="go-short">${hasSave ? `はじめる（スロット${this.newSlot}を上書き）` : 'はじめる'}</span></button>
        <button type="button" class="btn btn-ghost" data-start="back">戻る</button>
      </div>
      <p class="start-credit">登場する球団・選手・企業はすべて架空です（企業名は有名企業をもじったパロディで、実在の企業とは関係ありません）。お祭りなどの地名・行事は実在のものですが、主催者・関係団体とは関係ありません。進行はこのブラウザの中だけに保存され、外部には送信しません。<br>個人のファンメイド作品で、プロ野球の団体・球団・企業とは関係ありません。<br>© 2026 ゴッホ</p>
    </form>`;
  },
  begin(g) {
    game = g;
    if (g.daily) Daily.enter(g); else Daily.exit();
    this.hide();
    UI.marketMsg = UI.officeMsg = UI.draftMsg = null;
    UI.trade = { mine: '', theirs: '' };
    UI.resume();
  },
  bind() {
    const el = $('start');
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-start], [data-color], [data-pick]');
      if (!b) return;
      if (b.dataset.pick) {
        // 球団を選ぶと、名前・略称・球場名・カラーを入れなおす
        const t = teamDef(b.dataset.pick);
        this.pick = t.id; this.color = t.color; this.shortEdited = false;
        el.querySelectorAll('[data-pick]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        $('setTeam').value = t.name; $('setShort').value = t.short; $('setStadium').value = `${t.short}市民球場`;
        el.querySelectorAll('[data-color]').forEach(x => x.setAttribute('aria-pressed', 'false'));
        return;
      }
      if (b.dataset.color) {
        this.color = b.dataset.color;
        el.querySelectorAll('[data-color]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        return;
      }
      const a = b.dataset.start, n = Number(b.dataset.slot) || 1;
      if (a !== 'del') this.armedDel = null;
      if (a === 'installOs') {
        const h = el.querySelector('.install-help');
        if (h) h.innerHTML = Install.helpHTML(b.dataset.os);
        return;
      }
      if (a === 'install') {
        Install.prompt().then(done => { if (!done) { this.installOpen = !this.installOpen; const h = document.querySelector('.install-help'); if (h) h.hidden = !this.installOpen; } });
        return;
      }
      if (a === 'daily' || a === 'dailyContinue') {
        let g = null;
        if (a === 'dailyContinue') g = Save.load('daily');
        if (!g) {
          let gm = 'ゲストGM'; try { gm = localStorage.getItem('dugout-public-gm') || gm; } catch (e2) { /* 無視 */ }
          Save.slot = 'daily'; Save.clear('daily'); g = Daily.start(gm);
        }
        Save.slot = 'daily';
        this.begin(g);
        UI.toast(`今日のお題：${g.dailyText}`);
        return;
      }
      if (a === 'continue') {
        const g = Save.load(n);
        if (g) this.begin(g); else { UI.toast('セーブを読み込めませんでした'); this.show('title'); }
      } else if (a === 'new') { this.newSlot = n; this.modePick = null; this.show('setup'); }
      else if (a === 'newAuto') { this.newSlot = Save.slots().find(k => !Save.read(k)) || 1; this.modePick = null; this.show('setup'); }
      else if (a === 'challenge') {
        // 空いているスロット（なければ1）で、チャレンジを選んだ状態の設定画面を開く
        this.newSlot = Save.slots().find(k => !Save.read(k)) || 1;
        this.modePick = Object.keys(CHALLENGES)[0];
        this.show('setup');
        const f = $('modeField'); if (f) f.scrollIntoView({ block: 'start' });
      }
      else if (a === 'del') {
        if (this.armedDel !== n) { this.armedDel = n; this.show('saves'); return; }
        this.armedDel = null; Save.clear(n); this.show('saves'); UI.toast(`スロット${n}のセーブを消しました`);
      }
      else if (a === 'back') this.show('title');
      else if (a === 'saves') this.show('saves');
    });
    // 球団名から略称を自動で入れる（略称を自分で書いたらそのまま）
    el.addEventListener('input', e => {
      if (e.target.id === 'setShort') this.shortEdited = true;
      if (e.target.id === 'setTeam' && !this.shortEdited) $('setShort').value = e.target.value.trim().slice(0, 2);
    });
    el.addEventListener('submit', e => {
      e.preventDefault();
      const v = id => $(id).value.trim();
      const diffEl = document.querySelector('input[name="setDiff"]:checked');
      const profile = { teamName: v('setTeam'), short: v('setShort'), stadium: v('setStadium'), gm: v('setGm'), color: this.color, difficulty: diffEl ? diffEl.value : 'easy', pick: this.pick };
      const missing = [['teamName', '球団名'], ['short', '略称'], ['stadium', '球場名'], ['gm', 'GM名']].filter(([k]) => !profile[k]).map(([, n]) => n);
      if (missing.length) {
        const err = $('setupError');
        err.hidden = false;
        err.textContent = `${missing.join('・')}を入力してください`;
        if (!profile.gm) { $('setGm').focus(); $('setGm').scrollIntoView({ block: 'center' }); }
        else { $('nameMore').open = true; }
        return;
      }
      const modeEl = document.querySelector('input[name="setMode"]:checked');
      profile.tut = 0;   // はじめてのガイドを出す
      if (modeEl && modeEl.value) profile.challenge = { id: modeEl.value, start: INITIAL_DATA.season };
      try { localStorage.setItem('dugout-public-gm', profile.gm); } catch (e2) { /* 無視 */ }
      Save.slot = this.newSlot || 1;
      Save.clear(Save.slot);
      Daily.exit();
      const g = new GameState(INITIAL_DATA, profile);
      if (g.challengeDef) { g.challengeDef.setup(g); g.seasonStart = { funds: g.finance.funds, fans: g.finance.fans, owner: g.ownerRating, loan: 0 }; }
      this.begin(g);
      UI.toast(g.challengeDef ? `チャレンジ「${g.challengeText}」スタート！` : `${profile.gm}GM、就任おめでとう！`);
    });
  },
};

// ---------- 起動 ----------
let game = null;
UI.bindEvents();
Tabs.init();
StartScreen.bind();
Install.init();
Save.migrate();
StartScreen.show('title');
