/* 다빈치코드 — 봇
   보이는 것(색 + 공개된 숫자 + 정렬 규칙)만으로 후보를 좁힌다.
   조커가 있으면 추론이 느슨해진다. 조커는 순서를 말해주지 않고,
   덮인 자리가 조커일 수도 있어서 "사이에 몇 개나 끼어 있나" 계산이 약해진다. */
(function (root) {
  'use strict';
  var R = (typeof require !== 'undefined') ? require('./rules.js') : root.Rules;
  var MAXKEY = R.MAX_N * 2 + 1;

  // 아직 어디 있는지 모르는 조커 수
  function loseJokers(view) {
    var known = 0;
    view.players.forEach(function (p) {
      p.hand.forEach(function (s) { if (s.tile && s.tile.joker === true) known++; });
    });
    if (view.drawn && view.drawn.joker) known++;
    if (view.pending && view.pending.tile.joker) known++;
    return Math.max(0, 2 - known);
  }

  function candidates(view, targetId, index) {
    var target = null;
    for (var i = 0; i < view.players.length; i++) if (view.players[i].id === targetId) target = view.players[i];
    if (!target) return [];
    var slot = target.hand[index];
    if (!slot || slot.faceUp) return [];

    var hand = target.hand;
    var free = loseJokers(view);
    var lo = 0, hi = MAXKEY;

    for (var j = 0; j < hand.length; j++) {
      var s = hand[j];
      if (!s.faceUp || s.tile.joker === true) continue;   // 조커는 경계를 못 만든다
      var k = R.tileKey(s.tile);

      var a = Math.min(j, index) + 1, bEnd = Math.max(j, index);
      var knownJ = 0, hidden = 0;
      for (var m = a; m < bEnd; m++) {
        if (hand[m].faceUp) { if (hand[m].tile.joker === true) knownJ++; }
        else hidden++;
      }
      var between = bEnd - a;
      // 사이에 반드시 '숫자'가 몇 개는 있어야 하는가 (조커일 수 있는 만큼 빼준다)
      var mustNum = Math.max(0, between - knownJ - Math.min(hidden, free));

      if (j < index) lo = Math.max(lo, k + mustNum + 1);
      else if (j > index) hi = Math.min(hi, k - mustNum - 1);
    }

    var color = slot.tile.color;
    var pool = R.unseenTiles(view).filter(function (t) { return t.color === color; });
    return pool.filter(function (t) {
      if (t.joker) return true;                 // 조커는 어느 자리에나 있을 수 있다
      var k = R.tileKey(t);
      return k >= lo && k <= hi;
    });
  }

  function bestTarget(view) {
    var me = view.me, best = null;
    for (var i = 0; i < view.players.length; i++) {
      var p = view.players[i];
      if (p.id === me || p.out) continue;
      for (var j = 0; j < p.hand.length; j++) {
        if (p.hand[j].faceUp) continue;
        var c = candidates(view, p.id, j);
        if (!c.length) continue;
        if (!best || c.length < best.cands.length) best = { targetId: p.id, index: j, cands: c };
      }
    }
    return best;
  }

  // skill 1 = 추론을 최대한 활용, 0 = 색만 보고 찍음
  function chooseGuess(view, rng, skill) {
    rng = rng || Math.random;
    if (skill === undefined) skill = 1;
    var b = bestTarget(view);
    if (!b) return null;
    var pool = b.cands;
    if (rng() > skill) {
      var loose = R.unseenTiles(view).filter(function (t) { return t.color === b.cands[0].color; });
      if (loose.length) pool = loose;
    }
    var pick = pool[Math.floor(rng() * pool.length)];
    return { targetId: b.targetId, index: b.index, color: pick.color,
             n: pick.joker ? null : pick.n, count: b.cands.length };
  }

  function chooseDecide(view, rng) {
    rng = rng || Math.random;
    var b = bestTarget(view);
    if (!b) return false;
    if (b.cands.length === 1) return true;
    if (b.cands.length === 2) return rng() < 0.35;
    return false;
  }

  // 놓을 자리: 조커는 아무 데나 섞어 넣어야 속일 수 있다
  function choosePlace(view, rng) {
    rng = rng || Math.random;
    var spots = view.pendingSpots || [0];
    return spots[Math.floor(rng() * spots.length)];
  }

  // 스스로 공개할 때는 바깥쪽부터. 가운데를 열수록 상대에게 경계를 더 준다.
  function choosePenalty(view) {
    var me = null;
    for (var i = 0; i < view.players.length; i++) if (view.players[i].id === view.me) me = view.players[i];
    var n = me.hand.length, best = -1, bestScore = -1;
    for (var j = 0; j < n; j++) {
      if (me.hand[j].faceUp) continue;
      var score = Math.max(j, n - 1 - j);
      if (score > bestScore) { bestScore = score; best = j; }
    }
    return best;
  }

  var API = { candidates: candidates, bestTarget: bestTarget, chooseGuess: chooseGuess,
              chooseDecide: chooseDecide, choosePlace: choosePlace, choosePenalty: choosePenalty };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.AI = API;
})(typeof self !== 'undefined' ? self : this);
