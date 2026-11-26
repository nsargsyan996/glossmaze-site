// Gloss Maze mini board for the website: the same rules as the game (src/game/engine.ts).
// It plays itself until the visitor swipes, drags or presses an arrow key.
(function () {
  'use strict';
  // Levels 12, 16 and 25 from the game's generator, so the site shows real levels.
  var LEVELS = [{"w":6,"h":8,"start":10,"walls":"000000010000010101010101010101011001011011000011","solution":["down","left","down","left","up","right","down","left","down"]},{"w":6,"h":9,"start":44,"walls":"100111100001110101110000000000010110000000110111110111","solution":["up","left","down","right","down","left","down","right","up","left","down"]},{"w":7,"h":11,"start":13,"walls":"10000001011110101111010111101011110100000010111111000000000111000110000000011","solution":["down","left","up","right","left","down","right","left","up","right","up","right","down","left"]}];
  var DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  var KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
  var MS_PER_CELL = 40, SWIPE = 22, MAX_QUEUE = 3;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mount(root) {
    var board = root.querySelector('.board');
    var caption = root.querySelector('.board-caption');
    var restartBtn = root.querySelector('[data-restart]');
    var levelIdx = 0, L, walls, cells, fillets, ball, pos, painted, left, c, m;
    var busyUntil = 0, queue = [], autoplay = !reduced, autoStep = 0, timer = null, won = false;

    function isFloor(x, y) { return x >= 0 && y >= 0 && x < L.w && y < L.h && !walls[y * L.w + x]; }

    function build() {
      L = LEVELS[levelIdx];
      walls = L.walls.split('').map(function (ch) { return ch === '1'; });
      var maxW = Math.min(root.clientWidth || 360, 460);
      c = Math.floor(Math.min(maxW / (L.w + 0.9), 56));
      m = Math.round(c * 0.45);
      board.style.setProperty('--c', c + 'px');
      board.style.width = (L.w * c + 2 * m) + 'px';
      board.style.height = (L.h * c + 2 * m) + 'px';
      board.innerHTML = '';
      cells = {}; fillets = [];
      var r = Math.round(c * 0.3);
      for (var i = 0; i < walls.length; i++) {
        var x = i % L.w, y = Math.floor(i / L.w);
        if (walls[i]) continue;
        var up = !isFloor(x, y - 1), down = !isFloor(x, y + 1), lf = !isFloor(x - 1, y), rt = !isFloor(x + 1, y);
        var el = document.createElement('div');
        el.className = 'cell' + (up ? ' up' : '');
        el.style.left = (m + x * c) + 'px';
        el.style.top = (m + y * c) + 'px';
        el.style.borderRadius = [up && lf, up && rt, down && rt, down && lf].map(function (b) { return b ? r + 'px' : '0'; }).join(' ');
        var html = '<span class="dot"></span><span class="paint"></span>';
        if (lf) html += '<span class="ao-l"></span>';
        if (rt) html += '<span class="ao-r"></span>';
        if (up) {
          var tl = !lf && isFloor(x - 1, y - 1) ? r : 0, tr = !rt && isFloor(x + 1, y - 1) ? r : 0;
          html += '<span class="lip-shadow"></span><span class="lip" style="border-radius:' + tl + 'px ' + tr + 'px 0 0"></span>';
        }
        el.innerHTML = html;
        board.appendChild(el);
        cells[i] = el;
      }
      // Rounded corners on wall islands (floor fills the corner, tray surface curves over it).
      for (var j = 0; j < walls.length; j++) {
        if (!walls[j]) continue;
        var wx = j % L.w, wy = Math.floor(j / L.w), X = m + wx * c, Y = m + wy * c;
        // [left, top, circle centre, side x, side y] for the TL, TR, BL, BR corners of this wall tile.
        [[X, Y, '100% 100%', -1, -1], [X + c - r, Y, '0% 100%', 1, -1], [X, Y + c - r, '100% 0%', -1, 1], [X + c - r, Y + c - r, '0% 0%', 1, 1]].forEach(function (k) {
          var sx = k[3], sy = k[4];
          if (!(isFloor(wx + sx, wy) && isFloor(wx, wy + sy) && isFloor(wx + sx, wy + sy))) return;
          var f = document.createElement('div');
          f.className = 'fillet';
          f.style.left = k[0] + 'px'; f.style.top = k[1] + 'px';
          f.style.setProperty('--r', r + 'px');
          f.style.setProperty('--at', k[2]);
          f.dataset.around = [(wy) * L.w + wx + sx, (wy + sy) * L.w + wx, (wy + sy) * L.w + wx + sx].join(',');
          board.appendChild(f);
          fillets.push(f);
        });
      }
      ball = document.createElement('div');
      ball.className = 'ball';
      ball.innerHTML = '<b></b>';
      board.appendChild(ball);
      var win = document.createElement('div');
      win.className = 'win';
      var label = document.createElement('span');
      label.textContent = root.getAttribute('data-text-painted') || 'Painted!';
      win.appendChild(label);
      board.appendChild(win);
      reset();
    }

    function place(p, ms) {
      ball.style.transitionDuration = ms + 'ms';
      ball.style.transform = 'translate(' + (m + (p % L.w) * c) + 'px,' + (m + Math.floor(p / L.w) * c) + 'px)';
    }

    function paint(i, delay) {
      if (painted[i]) return;
      painted[i] = true; left--;
      var el = cells[i].querySelector('.paint');
      el.style.transitionDelay = delay + 'ms';
      cells[i].classList.add('painted');
    }

    function refreshFillets() {
      fillets.forEach(function (f) {
        var wet = f.dataset.around.split(',').every(function (k) { return painted[+k]; });
        f.classList.toggle('wet', wet);
      });
    }

    function reset() {
      pos = L.start; won = false; queue = []; busyUntil = 0; autoStep = 0;
      painted = walls.map(function () { return false; });
      left = walls.filter(function (w) { return !w; }).length;
      board.classList.remove('won');
      Object.keys(cells).forEach(function (k) {
        cells[k].classList.remove('painted');
        cells[k].querySelector('.paint').style.transitionDelay = '0ms';
      });
      paint(pos, 0);
      refreshFillets();
      place(pos, 0);
    }

    // Public entry point: if the ball is still rolling, keep the swipe (in order, up to 3).
    function move(dir) {
      if (won) return false;
      if (Date.now() < busyUntil || queue.length) {
        if (queue.length < MAX_QUEUE) queue.push(dir);
        scheduleDrain();
        return false;
      }
      return roll(dir);
    }

    var draining = false;
    function scheduleDrain() {
      if (draining) return;
      draining = true;
      setTimeout(function () {
        draining = false;
        if (Date.now() < busyUntil) { scheduleDrain(); return; }
        // Run queued moves directly (never back through move(), which would re-queue them).
        while (queue.length && !won) { if (roll(queue.shift())) break; }
        if (queue.length && !won) scheduleDrain();
        else if (won) queue = [];
      }, Math.max(0, busyUntil - Date.now()));
    }

    function roll(dir) {
      var now = Date.now();
      var d = DELTA[dir], x = pos % L.w, y = Math.floor(pos / L.w), path = [];
      while (isFloor(x + d[0], y + d[1])) { x += d[0]; y += d[1]; path.push(y * L.w + x); }
      if (!path.length) return false;
      var ms = reduced ? 1 : Math.max(120, path.length * MS_PER_CELL);
      path.forEach(function (p, k) { paint(p, reduced ? 0 : (k + 1) * MS_PER_CELL); });
      pos = path[path.length - 1];
      busyUntil = now + ms;
      place(pos, ms);
      setTimeout(function () {
        refreshFillets();
        ball.classList.remove('bump'); void ball.offsetWidth; ball.classList.add('bump');
      }, ms);
      if (left === 0) {
        won = true;
        setTimeout(function () { board.classList.add('won'); }, ms + 150);
        setTimeout(nextLevel, ms + 1500);
      }
      return true;
    }

    function nextLevel() {
      levelIdx = (levelIdx + 1) % LEVELS.length;
      build();
      if (autoplay) schedule(900);
    }

    function schedule(ms) {
      clearTimeout(timer);
      timer = setTimeout(function step() {
        if (!autoplay || won) return;
        if (autoStep < L.solution.length) move(L.solution[autoStep++]);
        timer = setTimeout(step, 700);
      }, ms);
    }

    function takeOver() {
      if (!autoplay) return;
      autoplay = false;
      clearTimeout(timer);
      reset();
      if (caption) caption.textContent = root.getAttribute('data-text-your-turn') || 'Your turn: paint every tile.';
    }

    // Keyboard (when the board has focus)
    board.addEventListener('keydown', function (e) {
      var dir = KEYS[e.key];
      if (!dir) return;
      e.preventDefault();
      takeOver();
      move(dir);
    });

    // Pointer: one drag can steer several moves, like the game (src/game/input.ts).
    var anchor = null, lastDir = null;
    board.addEventListener('pointerdown', function (e) {
      board.focus({ preventScroll: true });
      board.setPointerCapture(e.pointerId);
      anchor = { x: e.clientX, y: e.clientY }; lastDir = null;
    });
    board.addEventListener('pointermove', function (e) {
      if (!anchor) return;
      var dx = e.clientX - anchor.x, dy = e.clientY - anchor.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return;
      var dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      anchor = { x: e.clientX, y: e.clientY };
      if (dir === lastDir) return;
      lastDir = dir;
      takeOver();
      move(dir);
    });
    ['pointerup', 'pointercancel'].forEach(function (t) { board.addEventListener(t, function () { anchor = null; }); });

    if (restartBtn) restartBtn.addEventListener('click', function () { takeOver(); reset(); });

    var lastWidth = root.clientWidth;
    window.addEventListener('resize', function () {
      if (Math.abs(root.clientWidth - lastWidth) < 40) return;
      lastWidth = root.clientWidth;
      var wasAuto = autoplay; build(); if (wasAuto) schedule(600);
    });

    build();
    if (autoplay) schedule(800);
  }

  document.querySelectorAll('[data-board]').forEach(mount);
})();
