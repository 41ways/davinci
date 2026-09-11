/* 봇 검증 — node ai.test.js */
var R = require('./rules.js');
var AI = require('./ai.js');

var pass = 0, fail = 0;
function ok(n, c, e) { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (e ? '  → ' + e : '')); } }
function P(n){ var a=[]; for(var i=0;i<n;i++) a.push({id:'p'+i,name:'P'+i}); return a; }
// 시작 정리 단계를 넘긴다. 조커가 있으면 아무 자리로 옮겨보고 준비한다.
function begin(s, rng){
  rng = rng || Math.random;
  s.players.forEach(function(p){
    while (p.hand.length < s.handSize) R.draftPick(s, p.id, Math.floor(rng() * s.pool.length));
    var jk = -1;
    p.hand.forEach(function(x,i){ if (R.isJoker(x.tile) && jk < 0) jk = i; });
    if (jk >= 0) R.setupMove(s, p.id, jk, Math.floor(rng() * p.hand.length));
    R.setupReady(s, p.id);
  });
  if (s.phase === 'order') {                 // 선후공 정하기를 건너뛰고 바로 판으로
    s.players.forEach(function(p, i){ R.orderPick(s, p.id, i); });
    R.orderChoose(s, s.order.winnerId, true);
    R.beginPlay(s);
  }
  return s;
}

console.log('추론 정확성');
// 후보 목록에는 반드시 정답이 들어 있어야 한다 (정답을 배제하면 치명적 버그)
var missed = 0, sizes = [], certain = 0, certainWrong = 0;
for (var g = 0; g < 300; g++) {
  var rng = R.mulberry32(7000 + g);
  var s = begin(R.newGame(P(2 + g % 3), 3000 + g), rng);
  var steps = 0;
  while (s.phase !== 'over' && steps++ < 500) {
    var me = R.current(s).id;
    var view = R.viewFor(s, me);
    if (s.phase === 'draw') { R.draw(s, me, Math.floor(Math.random()*Math.max(1,s.pool.length))); continue; }
    if (s.phase === 'guess') {
      // 모든 덮인 자리에 대해 후보 검증
      for (var pi = 0; pi < s.players.length; pi++) {
        var p = s.players[pi];
        if (p.id === me || p.out) continue;
        for (var j = 0; j < p.hand.length; j++) {
          if (p.hand[j].faceUp) continue;
          var cands = AI.candidates(view, p.id, j);
          var real = p.hand[j].tile;
          var has = cands.some(function (t) { return R.tileId(t) === R.tileId(real); });
          if (!has) missed++;
          sizes.push(cands.length);
          if (cands.length === 1) { certain++; if (!has) certainWrong++; }
        }
      }
      var mv = AI.chooseGuess(view, rng);
      if (!mv) break;
      R.guess(s, me, mv.targetId, mv.index, mv.color, mv.n);
      continue;
    }
    if (s.phase === 'decide') { R.decide(s, me, AI.chooseDecide(view, rng)); continue; }
    if (s.phase === 'place') { R.place(s, me, AI.choosePlace(view)); continue; }
    if (s.phase === 'penalty') { R.penalty(s, me, AI.choosePenalty(view)); continue; }
    break;
  }
}
ok('후보 목록이 정답을 배제한 적 없음', missed === 0, missed + '회');
ok('후보 1개로 확정한 판단이 전부 옳음', certainWrong === 0, certainWrong + '회');
sizes.sort(function(a,b){return a-b;});
console.log('  후보 수: 중앙 ' + sizes[Math.floor(sizes.length/2)] +
            ' / 평균 ' + (sizes.reduce(function(a,b){return a+b;},0)/sizes.length).toFixed(2) +
            ' / 최대 ' + sizes[sizes.length-1] +
            '   확정 판정 ' + certain + '회 (' + (certain/sizes.length*100).toFixed(1) + '%)');

console.log('\n봇 대 무작위 (2인, 1000판)');
function randomMove(s, view, rng) {
  var me = R.current(s).id;
  var opps = s.players.filter(function(p){ return !p.out && p.id !== me && R.hiddenCount(p) > 0; });
  if (!opps.length) return null;
  var t = opps[Math.floor(rng()*opps.length)];
  var idxs = []; t.hand.forEach(function(x,i){ if(!x.faceUp) idxs.push(i); });
  var idx = idxs[Math.floor(rng()*idxs.length)];
  // 무작위지만 색은 보이므로 색은 맞춘다 (공정한 비교를 위해)
  var color = t.hand[idx].tile.color;
  return { targetId: t.id, index: idx, color: color, n: rng() < 0.06 ? null : Math.floor(rng()*12) };
}
var win = { bot: 0, rand: 0, draw: 0 };
for (var k = 0; k < 1000; k++) {
  var rr = R.mulberry32(4000 + k);
  var st = begin(R.newGame([{id:'bot',name:'봇'},{id:'rand',name:'무작위'}], 90000 + k), rr);
  st.turn = k % 2;                       // 선공을 번갈아
  var n = 0;
  while (st.phase !== 'over' && n++ < 800) {
    var cur = R.current(st).id;
    var v = R.viewFor(st, cur);
    if (st.phase === 'draw') { R.draw(st, cur, Math.floor(rr()*Math.max(1,st.pool.length))); continue; }
    if (st.phase === 'guess') {
      var mv = cur === 'bot' ? AI.chooseGuess(v, rr) : randomMove(st, v, rr);
      if (!mv) break;
      R.guess(st, cur, mv.targetId, mv.index, mv.color, mv.n);
      continue;
    }
    if (st.phase === 'decide') { R.decide(st, cur, cur === 'bot' ? AI.chooseDecide(v, rr) : rr() < 0.4); continue; }
    if (st.phase === 'place') { var sp = R.validPlacements(R.current(st).hand, st.pending.tile); R.place(st, cur, sp[Math.floor(rr()*sp.length)]); continue; }
    if (st.phase === 'penalty') {
      var pi2 = cur === 'bot' ? AI.choosePenalty(v)
                              : (function(){ for (var i=0;i<R.current(st).hand.length;i++) if(!R.current(st).hand[i].faceUp) return i; return 0; })();
      R.penalty(st, cur, pi2); continue;
    }
    break;
  }
  if (st.winner === 'bot') win.bot++; else if (st.winner === 'rand') win.rand++; else win.draw++;
}
console.log('  봇 ' + win.bot + '승 / 무작위 ' + win.rand + '승 / 기타 ' + win.draw);
ok('봇이 무작위보다 확실히 강함', win.bot > win.rand * 1.5, win.bot + ' vs ' + win.rand);

console.log('\n' + (fail ? '실패 ' + fail + ' / ' : '') + '통과 ' + pass);
process.exit(fail ? 1 : 0);
