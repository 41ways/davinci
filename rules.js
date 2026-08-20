/* 다빈치코드 — 규칙 엔진
   순수 함수 모음. 네트워크도 UI도 모른다. 노드에서 그대로 테스트된다.

   타일: 검정 0~11, 흰색 0~11, 그리고 검정 조커 / 흰색 조커 (총 26장)
   정렬: 숫자 오름차순, 같은 숫자면 검정이 흰색보다 왼쪽
   조커: 숫자가 없다. 손패의 어느 자리에나 놓을 수 있고, 놓인 뒤에는 움직이지 않는다.
   색은 뒷면에서도 보인다. 가려지는 것은 숫자뿐이다.
*/
(function (root) {
  'use strict';

  var COLORS = ['b', 'w'];
  var MAX_N = 11;

  /* ---------- 난수 ---------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------- 타일 ---------- */
  function isJoker(t) { return !!(t && t.joker); }
  function tileKey(t) { return isJoker(t) ? -1 : t.n * 2 + (t.color === 'b' ? 0 : 1); }
  function tileId(t) { return t.color + (isJoker(t) ? 'J' : t.n); }
  function tileLabel(t) {
    return (t.color === 'b' ? '검정 ' : '흰색 ') + (isJoker(t) ? '조커' : t.n);
  }
  function sameTile(t, color, n) {
    if (t.color !== color) return false;
    return n === null ? isJoker(t) : (!isJoker(t) && t.n === n);
  }

  function createDeck() {
    var d = [];
    for (var c = 0; c < COLORS.length; c++) {
      for (var n = 0; n <= MAX_N; n++) d.push({ color: COLORS[c], n: n, joker: false });
      d.push({ color: COLORS[c], n: null, joker: true });
    }
    return d;
  }

  function handSize(playerCount) { return playerCount === 2 ? 4 : 3; }

  /* ---------- 배치 ----------
     숫자 타일은 정렬을 지키는 자리에만 들어간다. 조커는 어디든 들어간다.
     조커가 옆에 있으면 숫자 타일도 들어갈 자리가 여러 곳일 수 있다. */
  function validPlacements(hand, tile) {
    var n = hand.length, out = [], i;
    if (isJoker(tile)) { for (i = 0; i <= n; i++) out.push(i); return out; }

    var k = tileKey(tile);
    var lo = 0, hi = n;
    for (i = 0; i < n; i++) {
      var t = hand[i].tile;
      if (isJoker(t)) continue;               // 조커는 순서를 말해주지 않는다
      if (tileKey(t) < k) lo = i + 1;
      else if (tileKey(t) > k && hi === n) hi = i;
    }
    if (hi < lo) hi = lo;
    for (i = lo; i <= hi; i++) out.push(i);
    return out;
  }

  function hiddenCount(p) {
    var n = 0;
    for (var i = 0; i < p.hand.length; i++) if (!p.hand[i].faceUp) n++;
    return n;
  }

  /* ---------- 게임 생성 ---------- */
  function newGame(players, seed) {
    if (!players || players.length < 2 || players.length > 4) throw new Error('2~4인만 가능합니다');
    var rng = mulberry32(seed === undefined ? 1 : seed);
    var pool = shuffle(createDeck(), rng);
    var size = handSize(players.length);

    var ps = players.map(function (p) {
      var hand = [];
      for (var i = 0; i < size; i++) {
        var t = pool.pop();
        var spots = validPlacements(hand, t);
        // 시작 손패의 조커는 무작위 자리에 둔다
        var at = isJoker(t) ? spots[Math.floor(rng() * spots.length)] : spots[0];
        hand.splice(at, 0, { tile: t, faceUp: false });
      }
      return { id: p.id, name: p.name, hand: hand, out: false };
    });

    return {
      players: ps, pool: pool, turn: 0,
      phase: 'draw',        // draw | guess | decide | place | penalty | over
      drawn: null,
      pending: null,        // {tile, faceUp} 놓을 자리를 고르는 중
      winner: null, lastEvent: null, log: []
    };
  }

  /* ---------- 조회 ---------- */
  function alivePlayers(s) { return s.players.filter(function (p) { return !p.out; }); }
  function current(s) { return s.players[s.turn]; }
  function say(s, t) { s.log.push(t); if (s.log.length > 60) s.log.shift(); }

  function checkOut(s, p) {
    if (!p.out && hiddenCount(p) === 0) { p.out = true; say(s, p.name + ' 탈락'); return true; }
    return false;
  }
  function checkWin(s) {
    var alive = alivePlayers(s);
    if (alive.length <= 1) {
      s.phase = 'over';
      s.winner = alive.length === 1 ? alive[0].id : null;
      say(s, alive.length === 1 ? alive[0].name + ' 승리' : '무승부');
      return true;
    }
    return false;
  }
  function nextTurn(s) {
    if (s.phase === 'over') return;
    var n = s.players.length;
    for (var i = 1; i <= n; i++) {
      var idx = (s.turn + i) % n;
      if (!s.players[idx].out) { s.turn = idx; break; }
    }
    s.drawn = null; s.pending = null; s.phase = 'draw';
  }

  /* ---------- 배치 처리 ----------
     자리가 하나뿐이어도 반드시 고르는 단계를 거친다.
     숫자 패만 즉시 놓이면, 자리를 고르는 행위 자체가 "조커를 들었다"를 알려주기 때문이다. */
  function beginPlace(s, tile, faceUp) {
    s.pending = { tile: tile, faceUp: faceUp };
    s.drawn = null;
    s.phase = 'place';
    return true;
  }

  /* ---------- 액션 ---------- */
  function mustBeTurn(s, pid) {
    if (s.phase === 'over') return '게임이 끝났습니다';
    var c = current(s);
    if (!c || c.id !== pid) return '당신의 차례가 아닙니다';
    return null;
  }

  // 1) 바닥에서 한 장 집는다. 색만 보고 고른다.
  function draw(s, pid, poolIndex) {
    var e = mustBeTurn(s, pid); if (e) return { ok: false, error: e };
    if (s.phase !== 'draw') return { ok: false, error: '지금은 집을 수 없습니다' };
    if (!s.pool.length) { s.drawn = null; s.phase = 'guess';
      s.lastEvent = { type: 'draw', by: pid, empty: true }; return { ok: true }; }
    if (!(poolIndex >= 0 && poolIndex < s.pool.length)) return { ok: false, error: '없는 자리입니다' };
    s.drawn = s.pool.splice(poolIndex, 1)[0];
    s.phase = 'guess';
    s.lastEvent = { type: 'draw', by: pid, empty: false };
    say(s, current(s).name + ' 바닥에서 ' + (s.drawn.color === 'b' ? '검정' : '흰색') + ' 타일을 집음');
    return { ok: true };
  }

  // 2) 추측. n === null 이면 조커를 부른 것이다.
  function guess(s, pid, targetId, index, color, n) {
    var e = mustBeTurn(s, pid); if (e) return { ok: false, error: e };
    if (s.phase !== 'guess') return { ok: false, error: '지금은 추측할 수 없습니다' };
    if (targetId === pid) return { ok: false, error: '자기 타일은 맞힐 수 없습니다' };

    var target = null;
    for (var i = 0; i < s.players.length; i++) if (s.players[i].id === targetId) target = s.players[i];
    if (!target) return { ok: false, error: '없는 상대입니다' };
    if (target.out) return { ok: false, error: '이미 탈락한 상대입니다' };

    var slot = target.hand[index];
    if (!slot) return { ok: false, error: '없는 자리입니다' };
    if (slot.faceUp) return { ok: false, error: '이미 공개된 타일입니다' };
    if (COLORS.indexOf(color) < 0) return { ok: false, error: '잘못된 색입니다' };
    if (n !== null && !(n >= 0 && n <= MAX_N)) return { ok: false, error: '잘못된 숫자입니다' };

    var hit = sameTile(slot.tile, color, n);
    var guessed = { color: color, n: n, joker: n === null };
    s.lastEvent = { type: 'guess', by: pid, targetId: targetId, index: index,
                    guessed: guessed, hit: hit, actual: hit ? slot.tile : null };
    say(s, current(s).name + ' → ' + target.name + ' ' + (index + 1) + '번째: ' +
        tileLabel(guessed) + (hit ? ' 적중' : ' 빗나감'));

    if (hit) {
      slot.faceUp = true;
      if (checkOut(s, target) && checkWin(s)) return { ok: true, hit: true };
      s.phase = 'decide';
      return { ok: true, hit: true };
    }

    if (s.drawn) beginPlace(s, s.drawn, true);
    else s.phase = 'penalty';
    return { ok: true, hit: false };
  }

  // 3) 적중 후: 이어서 갈지 멈출지
  function decide(s, pid, keepGoing) {
    var e = mustBeTurn(s, pid); if (e) return { ok: false, error: e };
    if (s.phase !== 'decide') return { ok: false, error: '지금 고를 수 없습니다' };
    if (keepGoing) { s.phase = 'guess'; s.lastEvent = { type: 'continue', by: pid }; return { ok: true }; }

    if (s.drawn) beginPlace(s, s.drawn, false);
    else { s.lastEvent = { type: 'stop', by: pid }; nextTurn(s); }
    return { ok: true };
  }

  // 4) 놓을 자리 고르기
  function place(s, pid, index) {
    var e = mustBeTurn(s, pid); if (e) return { ok: false, error: e };
    if (s.phase !== 'place' || !s.pending) return { ok: false, error: '지금 놓을 수 없습니다' };
    var me = current(s);
    var spots = validPlacements(me.hand, s.pending.tile);
    if (spots.indexOf(index) < 0) return { ok: false, error: '거기에는 놓을 수 없습니다' };

    me.hand.splice(index, 0, { tile: s.pending.tile, faceUp: s.pending.faceUp });
    s.lastEvent = { type: 'placed', by: pid, index: index, faceUp: s.pending.faceUp,
                    handLen: me.hand.length };
    say(s, me.name + (s.pending.faceUp
      ? ' 집은 타일 공개: ' + tileLabel(s.pending.tile)
      : ' 집은 타일을 ' + (index + 1) + '번째 자리에 덮어 놓음'));
    s.pending = null;
    nextTurn(s);
    return { ok: true };
  }

  // 5) 바닥이 빈 상태에서 빗나갔을 때: 자기 타일 하나 공개
  function penalty(s, pid, index) {
    var e = mustBeTurn(s, pid); if (e) return { ok: false, error: e };
    if (s.phase !== 'penalty') return { ok: false, error: '지금 공개할 수 없습니다' };
    var me = current(s);
    var slot = me.hand[index];
    if (!slot) return { ok: false, error: '없는 자리입니다' };
    if (slot.faceUp) return { ok: false, error: '이미 공개된 타일입니다' };

    slot.faceUp = true;
    s.lastEvent = { type: 'penalty', by: pid, index: index, tile: slot.tile };
    say(s, me.name + ' 자기 타일 공개: ' + tileLabel(slot.tile));
    if (checkOut(s, me) && checkWin(s)) return { ok: true };
    nextTurn(s);
    return { ok: true };
  }

  /* ---------- 시야 자르기 ---------- */
  function maskTile(t, reveal) {
    return reveal ? { color: t.color, n: t.n, joker: !!t.joker }
                  : { color: t.color, n: null, joker: null };   // joker:null = 조커인지 모름
  }

  function viewFor(s, pid) {
    var cur = current(s);
    var isCur = s.phase !== 'over' && cur && cur.id === pid;
    return {
      phase: s.phase, turn: s.turn, winner: s.winner, me: pid,
      poolCount: s.pool.length,
      pool: s.pool.map(function (t) { return { color: t.color }; }),   // 색만
      log: s.log.slice(-12),
      lastEvent: s.lastEvent,
      drawn: isCur ? s.drawn : null,
      hasDrawn: !!s.drawn,
      drawnColor: s.drawn ? s.drawn.color : null,
      pending: isCur && s.pending ? s.pending : null,
      pendingSpots: isCur && s.pending ? validPlacements(cur.hand, s.pending.tile) : null,
      players: s.players.map(function (p) {
        return {
          id: p.id, name: p.name, out: p.out,
          hand: p.hand.map(function (slot) {
            return { faceUp: slot.faceUp, tile: maskTile(slot.tile, slot.faceUp || p.id === pid) };
          })
        };
      })
    };
  }

  // 숫자까지 확정된 타일을 뺀 나머지
  function unseenTiles(view) {
    var known = {};
    view.players.forEach(function (p) {
      p.hand.forEach(function (s) {
        if (s.tile && (s.tile.n !== null || s.tile.joker === true)) known[tileId(s.tile)] = true;
      });
    });
    if (view.drawn) known[tileId(view.drawn)] = true;
    if (view.pending) known[tileId(view.pending.tile)] = true;
    return createDeck().filter(function (t) { return !known[tileId(t)]; });
  }

  var API = {
    COLORS: COLORS, MAX_N: MAX_N,
    mulberry32: mulberry32, createDeck: createDeck, handSize: handSize,
    isJoker: isJoker, tileKey: tileKey, tileId: tileId, tileLabel: tileLabel, sameTile: sameTile,
    validPlacements: validPlacements, hiddenCount: hiddenCount,
    alivePlayers: alivePlayers, current: current,
    newGame: newGame, draw: draw, guess: guess, decide: decide, place: place, penalty: penalty,
    viewFor: viewFor, unseenTiles: unseenTiles
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Rules = API;
})(typeof self !== 'undefined' ? self : this);
