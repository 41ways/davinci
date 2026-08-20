/* 규칙 엔진 테스트 — node rules.test.js */
var R = require('./rules.js');

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }
function P(n){ var a=[]; for(var i=0;i<n;i++) a.push({id:'p'+i,name:'P'+i}); return a; }

// 조커를 뺀 숫자 타일들이 오름차순인가
function sorted(hand) {
  var ks = hand.filter(function(x){ return !R.isJoker(x.tile); }).map(function(x){ return R.tileKey(x.tile); });
  for (var i = 1; i < ks.length; i++) if (ks[i-1] > ks[i]) return false;
  return true;
}
function allTiles(s) {
  var out = [];
  s.players.forEach(function(p){ p.hand.forEach(function(x){ out.push(R.tileId(x.tile)); }); });
  s.pool.forEach(function(t){ out.push(R.tileId(t)); });
  if (s.drawn) out.push(R.tileId(s.drawn));
  if (s.pending) out.push(R.tileId(s.pending.tile));
  return out;
}
// 각자 바닥에서 손패를 채우고 준비까지 마친다
function begin(s){
  s.players.forEach(function(p){
    while (p.hand.length < s.handSize) R.draftPick(s, p.id, 0);
    R.setupReady(s, p.id);
  });
  return s;
}
function firstHidden(p){ for(var i=0;i<p.hand.length;i++) if(!p.hand[i].faceUp) return i; return -1; }
// 놓기 단계를 자동으로 넘긴다
function settle(s){ if (s.phase === 'place') R.place(s, R.current(s).id, s.pendingSpotsFallback !== undefined ? s.pendingSpotsFallback : R.validPlacements(R.current(s).hand, s.pending.tile)[0]); }

/* ---------------- 덱 ---------------- */
section('덱 / 초기 배치');
var deck = R.createDeck();
ok('타일 26장 (숫자 24 + 조커 2)', deck.length === 26, deck.length);
ok('타일 중복 없음', new Set(deck.map(R.tileId)).size === 26);
ok('조커 2장', deck.filter(R.isJoker).length === 2);
ok('조커는 색이 하나씩', new Set(deck.filter(R.isJoker).map(function(t){return t.color;})).size === 2);
ok('검정이 흰색보다 작다', R.tileKey({color:'b',n:5}) < R.tileKey({color:'w',n:5}));
ok('조커 라벨', R.tileLabel({color:'b',joker:true}) === '검정 조커');

[[2,4],[3,3],[4,3]].forEach(function(c){
  var s = R.newGame(P(c[0]), 7);
  ok(c[0]+'인 시작 손패는 비어 있다', s.players.every(function(p){return p.hand.length===0;}));
  ok(c[0]+'인 바닥에 26장 전부', s.pool.length === 26);
  ok(c[0]+'인 목표 손패 '+c[1]+'장', s.handSize === c[1]);
  begin(s);
  ok(c[0]+'인 채운 뒤 '+c[1]+'장', s.players.every(function(p){return p.hand.length===c[1];}));
  ok(c[0]+'인 정렬됨(조커 제외)', s.players.every(function(p){return sorted(p.hand);}));
  ok(c[0]+'인 26장 보존', new Set(allTiles(s)).size === 26);
});

/* ---------------- 시작 손패 정리 ---------------- */
section('시작 손패 정리');
(function(){
  var st = R.newGame(P(3), 77);
  ok('시작은 setup', st.phase === 'setup');
  ok('아무도 준비 안 됨', Object.keys(st.ready).length === 0);
  ok('손패는 비어 있고 바닥에 26장', st.players.every(function(p){return p.hand.length===0;}) && st.pool.length===26);

  ok('없는 자리 거부', R.draftPick(st, 'p0', 99).ok === false);
  ok('다 고르기 전엔 준비 불가', R.setupReady(st, 'p0').ok === false);
  var poolBefore = st.pool.length;
  var want = st.pool[2];
  ok('원하는 타일을 골라온다', R.draftPick(st, 'p0', 2).ok === true);
  ok('그 타일이 손패에 들어옴', st.players[0].hand.some(function(x){ return R.tileId(x.tile)===R.tileId(want); }));
  ok('바닥 1장 감소', st.pool.length === poolBefore - 1);
  while (st.players[0].hand.length < st.handSize) R.draftPick(st, 'p0', 0);
  ok('다 채우면 더 못 고름', R.draftPick(st, 'p0', 0).ok === false);
  ok('고르는 동안 정렬 유지', sorted(st.players[0].hand));
  st.players.slice(1).forEach(function(p){
    while (p.hand.length < st.handSize) R.draftPick(st, p.id, 0);
  });
  var lens = st.players.map(function(p){ return p.hand.length; });
  ok('손패 장수가 모두 같다', lens.every(function(x){ return x === lens[0]; }), JSON.stringify(lens));

  // 조커를 가진 사람 찾기 — 없으면 직접 만들어 검증
  var who = null, at = -1;
  st.players.forEach(function(p, pi){
    p.hand.forEach(function(x, i){ if (R.isJoker(x.tile) && who === null) { who = p; at = i; } });
  });
  if (!who) { who = st.players[0]; who.hand[1] = { tile: J('b'), faceUp:false, missed:[] }; at = 1; }

  var before = who.hand.map(function(x){ return R.tileId(x.tile); });
  ok('조커를 맨 앞으로 옮김', R.setupMove(st, who.id, at, 0).ok === true);
  ok('조커가 0번에 있다', R.isJoker(who.hand[0].tile));
  ok('숫자 순서는 그대로', sorted(who.hand));
  ok('장수 변화 없음', who.hand.length === before.length);
  ok('맨 뒤로도 옮길 수 있다',
     (R.setupMove(st, who.id, 0, who.hand.length - 1).ok && R.isJoker(who.hand[who.hand.length-1].tile)));

  // 숫자 타일은 못 옮긴다
  var numAt = -1;
  who.hand.forEach(function(x,i){ if (!R.isJoker(x.tile) && numAt < 0) numAt = i; });
  ok('숫자 타일 이동 거부', R.setupMove(st, who.id, numAt, 0).ok === false);

  // 준비
  ok('한 명 준비해도 시작 안 함', (R.setupReady(st, st.players[0].id).ok && st.phase === 'setup'));
  R.setupReady(st, st.players[1].id);
  ok('두 명만으로도 아직', st.phase === 'setup');
  R.setupReady(st, st.players[2].id);
  ok('모두 준비하면 시작', st.phase === 'draw');
  ok('준비 끝나면 이동 거부', R.setupMove(st, who.id, 0, 1).ok === false);
})();

/* ---------------- 준비 전 색 은닉 ---------------- */
section('준비 전 색 은닉');
(function(){
  var st = R.newGame(P(3), 88);
  st.players.forEach(function(p){ while (p.hand.length < st.handSize) R.draftPick(st, p.id, 0); });

  var v = R.viewFor(st, 'p0');
  var 남 = v.players.filter(function(p){ return p.id !== 'p0'; });
  ok('정리 중인 남의 패는 색도 모른다', 남.every(function(p){
    return p.hand.every(function(x){ return x.tile.color === null; }); }));
  ok('내 패는 숫자까지 보인다', v.players[0].hand.every(function(x){ return x.tile.n !== null || x.tile.joker === true; }));

  R.setupReady(st, 'p1');
  var v2 = R.viewFor(st, 'p0');
  var p1 = v2.players.filter(function(p){ return p.id === 'p1'; })[0];
  var p2 = v2.players.filter(function(p){ return p.id === 'p2'; })[0];
  ok('준비를 마치면 색이 공개된다', p1.hand.every(function(x){ return x.tile.color === 'b' || x.tile.color === 'w'; }));
  ok('아직 정리 중인 사람은 여전히 비밀', p2.hand.every(function(x){ return x.tile.color === null; }));
  ok('공개돼도 숫자는 비밀', p1.hand.every(function(x){ return x.tile.n === null; }));

  R.setupReady(st, 'p0'); R.setupReady(st, 'p2');
  var v3 = R.viewFor(st, 'p0');
  ok('모두 시작하면 전원 색 공개', v3.players.every(function(p){
    return p.hand.every(function(x){ return x.tile.color === 'b' || x.tile.color === 'w'; }); }));
})();

/* ---------------- 놓을 자리 ---------------- */
section('놓을 자리');
function H(list){ return list.map(function(t){ return {tile:t, faceUp:false}; }); }
var b = function(n){ return {color:'b', n:n, joker:false}; };
var w = function(n){ return {color:'w', n:n, joker:false}; };
var J = function(c){ return {color:c, n:null, joker:true}; };

ok('빈 손패엔 0번만', JSON.stringify(R.validPlacements([], b(5))) === '[0]');
ok('조커는 어디든', JSON.stringify(R.validPlacements(H([b(1),b(5)]), J('w'))) === '[0,1,2]');
ok('숫자는 정렬 자리에만', JSON.stringify(R.validPlacements(H([b(1),b(5)]), b(3))) === '[1]');
ok('맨 앞', JSON.stringify(R.validPlacements(H([b(4),b(9)]), b(1))) === '[0]');
ok('맨 뒤', JSON.stringify(R.validPlacements(H([b(4),b(9)]), b(11))) === '[2]');
ok('같은 숫자면 검정이 왼쪽', JSON.stringify(R.validPlacements(H([w(5)]), b(5))) === '[0]');
ok('같은 숫자면 흰색이 오른쪽', JSON.stringify(R.validPlacements(H([b(5)]), w(5))) === '[1]');
// 조커가 끼면 자리가 여러 곳
ok('조커 옆이면 자리가 둘', JSON.stringify(R.validPlacements(H([b(1),J('w'),b(9)]), b(5))) === '[1,2]');
ok('조커만 있으면 전부 가능', JSON.stringify(R.validPlacements(H([J('b'),J('w')]), b(5))) === '[0,1,2]');
// 어느 자리에 놓아도 정렬이 유지되는가
(function(){
  var base = H([b(1), J('w'), b(9)]);
  var okAll = R.validPlacements(base, b(5)).every(function(i){
    var h = base.slice(); h.splice(i, 0, {tile:b(5), faceUp:false});
    return sorted(h);
  });
  ok('유효한 자리는 모두 정렬을 지킨다', okAll);
})();

/* ---------------- 바닥에서 집기 ---------------- */
section('바닥에서 집기');
var s = R.newGame(P(3), 42);
ok('시작 phase=setup', s.phase === 'setup');
ok('준비 전에는 못 집음', R.draw(s, 'p0', 0).ok === false);
begin(s);
ok('모두 준비하면 phase=draw', s.phase === 'draw');
ok('남의 차례엔 못 집음', R.draw(s, 'p1', 0).ok === false);
ok('없는 자리 거부', R.draw(s, 'p0', 999).ok === false);
var poolBefore = s.pool.length;
var wanted = s.pool[3];
ok('원하는 자리를 집는다', R.draw(s, 'p0', 3).ok === true);
ok('집은 것이 그 타일', R.tileId(s.drawn) === R.tileId(wanted));
ok('바닥 1장 감소', s.pool.length === poolBefore - 1);
ok('집은 뒤 phase=guess', s.phase === 'guess');
ok('색만 노출되는 바닥 시야', R.viewFor(s,'p1').pool.every(function(t){ return t.n === undefined && (t.color==='b'||t.color==='w'); }));

/* ---------------- 추측 ---------------- */
section('추측');
ok('자기 타일 거부', R.guess(s,'p0','p0',0,'b',1).ok === false);
ok('잘못된 숫자 거부', R.guess(s,'p0','p1',0,'b',12).ok === false);
var t1 = s.players[1].hand[0].tile;
var g1 = R.guess(s,'p0','p1',0,t1.color, R.isJoker(t1) ? null : t1.n);
ok('적중', g1.ok && g1.hit === true);
ok('공개됨', s.players[1].hand[0].faceUp === true);
ok('phase=decide', s.phase === 'decide');

// 조커 맞히기
(function(){
  var st = begin(R.newGame(P(2), 4));
  st.players[1].hand = [{tile:J('w'), faceUp:false}, {tile:b(3), faceUp:false}];
  st.pool = [b(7)];
  R.draw(st,'p0',0);
  ok('조커를 숫자로 부르면 빗나감', R.guess(st,'p0','p1',0,'w',5).hit === false);
  st.turn = 0; st.phase = 'guess'; st.drawn = b(8);
  ok('조커를 조커로 부르면 적중', R.guess(st,'p0','p1',0,'w',null).hit === true);
  st.turn = 0; st.phase = 'guess'; st.drawn = b(9);
  ok('일반 타일을 조커로 부르면 빗나감', R.guess(st,'p0','p1',1,'b',null).hit === false);
})();

/* ---------------- 빗나간 시도 기록 ---------------- */
section('빗나간 시도 기록');
(function(){
  var st = begin(R.newGame(P(2), 33));
  st.players[1].hand = [{tile:b(3),faceUp:false,missed:[]},{tile:w(8),faceUp:false,missed:[]}];
  st.pool = [b(0), b(1), b(2)];
  function 시도(n){ st.turn=0; st.phase='draw'; st.drawn=null; st.pending=null;
    R.draw(st,'p0',0); R.guess(st,'p0','p1',0,'b',n);
    if (st.phase === 'place') R.place(st,'p0', R.validPlacements(st.players[0].hand, st.pending.tile)[0]); }
  시도(7);
  ok('빗나가면 그 칸에 기록', JSON.stringify(st.players[1].hand[0].missed) === '[7]');
  시도(9);
  ok('여러 번 쌓인다', JSON.stringify(st.players[1].hand[0].missed) === '[7,9]');
  시도(7);
  ok('같은 값은 중복 안 됨', JSON.stringify(st.players[1].hand[0].missed) === '[7,9]');
  시도(null);
  ok('조커 시도도 기록(null)', JSON.stringify(st.players[1].hand[0].missed) === '[7,9,null]');
  ok('다른 칸은 영향 없음', JSON.stringify(st.players[1].hand[1].missed) === '[]');
  ok('적중한 칸엔 기록되지 않음', (function(){
      st.turn=0; st.phase='draw'; st.drawn=null; st.pending=null;
      R.draw(st,'p0',0); R.guess(st,'p0','p1',1,'w',8);
      return st.players[1].hand[1].faceUp && st.players[1].hand[1].missed.length === 0;
    })());
  ok('시야에도 실려 나간다', JSON.stringify(R.viewFor(st,'p0').players[1].hand[0].missed) === '[7,9,null]');
})();

/* ---------------- 놓기 단계 ---------------- */
section('놓기');
(function(){
  var st = begin(R.newGame(P(2), 15));
  st.players[0].hand = [{tile:b(1),faceUp:false},{tile:J('w'),faceUp:false},{tile:b(9),faceUp:false}];
  st.pool = [b(5)];
  st.turn = 0; st.phase = 'draw';
  R.draw(st,'p0',0);
  var tgt = st.players[1].hand[0].tile;
  // 일부러 빗나가게
  R.guess(st,'p0','p1',0, tgt.color === 'b' ? 'w' : 'b', R.isJoker(tgt) ? 0 : (tgt.n+1)%12);
  ok('자리가 여러 곳이면 phase=place', st.phase === 'place', st.phase);
  ok('놓을 타일 보관됨', st.pending && R.tileId(st.pending.tile) === 'b5');
  ok('공개 예정으로 표시', st.pending.faceUp === true);
  ok('잘못된 자리 거부', R.place(st,'p0',0).ok === false);
  ok('유효한 자리 수락', R.place(st,'p0',2).ok === true);
  ok('놓은 뒤 정렬 유지', sorted(st.players[0].hand));
  ok('놓은 뒤 턴 종료', st.phase === 'draw' && st.turn === 1);
})();
(function(){
  // 자리가 한 곳뿐이어도 고르는 단계를 거쳐야 한다 (조커를 숨기기 위해)
  var st = begin(R.newGame(P(2), 16));
  st.players[0].hand = [{tile:b(1),faceUp:false},{tile:b(9),faceUp:false}];
  st.pool = [b(5)];
  st.turn = 0; st.phase = 'draw'; R.draw(st,'p0',0);
  var tgt = st.players[1].hand[0].tile;
  R.guess(st,'p0','p1',0, tgt.color==='b'?'w':'b', R.isJoker(tgt)?0:(tgt.n+1)%12);
  ok('자리가 하나여도 phase=place 를 거친다', st.phase === 'place', st.phase);
  ok('그 경우 고를 자리는 한 곳', JSON.stringify(R.validPlacements(st.players[0].hand, st.pending.tile)) === '[1]');
  ok('놓으면 턴 종료', (R.place(st,'p0',1).ok && st.phase === 'draw' && st.turn === 1));
})();

/* ---------------- 바닥 소진 ---------------- */
section('바닥 소진');
var s3 = begin(R.newGame(P(2), 11));
s3.pool = [];
R.draw(s3,'p0',0);
ok('바닥 비면 집지 않음', s3.drawn === null && s3.phase === 'guess');
var tg = s3.players[1].hand[0].tile;
R.guess(s3,'p0','p1',0, tg.color==='b'?'w':'b', R.isJoker(tg)?0:(tg.n+5)%12);
ok('빗나가면 phase=penalty', s3.phase === 'penalty');
var hid0 = R.hiddenCount(s3.players[0]);
ok('자기 타일 공개', R.penalty(s3,'p0',0).ok === true);
ok('숨은 장수 감소', R.hiddenCount(s3.players[0]) === hid0 - 1);
ok('턴 종료', s3.phase === 'draw' && s3.turn === 1);

/* ---------------- 탈락 / 승리 ---------------- */
section('탈락 / 승리');
var s5 = begin(R.newGame(P(2), 9));
s5.players[1].hand.forEach(function(x,i){ if(i>0) x.faceUp = true; });
R.draw(s5,'p0',0);
var lastT = s5.players[1].hand[0].tile;
R.guess(s5,'p0','p1',0,lastT.color, R.isJoker(lastT)?null:lastT.n);
ok('마지막 타일 적중 → 종료', s5.phase === 'over');
ok('승자 지정', s5.winner === 'p0');
ok('종료 후 액션 거부', R.draw(s5,'p0',0).ok === false);

/* ---------------- 정보 은닉 ---------------- */
section('정보 은닉');
var s6 = begin(R.newGame(P(3), 21));
R.draw(s6,'p0',0);
var v0 = R.viewFor(s6,'p0'), v1 = R.viewFor(s6,'p1');
ok('내 타일은 숫자까지', v0.players[0].hand.every(function(x){ return x.tile.n !== null || x.tile.joker === true; }));
ok('남의 덮인 타일은 숫자 가려짐',
   v0.players[1].hand.every(function(x){ return x.faceUp || (x.tile.n === null && x.tile.joker === null); }));
ok('남의 덮인 타일도 색은 보임',
   v0.players[1].hand.every(function(x){ return x.tile.color === s6.players[1].hand[v0.players[1].hand.indexOf(x)] ? true : (x.tile.color==='b'||x.tile.color==='w'); }));
ok('색이 실제와 일치',
   v0.players[1].hand.every(function(x,i){ return x.tile.color === s6.players[1].hand[i].tile.color; }));
ok('조커 여부도 가려짐(남의 덮인 타일)',
   v0.players[1].hand.every(function(x){ return x.faceUp || x.tile.joker === null; }));
ok('집은 타일은 본인만', v0.drawn !== null && v1.drawn === null);
ok('집은 타일 색은 공개', v1.drawnColor === s6.drawn.color);
ok('바닥은 색만', v1.pool.length === s6.pool.length && v1.pool.every(function(t){ return Object.keys(t).join()==='color'; }));
(function(){
  var wire = JSON.stringify(R.viewFor(s6,'p2').players[0].hand);
  var hid = s6.players[0].hand.filter(function(x){ return !x.faceUp; });
  ok('전송 데이터에 남의 숫자 없음', hid.every(function(x){
    return R.isJoker(x.tile) || wire.indexOf('"color":"'+x.tile.color+'","n":'+x.tile.n) < 0;
  }), wire);
})();

/* ---------------- 무작위 완주 ---------------- */
section('무작위 완주 500판');
function randomAction(s, rng) {
  if (s.phase === 'setup') {
    var p0 = s.players.filter(function(p){ return !s.ready[p.id]; })[0];
    if (p0.hand.length < s.handSize) return R.draftPick(s, p0.id, Math.floor(rng() * s.pool.length));
    var jk = -1;
    p0.hand.forEach(function(x,i){ if (R.isJoker(x.tile) && jk < 0) jk = i; });
    if (jk >= 0 && rng() < 0.7) R.setupMove(s, p0.id, jk, Math.floor(rng() * p0.hand.length));
    return R.setupReady(s, p0.id);
  }
  var me = R.current(s).id;
  if (s.phase === 'draw') return R.draw(s, me, Math.floor(rng() * Math.max(1, s.pool.length)));
  if (s.phase === 'decide') return R.decide(s, me, rng() < 0.45);
  if (s.phase === 'place') {
    var sp = R.validPlacements(R.current(s).hand, s.pending.tile);
    return R.place(s, me, sp[Math.floor(rng() * sp.length)]);
  }
  if (s.phase === 'penalty') return R.penalty(s, me, firstHidden(R.current(s)));
  if (s.phase === 'guess') {
    var opps = s.players.filter(function(p){ return !p.out && p.id !== me && R.hiddenCount(p) > 0; });
    if (!opps.length) return { ok:false, error:'대상 없음' };
    var t = opps[Math.floor(rng()*opps.length)];
    var idxs = []; t.hand.forEach(function(x,i){ if(!x.faceUp) idxs.push(i); });
    var idx = idxs[Math.floor(rng()*idxs.length)];
    if (rng() < 0.45) {
      var real = t.hand[idx].tile;
      return R.guess(s, me, t.id, idx, real.color, R.isJoker(real) ? null : real.n);
    }
    var d = R.createDeck();
    var g = d[Math.floor(rng()*d.length)];
    return R.guess(s, me, t.id, idx, g.color, R.isJoker(g) ? null : g.n);
  }
  return { ok:false, error:'phase '+s.phase };
}
var fuzzFail = 0, stuck = 0, lens = [], jokerSeen = 0;
for (var g2 = 0; g2 < 500; g2++) {
  var np = 2 + (g2 % 3);
  var st = R.newGame(P(np), 1000 + g2);
  var rng = R.mulberry32(50000 + g2);
  var steps = 0, bad = null;
  while (st.phase !== 'over' && steps < 5000) {
    var res = randomAction(st, rng);
    if (!res.ok) { bad = res.error; break; }
    steps++;
    if (new Set(allTiles(st)).size !== 26) { bad = '타일 유실/중복'; break; }
    if (!st.players.every(function(p){ return sorted(p.hand); })) { bad = '정렬 깨짐'; break; }
    if (st.phase !== 'over' && R.current(st).out) { bad = '탈락자에게 차례'; break; }
  }
  st.players.forEach(function(p){ p.hand.forEach(function(x){ if (R.isJoker(x.tile)) jokerSeen++; }); });
  if (bad) { fuzzFail++; if (fuzzFail <= 3) console.log('  ✗ 판 '+g2+': '+bad); }
  else if (st.phase !== 'over') stuck++;
  else {
    lens.push(steps);
    if (st.winner) {
      var wp = st.players.filter(function(p){ return p.id === st.winner; })[0];
      if (R.hiddenCount(wp) < 1) { fuzzFail++; console.log('  ✗ 승자가 숨은 타일 0장'); }
    }
  }
}
ok('500판 규칙 위반 없음', fuzzFail === 0, fuzzFail);
ok('500판 전부 종료', stuck === 0, stuck);
lens.sort(function(a,b){return a-b;});
console.log('  판당 수: 최소 '+lens[0]+' / 중앙 '+lens[Math.floor(lens.length/2)]+' / 최대 '+lens[lens.length-1]+
            '   손패에 들어간 조커 '+jokerSeen+'장');

console.log('\n' + (fail ? '실패 ' + fail + ' / ' : '') + '통과 ' + pass);
process.exit(fail ? 1 : 0);
