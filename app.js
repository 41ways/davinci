/* 다빈치코드 — 화면과 진행
   solo/host 는 규칙 엔진을 직접 돌리고, client 는 방장이 잘라 보내준 시야만 그린다. */
(function () {
  'use strict';
  var R = window.Rules, AI = window.AI;
  var $ = function (id) { return document.getElementById(id); };

  var App = {
    mode: null, net: null, state: null, view: null, me: null,
    seats: [], sel: null, setupSel: null, started: false, botTimer: null, skill: 0.75,
    shownEvent: null, animateEv: null
  };

  function show(which) {
    ['home', 'lobby', 'game'].forEach(function (id) { $(id).classList.toggle('hidden', id !== which); });
  }
  var toastTimer = null;
  function toast(msg) {
    var e = $('toast'); e.textContent = msg; e.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { e.classList.remove('on'); }, 2600);
  }
  function myName() { return $('name').value.trim() || '이름없음'; }
  function seatOf(id) {
    for (var i = 0; i < App.seats.length; i++) if (App.seats[i].id === id) return App.seats[i];
    return null;
  }

  /* ---------------- 진행 ---------------- */
  function startEngine() {
    if (App.seats.length < 2) { toast('2명 이상이어야 시작할 수 있습니다.'); return; }
    App.started = true;
    App.state = R.newGame(App.seats.map(function (s) { return { id: s.id, name: s.name }; }),
                          Math.floor(Math.random() * 1e9));
    App.sel = null; App.setupSel = null; App.shownEvent = null;
    show('game');
    pushViews();
  }

  function pushViews() {
    var s = App.state;
    App.view = R.viewFor(s, App.me);
    if (App.mode === 'host' && App.net) {
      App.net.broadcast(function (pid) { return { t: 'view', view: R.viewFor(s, pid) }; });
    }
    render();
    scheduleBot();
  }

  function scheduleBot() {
    clearTimeout(App.botTimer);
    var s = App.state;
    if (!s || s.phase === 'over') return;
    if (s.phase === 'setup') {
      var waiting = App.seats.filter(function (st) { return st.bot && !s.ready[st.id]; });
      if (waiting.length) App.botTimer = setTimeout(botSetupStep, 550);
      return;
    }
    var seat = seatOf(R.current(s).id);
    if (seat && seat.bot) App.botTimer = setTimeout(botStep, 900);
  }

  function botSetupStep() {
    var s = App.state;
    if (!s || s.phase !== 'setup') return;
    var seat = App.seats.filter(function (st) { return st.bot && !s.ready[st.id]; })[0];
    if (!seat) return;
    var p = null;
    s.players.forEach(function (x) { if (x.id === seat.id) p = x; });
    if (p) {
      var jk = -1;
      p.hand.forEach(function (x, i) { if (R.isJoker(x.tile) && jk < 0) jk = i; });
      if (jk >= 0) R.setupMove(s, seat.id, jk, Math.floor(Math.random() * p.hand.length));
    }
    R.setupReady(s, seat.id);
    pushViews();
  }

  function botStep() {
    var s = App.state;
    if (!s || s.phase === 'over') return;
    var id = R.current(s).id, v = R.viewFor(s, id);
    if (s.phase === 'draw') R.draw(s, id, Math.floor(Math.random() * Math.max(1, s.pool.length)));
    else if (s.phase === 'guess') {
      var mv = AI.chooseGuess(v, Math.random, App.skill);
      if (mv) R.guess(s, id, mv.targetId, mv.index, mv.color, mv.n);
      else R.decide(s, id, false);
    }
    else if (s.phase === 'decide') R.decide(s, id, AI.chooseDecide(v));
    else if (s.phase === 'place') R.place(s, id, AI.choosePlace(v));
    else if (s.phase === 'penalty') R.penalty(s, id, AI.choosePenalty(v));
    pushViews();
  }

  function act(action, args) {
    if (App.mode === 'client') { App.net.toHost({ t: 'act', action: action, args: args }); return; }
    doAction(App.me, action, args);
  }

  function doAction(pid, action, args) {
    var s = App.state, r = null;
    if (!s) return;
    if (action === 'setupMove') r = R.setupMove(s, pid, args[0], args[1]);
    else if (action === 'setupReady') r = R.setupReady(s, pid);
    else if (action === 'draw') r = R.draw(s, pid, args[0]);
    else if (action === 'guess') r = R.guess(s, pid, args[0], args[1], args[2], args[3]);
    else if (action === 'decide') r = R.decide(s, pid, args[0]);
    else if (action === 'place') r = R.place(s, pid, args[0]);
    else if (action === 'penalty') r = R.penalty(s, pid, args[0]);
    else return;
    if (!r.ok) {
      if (pid === App.me) toast(r.error);
      else if (App.net) App.net.toPlayer(pid, { t: 'err', msg: r.error });
      return;
    }
    App.sel = null;
    pushViews();
  }

  /* ---------------- 조각 ---------------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function tileEl(tile, faceUp, opts) {
    opts = opts || {};
    var e = el('div', 'tile ' + tile.color + (opts.big ? ' big' : ''));
    var known = faceUp || opts.own;
    if (known) {
      if (tile.joker) { e.classList.add('joker'); e.textContent = '조커'; }
      else e.textContent = tile.n;
      if (faceUp) e.classList.add('up'); else e.classList.add('own');
    } else {
      e.classList.add('down');
    }
    return e;
  }

  function valLabel(n) { return n === null ? '조커' : String(n); }

  // 타일 한 칸 = 타일 + 여태 빗나간 시도들 + 방금 부른 값
  function tileCell(v, p, slot, i, opts) {
    var wrap = el('div', 'tilewrap');
    var e = tileEl(slot.tile, slot.faceUp, opts);
    wrap.appendChild(e);

    var ev = App.animateEv;
    if (ev && ev.type === 'guess' && ev.targetId === p.id && ev.index === i) {
      e.classList.add(ev.hit ? 'smash' : 'shake');
      wrap.appendChild(el('div', 'callout ' + (ev.hit ? 'hit' : 'miss'), valLabel(ev.guessed.n)));
    } else if (ev && ev.type === 'placed' && ev.by === p.id && ev.index === i) {
      e.classList.add('inserted');
    }

    // 이 칸에 시도됐다가 빗나간 값들 — 모두가 아는 정보다
    var miss = slot.missed || [];
    if (miss.length && !slot.faceUp) {
      var row = el('div', 'missed');
      miss.forEach(function (n) { row.appendChild(el('span', null, valLabel(n))); });
      wrap.appendChild(row);
    }
    return { wrap: wrap, tile: e };
  }

  function dirBar() {
    var d = el('div', 'dir');
    d.appendChild(el('span', null, '작음'));
    d.appendChild(el('span', 'line'));
    d.appendChild(el('span', null, '큼'));
    return d;
  }

  function isMyTurn(v) {
    return v.phase !== 'over' && v.players[v.turn] && v.players[v.turn].id === v.me;
  }

  /* ---------------- 자리 ---------------- */
  function playerBox(v, p, big) {
    var isMe = p.id === v.me;
    var isTurn = v.players[v.turn] && v.players[v.turn].id === p.id && v.phase !== 'over';
    var box = el('div', 'player' + (isMe ? ' mine' : '') + (isTurn ? ' turn' : '') + (p.out ? ' out' : ''));

    var head = el('div', 'phead');
    head.appendChild(el('span', 'who', p.name + (isMe ? ' (나)' : '')));
    var hid = p.hand.filter(function (s) { return !s.faceUp; }).length;
    head.appendChild(el('span', 'meta', p.out ? '탈락' : ('숨은 ' + hid + '장')));
    if (isTurn && v.hasDrawn && !isMe) {
      head.appendChild(el('span', 'meta', '· ' + (v.drawnColor === 'b' ? '검정' : '흰색') + ' 집음'));
    }
    if (v.phase === 'setup' && !p.out) {
      head.appendChild(el('span', 'meta', v.ready[p.id] ? '· 준비 완료' : '· 정리 중'));
    }
    box.appendChild(head);

    // 시작 정리 중: 내 조커를 어디든 옮길 수 있다
    if (isMe && v.phase === 'setup' && !v.ready[v.me] && setupSelIndex(v) !== null) {
      box.appendChild(setupRow(v, p, big));
      box.appendChild(dirBar());
      return box;
    }

    // 놓을 자리를 고르는 중이면 내 손패 사이에 틈을 보여준다
    if (isMe && v.phase === 'place' && v.pending && isMyTurn(v)) {
      box.appendChild(placeRow(v, p, big));
      box.appendChild(dirBar());
      return box;
    }

    var hand = el('div', 'hand');
    p.hand.forEach(function (slot, i) {
      var cell = tileCell(v, p, slot, i, { big: big, own: isMe });
      var e = cell.tile;
      var canGuess = !isMe && !p.out && !slot.faceUp && v.phase === 'guess' && isMyTurn(v);
      var canPen = isMe && !slot.faceUp && v.phase === 'penalty' && isMyTurn(v);
      if (canGuess) {
        e.classList.add('pick');
        if (App.sel && App.sel.targetId === p.id && App.sel.index === i) e.classList.add('sel');
        e.onclick = function () { App.sel = { targetId: p.id, index: i }; render(); };
      } else if (canPen) {
        e.classList.add('pick');
        e.onclick = function () { act('penalty', [i]); };
      }
      hand.appendChild(cell.wrap);
    });
    box.appendChild(hand);
    box.appendChild(dirBar());
    return box;
  }

  // 자리는 언제나 전부 보여준다. 숫자 패도 고르는 것처럼 보여야
  // "자리를 고른다 = 조커다" 가 드러나지 않는다.
  // 지금 자리를 정하고 있는 조커의 손패 위치
  function setupSelIndex(v) {
    var js = v.myJokers || [];
    if (!js.length) return null;
    if (App.setupSel !== null && js.indexOf(App.setupSel) >= 0) return App.setupSel;
    return js[0];
  }

  // 고른 조커를 빼놓고 나머지를 늘어놓은 뒤, 틈마다 자리를 만든다
  function setupRow(v, p, big) {
    var sel = setupSelIndex(v);
    var row = el('div', 'slots');
    var rest = [];
    p.hand.forEach(function (slot, i) { if (i !== sel) rest.push({ slot: slot, i: i }); });

    function slotBtn(to) {
      var e = el('div', 'slot' + (big ? ' big' : '') + ' ok');
      e.onclick = function () { act('setupMove', [sel, to]); };
      return e;
    }
    row.appendChild(slotBtn(0));
    rest.forEach(function (o, k) {
      var t = tileEl(o.slot.tile, o.slot.faceUp, { big: big, own: true });
      if (R.isJoker(o.slot.tile)) {
        t.classList.add('pick');
        t.onclick = function () { App.setupSel = o.i; render(); };
      }
      row.appendChild(t);
      row.appendChild(slotBtn(k + 1));
    });
    return row;
  }

  function placeRow(v, p, big) {
    var row = el('div', 'slots');
    var spots = v.pendingSpots || [];
    function snap(i) {
      if (spots.indexOf(i) >= 0) return i;
      var best = spots.length ? spots[0] : 0, bd = Infinity;
      spots.forEach(function (x) { var d = Math.abs(x - i); if (d < bd) { bd = d; best = x; } });
      return best;
    }
    function slotBtn(i) {
      var e = el('div', 'slot' + (big ? ' big' : '') + (spots.indexOf(i) >= 0 ? ' ok' : ''));
      e.onclick = function () { act('place', [snap(i)]); };
      return e;
    }
    row.appendChild(slotBtn(0));
    p.hand.forEach(function (slot, i) {
      row.appendChild(tileEl(slot.tile, slot.faceUp, { big: big, own: true }));
      row.appendChild(slotBtn(i + 1));
    });
    return row;
  }

  function floorBox(v) {
    // 시작 정리 중에는 바닥 대신 정리 중인 조커를 보여준다
    if (v.phase === 'setup') {
      var w0 = el('div', 'floor');
      var sel = setupSelIndex(v);
      var mine = null;
      v.players.forEach(function (p) { if (p.id === v.me) mine = p; });
      if (sel !== null && mine && !v.ready[v.me]) {
        w0.appendChild(el('h3', null, '이 조커의 자리를 고르세요'));
        var b0 = el('div', 'drawn-box');
        var je = tileEl(mine.hand[sel].tile, false, { big: true, own: true });
        je.classList.add('drawn');
        b0.appendChild(je);
        if ((v.myJokers || []).length > 1) b0.appendChild(el('span', null, '조커가 둘입니다 — 다른 조커를 눌러 바꿀 수 있어요'));
        w0.appendChild(b0);
      } else {
        w0.appendChild(el('h3', null, v.ready[v.me] ? '다른 사람을 기다리는 중' : '손패를 확인하세요'));
      }
      return w0;
    }

    var wrap = el('div', 'floor');
    var canPick = v.phase === 'draw' && isMyTurn(v) && v.poolCount > 0;
    if (canPick) wrap.classList.add('can');
    var nb = 0; v.pool.forEach(function (t) { if (t.color === 'b') nb++; });
    wrap.appendChild(el('h3', null, '바닥 ' + v.poolCount + '장 (검정 ' + nb + ' · 흰색 ' + (v.poolCount - nb) + ')' +
                                    (canPick ? ' — 한 장 고르세요' : '')));

    // 색끼리 묶어 보여준다. 어차피 같은 색끼리는 구별할 수 없으니 정보가 새지 않는다.
    var order = v.pool.map(function (t, i) { return { t: t, i: i }; });
    order.sort(function (a, b) {
      if (a.t.color === b.t.color) return a.i - b.i;
      return a.t.color === 'b' ? -1 : 1;
    });
    var pile = el('div', 'pile');
    order.forEach(function (o, k) {
      var e = tileEl({ color: o.t.color, n: null, joker: null }, false, {});
      if (k > 0 && order[k - 1].t.color !== o.t.color) e.classList.add('gapbefore');
      if (canPick) e.onclick = function () { act('draw', [o.i]); };
      pile.appendChild(e);
    });
    wrap.appendChild(pile);

    if (v.hasDrawn && isMyTurn(v) && v.drawn) {
      var b = el('div', 'drawn-box');
      b.appendChild(el('span', null, '집은 타일'));
      var de = tileEl(v.drawn, false, { big: true, own: true });
      de.classList.add('drawn');
      b.appendChild(de);
      wrap.appendChild(b);
    } else if (v.phase === 'place' && v.pending) {
      var b2 = el('div', 'drawn-box');
      b2.appendChild(el('span', null, v.pending.faceUp ? '공개해서 놓을 타일' : '덮어서 놓을 타일'));
      b2.appendChild(tileEl(v.pending.tile, v.pending.faceUp, { big: true, own: true }));
      wrap.appendChild(b2);
    }
    return wrap;
  }

  function eventKey(ev) { return ev ? JSON.stringify(ev) : ''; }

  /* ---------------- 그리기 ---------------- */
  function render() {
    var v = App.view;
    if (!v) return;

    // 연출은 새로 벌어진 사건에 대해서만 한 번
    var ev = v.lastEvent, key = eventKey(ev);
    var fresh = !!key && key !== App.shownEvent;
    if (fresh) App.shownEvent = key;
    App.animateEv = fresh ? ev : null;
    if (fresh && ev.type === 'guess' && ev.hit) flashHit(ev);

    var cur = v.players[v.turn];
    if (v.phase === 'setup') {
      var done = v.players.filter(function (p) { return !p.out && v.ready[p.id]; }).length;
      var total = v.players.filter(function (p) { return !p.out; }).length;
      $('turnInfo').textContent = '손패 정리 — 준비 ' + done + '/' + total;
    } else {
      $('turnInfo').textContent = v.phase === 'over' ? '게임 종료'
        : (cur ? (cur.id === v.me ? '내 차례' : cur.name + '의 차례') : '—');
    }

    var others = [], meP = null, n = v.players.length;
    for (var k = 1; k <= n; k++) {
      var p = v.players[(indexOfMe(v) + k) % n];
      if (p.id === v.me) continue;
      others.push(p);
    }
    v.players.forEach(function (p) { if (p.id === v.me) meP = p; });

    var layout = others.length === 1 ? ['seatTop']
               : others.length === 2 ? ['seatLeft', 'seatRight']
               : ['seatLeft', 'seatTop', 'seatRight'];
    ['seatTop', 'seatLeft', 'seatRight'].forEach(function (id) { $(id).innerHTML = ''; });
    others.forEach(function (p, i) { $(layout[i]).appendChild(playerBox(v, p, false)); });

    $('center').innerHTML = '';
    $('center').appendChild(floorBox(v));

    $('seatMe').innerHTML = '';
    if (meP) $('seatMe').appendChild(playerBox(v, meP, true));

    renderPanel(v);

    var log = $('log'); log.innerHTML = '';
    (v.log || []).forEach(function (line) { log.appendChild(el('div', null, line)); });

    if (v.phase === 'over') showOver(v);
  }

  function indexOfMe(v) {
    for (var i = 0; i < v.players.length; i++) if (v.players[i].id === v.me) return i;
    return 0;
  }

  function flashHit(ev) {
    var f = el('div', 'hitflag', '적중');
    document.body.appendChild(f);
    setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 950);
  }

  function renderPanel(v) {
    var panel = $('panel'); panel.innerHTML = '';
    if (v.phase === 'over') return;

    if (v.phase === 'setup') {
      if (v.ready[v.me]) {
        panel.appendChild(el('div', 'waiting', '다른 사람이 정리를 마치기를 기다리는 중…'));
        return;
      }
      var sp = el('div', 'pnl');
      var hasJk = (v.myJokers || []).length > 0;
      sp.appendChild(el('div', 'ask', hasJk
        ? '시작 손패를 정리합니다. 조커는 어느 자리에나 둘 수 있어요. 상대가 눈치채기 어려운 자리를 고르세요.'
        : '시작 손패를 확인하세요. 숫자는 순서가 정해져 있어 옮길 수 없습니다.'));
      var rb = el('button', 'primary', '준비 완료');
      rb.style.marginBottom = '0';
      rb.onclick = function () { act('setupReady', []); };
      sp.appendChild(rb);
      panel.appendChild(sp);
      return;
    }

    if (!isMyTurn(v)) {
      var cur = v.players[v.turn];
      panel.appendChild(el('div', 'waiting', (cur ? cur.name : '상대') + '의 차례를 기다리는 중…'));
      return;
    }

    var pnl = el('div', 'pnl');

    if (v.phase === 'draw') {
      pnl.appendChild(el('div', 'ask', v.poolCount
        ? '바닥에서 한 장 고르세요. 색만 보고 고를 수 있습니다.'
        : '바닥이 비었습니다. 집지 않고 바로 추측합니다.'));
      if (!v.poolCount) {
        var go = el('button', 'primary', '추측하기');
        go.style.marginBottom = '0';
        go.onclick = function () { act('draw', [0]); };
        pnl.appendChild(go);
      }
      panel.appendChild(pnl); return;
    }

    if (v.phase === 'place') {
      pnl.appendChild(el('div', 'ask', v.pending.tile.joker
        ? '조커입니다. 어느 자리에나 놓을 수 있어요. 상대를 속일 자리를 고르세요.'
        : '놓을 자리를 고르세요. 밝게 표시된 곳이 순서에 맞는 자리입니다.'));
      panel.appendChild(pnl); return;
    }

    if (v.phase === 'penalty') {
      pnl.appendChild(el('div', 'ask', '바닥이 비었는데 빗나갔습니다. 내 타일 하나를 골라 공개하세요.'));
      panel.appendChild(pnl); return;
    }

    if (v.phase === 'decide') {
      pnl.appendChild(el('div', 'ask', '적중했습니다. 이어서 한 번 더 맞히시겠습니까? 빗나가면 집은 타일이 공개됩니다.'));
      var acts = el('div', 'acts');
      var g = el('button', 'primary', '이어서 맞히기');
      g.style.marginBottom = '0';
      g.onclick = function () { act('decide', [true]); };
      var st = el('button', null, v.hasDrawn ? '멈추고 덮어놓기' : '차례 넘기기');
      st.onclick = function () { act('decide', [false]); };
      acts.appendChild(g); acts.appendChild(st);
      pnl.appendChild(acts);
      panel.appendChild(pnl); return;
    }

    // guess
    if (!App.sel) {
      pnl.appendChild(el('div', 'ask', '상대의 덮인 타일을 하나 고르세요.'));
      panel.appendChild(pnl); return;
    }
    var target = null;
    v.players.forEach(function (p) { if (p.id === App.sel.targetId) target = p; });
    if (!target || !target.hand[App.sel.index] || target.hand[App.sel.index].faceUp) {
      App.sel = null; renderPanel(v); return;
    }

    var color = target.hand[App.sel.index].tile.color;
    var ask = el('div', 'ask');
    ask.textContent = target.name + ' 의 ' + (App.sel.index + 1) + '번째 ' +
                      (color === 'b' ? '검정' : '흰색') + ' 타일 — 값을 고르세요';
    pnl.appendChild(ask);

    var known = {};
    v.players.forEach(function (p) {
      p.hand.forEach(function (s) {
        if (s.tile && (s.tile.n !== null || s.tile.joker === true)) known[R.tileId(s.tile)] = true;
      });
    });
    if (v.drawn) known[R.tileId(v.drawn)] = true;

    var allowed = null;
    if ($('hint').checked) {
      allowed = {};
      AI.candidates(v, App.sel.targetId, App.sel.index).forEach(function (t) {
        allowed[t.joker ? 'J' : t.n] = true;
      });
    }

    var nums = el('div', 'nums');
    for (var i = 0; i <= R.MAX_N; i++) {
      (function (n) {
        var b = el('button', null, String(n));
        if (known[color + n] || (allowed && !allowed[n])) b.classList.add('off');
        b.onclick = function () { act('guess', [App.sel.targetId, App.sel.index, color, n]); };
        nums.appendChild(b);
      })(i);
    }
    var jb = el('button', 'jk', '조커');
    if (known[color + 'J'] || (allowed && !allowed['J'])) jb.classList.add('off');
    jb.onclick = function () { act('guess', [App.sel.targetId, App.sel.index, color, null]); };
    nums.appendChild(jb);
    pnl.appendChild(nums);
    panel.appendChild(pnl);
  }

  function showOver(v) {
    var win = null;
    v.players.forEach(function (p) { if (p.id === v.winner) win = p; });
    $('overTitle').textContent = !win ? '무승부' : (win.id === v.me ? '승리' : win.name + ' 승리');
    $('overText').textContent = !win ? '남은 사람이 없습니다.'
      : (win.id === v.me ? '끝까지 숫자를 지켰습니다.' : '다음 판에 설욕하세요.');
    $('over').classList.remove('hidden');
  }

  /* ---------------- 대기실 ---------------- */
  function renderSeats(list, hostView) {
    var box = $('seats'); box.innerHTML = '';
    list.forEach(function (s, i) {
      var row = el('div', 'seat');
      row.appendChild(el('span', null, s.name));
      var sp = el('span'); sp.style.flex = '1'; row.appendChild(sp);
      if (i === 0) row.appendChild(el('span', 'pill host', '방장'));
      if (s.bot) row.appendChild(el('span', 'pill', '봇'));
      box.appendChild(row);
    });
    for (var k = list.length; k < 4; k++) {
      var e2 = el('div', 'seat'); e2.style.opacity = '.4';
      e2.appendChild(el('span', null, '빈 자리'));
      box.appendChild(e2);
    }
    $('hostControls').classList.toggle('hidden', !hostView);
    $('btnStart').disabled = list.length < 2;
    $('btnAddBot').disabled = list.length >= 4;
  }

  function broadcastLobby() {
    if (!App.net) return;
    var list = App.seats.map(function (s) { return { name: s.name, bot: s.bot }; });
    App.net.broadcast(function () { return { t: 'lobby', seats: list }; });
  }

  /* ---------------- 방장 / 참가자 ---------------- */
  function beHost() {
    App.mode = 'host'; App.me = 'host';
    App.seats = [{ id: 'host', name: myName(), bot: false }];
    App.net = new Net();
    App.net.on.status = toast;
    App.net.on.error = toast;
    App.net.on.open = function (code) {
      $('roomCode').textContent = code;
      $('lobbyHint').textContent = '친구에게 이 코드를 알려주세요.';
      show('lobby'); renderSeats(App.seats, true);
    };
    App.net.on.join = function (pid, name) {
      if (App.started || App.seats.length >= 4) {
        App.net.toPlayer(pid, { t: 'err', msg: App.started ? '이미 시작된 방입니다.' : '자리가 찼습니다.' });
        return;
      }
      var base = name, n = 2;
      while (App.seats.some(function (s) { return s.name === name; })) name = base + n++;
      App.seats.push({ id: pid, name: name, bot: false });
      renderSeats(App.seats, true); broadcastLobby(); toast(name + ' 참가');
    };
    App.net.on.leave = function (pid) {
      var seat = seatOf(pid); if (!seat) return;
      App.seats = App.seats.filter(function (s) { return s.id !== pid; });
      if (App.started && App.state) {
        var s = App.state;
        s.players.forEach(function (p) { if (p.id === pid && !p.out) p.out = true; });
        s.log.push(seat.name + ' 연결 끊김 — 탈락 처리');
        var alive = R.alivePlayers(s);
        if (alive.length <= 1) { s.phase = 'over'; s.winner = alive.length ? alive[0].id : null; }
        else if (s.phase === 'setup') {
          var waiting = s.players.filter(function (q) { return !q.out && !s.ready[q.id]; });
          if (!waiting.length) { s.phase = 'draw'; s.log.push('모두 준비 완료 — 시작합니다'); }
        }
        else if (R.current(s).out) {
          s.drawn = null; s.pending = null; s.phase = 'draw';
          for (var i = 1; i <= s.players.length; i++) {
            var idx = (s.turn + i) % s.players.length;
            if (!s.players[idx].out) { s.turn = idx; break; }
          }
        }
        pushViews();
      } else { renderSeats(App.seats, true); broadcastLobby(); }
      toast(seat.name + ' 나감');
    };
    App.net.on.data = function (pid, msg) {
      if (msg.t === 'act' && App.started) doAction(pid, msg.action, msg.args || []);
    };
    App.net.host();
  }

  function beClient(code) {
    App.mode = 'client';
    App.net = new Net();
    App.net.on.status = toast;
    App.net.on.error = function (m) { toast(m); show('home'); App.net.close(); };
    App.net.on.open = function (c) {
      $('roomCode').textContent = c;
      $('lobbyHint').textContent = '방장이 시작하기를 기다리는 중…';
      show('lobby'); renderSeats([], false);
    };
    App.net.on.data = function (_, msg) {
      if (msg.t === 'lobby') renderSeats(msg.seats, false);
      else if (msg.t === 'view') {
        App.view = msg.view; App.me = msg.view.me;
        if ($('game').classList.contains('hidden')) show('game');
        render();
      } else if (msg.t === 'err') toast(msg.msg);
    };
    App.net.join(code, myName());
  }

  /* ---------------- 버튼 ---------------- */
  $('btnSolo').onclick = function () {
    var count = parseInt($('soloCount').value, 10);
    App.skill = parseFloat($('soloSkill').value);
    App.mode = 'solo'; App.me = 'me';
    App.seats = [{ id: 'me', name: myName(), bot: false }];
    var names = ['봇 하나', '봇 둘', '봇 셋'];
    for (var i = 0; i < count - 1; i++) App.seats.push({ id: 'bot' + i, name: names[i], bot: true });
    startEngine();
  };
  $('btnHost').onclick = function () {
    if (!window.Peer) { toast('통신 모듈을 불러오지 못했습니다.'); return; }
    beHost();
  };
  $('btnJoin').onclick = function () {
    var code = $('joinCode').value.trim().toUpperCase();
    if (code.length !== 4) { toast('방 코드 4자리를 입력해 주세요.'); return; }
    if (!window.Peer) { toast('통신 모듈을 불러오지 못했습니다.'); return; }
    beClient(code);
  };
  $('joinCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btnJoin').click(); });
  $('btnAddBot').onclick = function () {
    if (App.seats.length >= 4) return;
    var names = ['봇 하나', '봇 둘', '봇 셋'];
    var used = App.seats.filter(function (s) { return s.bot; }).length;
    App.seats.push({ id: 'bot' + used + '-' + Date.now(), name: names[used] || ('봇 ' + (used + 1)), bot: true });
    renderSeats(App.seats, true); broadcastLobby();
  };
  $('btnStart').onclick = function () { startEngine(); };
  $('btnLeave').onclick = function () { if (App.net) App.net.close(); location.reload(); };
  $('btnAgain').onclick = function () { if (App.net) App.net.close(); location.reload(); };
  $('hint').onchange = function () { render(); };
  $('name').value = localStorage.getItem('davinci.name') || '';
  $('name').addEventListener('change', function () { localStorage.setItem('davinci.name', myName()); });

  App.act = act; App.doAction = doAction; App.pushViews = pushViews; App.render = render;
  window.__dv = App;
})();
