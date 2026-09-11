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

    // 손패는 비어 있다. 시작 단계에서 각자 바닥에서 골라 온다.
    var ps = players.map(function (p) {
      return { id: p.id, name: p.name, hand: [], out: false };
    });

    return {
      players: ps, pool: pool, turn: 0,
      handSize: size,
      ready: {},            // 시작 정리를 마친 사람
      firstId: null,        // 선공
      order: null,          // 선후공 정하기 — {deck, picks, winnerId, choice}
      phase: 'setup',       // setup | order | draw | guess | decide | place | penalty | over
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

  /* ---------- 시작 정리 ---------- */
  function findPlayer(s, pid) {
    for (var i = 0; i < s.players.length; i++) if (s.players[i].id === pid) return s.players[i];
    return null;
  }

  // 시작 패를 바닥에서 한 장 골라 온다. 다 채울 때까지 반복한다.
  function draftPick(s, pid, poolIndex) {
    if (s.phase !== 'setup') return { ok: false, error: '지금은 고를 수 없습니다' };
    if (s.ready[pid]) return { ok: false, error: '이미 준비를 마쳤습니다' };
    var me = findPlayer(s, pid);
    if (!me) return { ok: false, error: '없는 사람입니다' };
    if (me.hand.length >= s.handSize) return { ok: false, error: '이미 다 골랐습니다' };
    if (!(poolIndex >= 0 && poolIndex < s.pool.length)) return { ok: false, error: '없는 자리입니다' };

    var t = s.pool.splice(poolIndex, 1)[0];
    var spots = validPlacements(me.hand, t);
    // 조커는 일단 아무 자리에 두고, 본인이 옮길 수 있게 한다
    var at = isJoker(t) ? spots[Math.floor(Math.random() * spots.length)] : spots[0];
    me.hand.splice(at, 0, { tile: t, faceUp: false });
    s.lastEvent = { type: 'draft', by: pid, index: at, left: s.handSize - me.hand.length };
    return { ok: true };
  }

  // 조커를 다른 자리로 옮긴다. to 는 그 조커를 뺀 상태 기준의 자리.
  function setupMove(s, pid, from, to) {
    if (s.phase !== 'setup') return { ok: false, error: '지금은 옮길 수 없습니다' };
    if (s.ready[pid]) return { ok: false, error: '이미 준비를 마쳤습니다' };
    var me = findPlayer(s, pid);
    if (!me) return { ok: false, error: '없는 사람입니다' };
    var slot = me.hand[from];
    if (!slot) return { ok: false, error: '없는 자리입니다' };
    if (!isJoker(slot.tile)) return { ok: false, error: '조커만 옮길 수 있습니다' };

    me.hand.splice(from, 1);
    var at = Math.max(0, Math.min(to, me.hand.length));
    me.hand.splice(at, 0, slot);
    s.lastEvent = { type: 'setupMove', by: pid };
    return { ok: true };
  }

  function setupReady(s, pid) {
    if (s.phase !== 'setup') return { ok: false, error: '지금은 준비할 수 없습니다' };
    var me = findPlayer(s, pid);
    if (!me) return { ok: false, error: '없는 사람입니다' };
    if (me.hand.length < s.handSize) {
      return { ok: false, error: '아직 ' + (s.handSize - me.hand.length) + '장 더 골라야 합니다' };
    }
    s.ready[pid] = true;
    setupCheck(s);
    return { ok: true };
  }

  // 모두 정리를 마쳤으면 선후공 정하기로 넘어간다
  function setupCheck(s) {
    if (s.phase !== 'setup') return;
    var waiting = s.players.filter(function (p) { return !p.out && !s.ready[p.id]; });
    if (waiting.length) return;
    var deck = [];
    for (var n = 0; n <= MAX_N; n++) deck.push(n);
    s.order = { deck: shuffle(deck, Math.random), picks: {}, winnerId: null, choice: null };
    s.phase = 'order';
    s.lastEvent = { type: 'orderStart' };
  }

  /* ---------- 선후공 정하기 ----------
     게임 타일과 따로 둔 순서 패(0~11)를 한 장씩 뽑는다. 게임 타일로 뽑으면
     바닥에 무엇이 남았는지가 드러나 버린다. 숫자가 모두 달라 비길 일이 없다.
     가장 높은 사람이 선공(내가 먼저)이나 후공(내가 마지막)을 고른다. 차례는 시계방향. */
  function orderPick(s, pid, idx) {
    if (s.phase !== 'order' || !s.order) return { ok: false, error: '지금은 뽑을 수 없습니다' };
    var o = s.order;
    if (o.winnerId) return { ok: false, error: '이미 다 뽑았습니다' };
    var me = findPlayer(s, pid);
    if (!me || me.out) return { ok: false, error: '없는 사람입니다' };
    if (o.picks.hasOwnProperty(pid)) return { ok: false, error: '이미 뽑았습니다' };
    if (!(idx >= 0 && idx < o.deck.length)) return { ok: false, error: '없는 자리입니다' };
    for (var k in o.picks) if (o.picks[k] === idx) return { ok: false, error: '이미 누가 뽑은 패입니다' };
    o.picks[pid] = idx;
    s.lastEvent = { type: 'orderPick', by: pid, index: idx };
    orderSettle(s);
    return { ok: true };
  }

  // 남은 사람이 모두 뽑았으면 가장 높은 사람을 가린다
  function orderSettle(s) {
    var o = s.order;
    if (s.phase !== 'order' || !o || o.choice) return;
    var alive = alivePlayers(s);
    if (o.winnerId && findPlayer(s, o.winnerId).out) o.winnerId = null;   // 고르기 전에 나갔다
    if (o.winnerId) return;
    if (!alive.every(function (p) { return o.picks.hasOwnProperty(p.id); })) return;
    var best = null;
    alive.forEach(function (p) {
      if (!best || o.deck[o.picks[p.id]] > o.deck[o.picks[best.id]]) best = p;
    });
    o.winnerId = best.id;
    s.lastEvent = { type: 'orderReveal', winnerId: best.id, winnerName: best.name,
                    n: o.deck[o.picks[best.id]] };
    say(s, best.name + ' 최고 ' + o.deck[o.picks[best.id]]);
  }

  // first === true 면 선공(내가 먼저), false 면 후공(시계방향 다음 사람부터, 나는 마지막)
  function orderChoose(s, pid, first) {
    if (s.phase !== 'order' || !s.order || !s.order.winnerId) return { ok: false, error: '지금은 고를 수 없습니다' };
    var o = s.order;
    if (o.choice) return { ok: false, error: '이미 골랐습니다' };
    if (o.winnerId !== pid) return { ok: false, error: '가장 높은 사람만 고를 수 있습니다' };
    var n = s.players.length, at = 0, i;
    for (i = 0; i < n; i++) if (s.players[i].id === pid) at = i;
    var start = at;
    if (!first) {
      for (i = 1; i <= n; i++) {
        var idx = (at + i) % n;
        if (!s.players[idx].out) { start = idx; break; }
      }
    }
    s.turn = start;
    s.firstId = s.players[start].id;
    o.choice = first ? 'first' : 'last';
    s.lastEvent = { type: 'orderChosen', by: pid, byName: findPlayer(s, pid).name,
                    choice: o.choice, firstId: s.firstId, firstName: s.players[start].name };
    say(s, '선공은 ' + s.players[start].name);
    return { ok: true };
  }

  // 순서 발표가 끝나면 판을 시작한다 (방장이 시간 맞춰 호출)
  function beginPlay(s) {
    if (s.phase !== 'order' || !s.order || !s.order.choice) return { ok: false, error: '지금 시작할 수 없습니다' };
    s.phase = 'draw';
    s.lastEvent = { type: 'begin' };
    return { ok: true };
  }

  // 연결이 끊긴 사람을 탈락시키고, 판이 그 사람을 기다리며 멈추지 않게 한다
  function dropPlayer(s, pid) {
    var p = findPlayer(s, pid);
    if (!p || p.out || s.phase === 'over') return;
    p.out = true;
    say(s, p.name + ' 연결 끊김 — 탈락 처리');
    if (checkWin(s)) return;
    if (s.phase === 'setup') { setupCheck(s); return; }
    if (s.phase === 'order') {
      if (!s.order.choice) { orderSettle(s); return; }
      if (current(s).id === pid) {             // 선공으로 정해진 사람이 나갔다
        for (var i = 1; i <= s.players.length; i++) {
          var idx = (s.turn + i) % s.players.length;
          if (!s.players[idx].out) { s.turn = idx; s.firstId = s.players[idx].id; break; }
        }
      }
      return;
    }
    if (current(s).id === pid) {
      // 집어 든 채 나갔으면 그 타일을 바닥에 돌려놓는다. nextTurn 이 drawn 을 비우면서 사라졌다.
      if (s.drawn) { s.pool.push(s.drawn); s.drawn = null; }
      nextTurn(s);
    }
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
    s.lastEvent = { type: 'guess', by: pid, byName: current(s).name,
                    targetId: targetId, targetName: target.name, index: index,
                    guessed: guessed, hit: hit, actual: hit ? slot.tile : null };
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
  function countColors(hand) {
    var c = { b: 0, w: 0 };
    hand.forEach(function (x) { c[x.tile.color]++; });
    return c;
  }

  // level 2 = 숫자까지, 1 = 색만, 0 = 자리별 색을 모름 (시작 정리 중인 남의 패)
  function maskTile(t, level) {
    if (level >= 2) return { color: t.color, n: t.n, joker: !!t.joker };
    if (level === 1) return { color: t.color, n: null, joker: null };
    return { color: null, n: null, joker: null };
  }

  function viewFor(s, pid) {
    var cur = current(s);
    var isCur = s.phase !== 'over' && cur && cur.id === pid;
    return {
      phase: s.phase, turn: s.turn, winner: s.winner, me: pid, firstId: s.firstId,
      order: orderView(s, pid),
      ready: JSON.parse(JSON.stringify(s.ready || {})),
      myJokers: (function () {
        var me = null, out = [];
        for (var i = 0; i < s.players.length; i++) if (s.players[i].id === pid) me = s.players[i];
        if (me) me.hand.forEach(function (x, i) { if (isJoker(x.tile)) out.push(i); });
        return out;
      })(),
      poolCount: s.pool.length,
      handSize: s.handSize,
      pool: s.pool.map(function (t) { return { color: t.color }; }),   // 색만
      log: s.log.slice(-12),
      // 조커를 옮겼다는 사실은 본인만 안다 — 남에게 '누가' 옮겼는지 보내면 조커를 쥔 사람이 드러난다
      lastEvent: (s.lastEvent && s.lastEvent.type === 'setupMove' && s.lastEvent.by !== pid)
        ? { type: 'setupMove' } : s.lastEvent,
      drawn: isCur ? s.drawn : null,
      hasDrawn: !!s.drawn,
      drawnColor: s.drawn ? s.drawn.color : null,
      pending: isCur && s.pending ? s.pending : null,
      pendingSpots: isCur && s.pending ? validPlacements(cur.hand, s.pending.tile) : null,
      players: s.players.map(function (p) {
        // 정리 중인 남의 패는 '무엇을 몇 장 가졌는지'는 알려주되 '어떤 순서로 놓았는지'는 감춘다
        var arranging = s.phase === 'setup' && !s.ready[p.id] && p.id !== pid;
        return {
          id: p.id, name: p.name, out: p.out,
          counts: arranging ? countColors(p.hand) : null,
          hand: p.hand.map(function (slot) {
            var level;
            if (p.id === pid || slot.faceUp) level = 2;
            else if (arranging) level = 0;   // 자리별 색은 준비 전까지 비밀
            else level = 1;
            return { faceUp: slot.faceUp, tile: maskTile(slot.tile, level) };
          })
        };
      })
    };
  }

  // 순서 패: 누가 어느 패를 뽑았는지는 모두 본다. 숫자는 다 뽑은 뒤에 한꺼번에 뒤집는다.
  // 내가 뽑은 숫자만은 바로 보인다.
  function orderView(s, pid) {
    var o = s.order;
    if (!o) return null;
    var owner = {};
    for (var k in o.picks) owner[o.picks[k]] = k;
    var open = !!o.winnerId;
    return {
      tiles: o.deck.map(function (n, i) {
        var by = owner.hasOwnProperty(i) ? owner[i] : null;
        return { by: by, n: by !== null && (open || by === pid) ? n : null };
      }),
      revealed: open, winnerId: o.winnerId, choice: o.choice
    };
  }

  // 숫자까지 확정된 타일을 뺀 나머지
  function unseenTiles(view) {
    var known = {};
    view.players.forEach(function (p) {
      p.hand.forEach(function (s) {
        if (s.tile && s.tile.color && (s.tile.n !== null || s.tile.joker === true)) known[tileId(s.tile)] = true;
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
    newGame: newGame, draftPick: draftPick, setupMove: setupMove, setupReady: setupReady,
    orderPick: orderPick, orderChoose: orderChoose, beginPlay: beginPlay, dropPlayer: dropPlayer,
    draw: draw, guess: guess, decide: decide, place: place, penalty: penalty,
    viewFor: viewFor, unseenTiles: unseenTiles
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Rules = API;
})(typeof self !== 'undefined' ? self : this);
