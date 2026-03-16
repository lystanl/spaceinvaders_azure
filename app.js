(() => {
  'use strict';
  const canvas              = document.getElementById('myCanvas');
  const ctx                 = canvas.getContext('2d');
  const finalScoreEl        = document.getElementById('finalScore');
  const finalScoreVictoryEl = document.getElementById('finalScoreVictory');
  const waveClearMsgEl      = document.getElementById('waveClearMsg');
  const gameOverDialog      = document.getElementById('gameOverDialog');
  const waveClearDialog     = document.getElementById('waveClearDialog');
  const victoryDialog       = document.getElementById('victoryDialog');

  //Canvas layout: top HUD bar | play area | bottom lives bar
  const W      = 600;
  const HUD_H  = 32;
  const FOOT_H = 28;
  const H      = 520;
  const PLAY_T = HUD_H;
  const PLAY_H = H - HUD_H - FOOT_H;

  //  Sprite map 
 
  const SPRITES = {
    ship:   { sx:  0, sy:   0, sw: 36, sh: 36 },
    bullet: { sx: 60, sy:  40, sw:  8, sh: 16 },
    A:      { sx:  0, sy:  80, sw: 32, sh: 47 },
    B:      { sx:  100, sy: 130, sw: 29, sh: 30 },
  };

  // Particle dot sprite specs (coloured circles from spritesheet row 1)
  const DOT_SPECS = [
    { sx:  0, sy: 65, sw: 5, sh: 7 },
    { sx:  5, sy: 65, sw: 5, sh: 7 },
    { sx: 10, sy: 65, sw: 5, sh: 7 },
    { sx: 15, sy: 65, sw: 5, sh: 7 },
  ];

  // Wave formations (2 waves total; clearing wave 2 triggers victory)
  const WAVES = [
    // Wave 1: Red Diamond enemies
    [['A','A','A','A','A','A','A','A'],
     ['A','A','A','A','A','A','A','A']],
    // Wave 2: Spaceship enemies, Red Diamonds below
    [['B','B','B','B','B','B','B','B'],
     ['A','A','A','A','A','A','A','A'],
     ['A','A','A','A','A','A','A','A']],
  ];
  const MAX_WAVE = 2;

  // Level Difficulty constants/Game properties
  const DIFF   = { stepDelay: 0.55, descend: 22, fireRate: 1.6, bulletSpd: 200 };
  const POINTS = { A: 10, B: 20 };
  const HP_MAP = { A: 1,  B: 1  };
  const CELL_W = 52, CELL_H = 48;
  const ENEMY_W = 36, ENEMY_H = 32;

  // Asset loading 
  let sheet = null;  // spritesheet
  let bgImg = null;  // space.jpg background

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function drawSprite(spec, dx, dy, dw, dh) {
    if (!sheet) return;
    ctx.drawImage(sheet, spec.sx, spec.sy, spec.sw, spec.sh, dx, dy, dw, dh);
  }

  // Draw background image scaled to cover the play area
  function drawBackground() {
    if (bgImg) {
      ctx.drawImage(bgImg, 0, PLAY_T, W, PLAY_H);
    } else {
      ctx.fillStyle = '#04060f';
      ctx.fillRect(0, PLAY_T, W, PLAY_H);
    }
  }

  //  Game state
  const newState = () => ({
    phase:        'idle',
    score:        0,
    wave:         1,
    lives:        3,
    timeSec:      0,
    fireCooldown: 0,
  });

  let gs = newState();

  // Entities 
  let player       = { x: W/2 - 20, y: PLAY_T + PLAY_H - 50, w: 40, h: 40, speed: 230 };
  let bullets      = [];
  let enemyBullets = [];
  let enemies      = [];
  let particles    = [];

  let swarm = {
    dx: 1, stepDelay: 0.55, stepTimer: 0.55,
    descendPending: false,
    fireTimer: 1.6, fireDelay: 1.6,
  };

  // Formation builder/Entity layout mapping
  function buildFormation(waveIndex) {
    enemies = []; enemyBullets = []; particles = [];

    const waveData = WAVES[Math.min(waveIndex, WAVES.length - 1)];
    const cols   = waveData[0].length;
    const startX = Math.floor((W - cols * CELL_W) / 2) + CELL_W/2 - ENEMY_W/2;
    const startY = PLAY_T + 10;

    waveData.forEach((row, ri) => {
      row.forEach((type, ci) => {
        enemies.push({
          x: startX + ci * CELL_W,
          y: startY + ri * CELL_H,
          w: ENEMY_W, h: ENEMY_H,
          type, alive: true,
          hp:     HP_MAP[type] || 1,
          points: POINTS[type] || 10,
        });
      });
    });

    const boost = 1 + (gs.wave - 1) * 0.13;
    swarm.dx             = 1;
    swarm.stepDelay      = Math.max(0.08, DIFF.stepDelay / boost);
    swarm.stepTimer      = swarm.stepDelay;
    swarm.descendPending = false;
    swarm.fireDelay      = Math.max(0.35, DIFF.fireRate / boost);
    swarm.fireTimer      = swarm.fireDelay;
  }

  // In-game buttons (drawn inside the top HUD bar)
  const BTN_H = 22, BTN_PAD = 10;
  let canvasButtons = [];

  function buildButtons() {
    const items = [];
    if (gs.phase === 'idle' || gs.phase === 'over' || gs.phase === 'victory')
      items.push({ label: 'START',  action: 'start'  });
    if (gs.phase === 'playing')
      items.push({ label: 'PAUSE',  action: 'pause'  });
    if (gs.phase === 'paused')
      items.push({ label: 'RESUME', action: 'resume' });
    if (gs.phase !== 'idle' && gs.phase !== 'victory')
      items.push({ label: 'RESET',  action: 'reset'  });

    ctx.font = 'bold 10px monospace';
    const gap = 6, margin = 8;
    let totalW = 0;
    items.forEach(b => {
      b.w = Math.ceil(ctx.measureText(b.label).width) + BTN_PAD * 2;
      totalW += b.w;
    });
    totalW += gap * (items.length - 1);

    let x = W - margin - totalW;
    const y = Math.floor((HUD_H - BTN_H) / 2);
    items.forEach(b => { b.x = x; b.y = y; b.h = BTN_H; x += b.w + gap; });
    canvasButtons = items;
  }

  function drawButtons() {
    buildButtons();
    ctx.font = 'bold 10px monospace';
    canvasButtons.forEach(b => {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      const isGreen = b.action === 'start' || b.action === 'resume';
      ctx.strokeStyle = isGreen ? '#1a4a1a' : b.action === 'pause' ? '#4a4a00' : '#4a0000';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(b.x + 0.75, b.y + 0.75, b.w - 1.5, b.h - 1.5);
      ctx.fillStyle = isGreen ? '#39ff14' : b.action === 'pause' ? '#ffe600' : '#ff2222';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    });
  }

  function hitButton(cx, cy) {
    for (const b of canvasButtons) {
      if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) return b.action;
    }
    return null;
  }

  function canvasXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }

  canvas.addEventListener('click', (e) => {
    const { x, y } = canvasXY(e);
    const a = hitButton(x, y);
    if (a) handleAction(a);
  });
  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    const { x, y } = canvasXY(e.changedTouches[0]);
    const a = hitButton(x, y);
    if (a) handleAction(a);
  }, { passive: false });
  canvas.addEventListener('mousemove', (e) => {
    const { x, y } = canvasXY(e);
    canvas.style.cursor = hitButton(x, y) ? 'pointer' : 'default';
  });

  function handleAction(action) {
    switch (action) {
      case 'start':  startGame();  break;
      case 'pause':  pauseGame();  break;
      case 'resume': resumeGame(); break;
      case 'reset':  resetGame();  break;
    }
  }

  //  Dialog listeners 
  gameOverDialog?.addEventListener('close', () => {
    if (gameOverDialog.returnValue === 'restart') { resetGame(); startGame(); }
  });
  waveClearDialog?.addEventListener('close', () => {
    if (gs.phase === 'waveclear') beginNextWave();
  });
  victoryDialog?.addEventListener('close', () => {
    if (victoryDialog.returnValue === 'restart') resetGame();
  });

  //  Input (A/D move, Space fire, P pause) 
  const keys = new Set();
  document.addEventListener('keydown', (e) => {
    keys.add(e.key);
    if (e.key === ' ') e.preventDefault();
    if (e.key === 'Enter' && gs.phase === 'idle') startGame();
    if ((e.key === 'p' || e.key === 'P') && gs.phase === 'playing') pauseGame();
    if ((e.key === 'p' || e.key === 'P') && gs.phase === 'paused')  resumeGame();
  });
  document.addEventListener('keyup', (e) => keys.delete(e.key));

  const isLeft  = () => keys.has('a') || keys.has('A');
  const isRight = () => keys.has('d') || keys.has('D');
  const isFire  = () => keys.has(' ');

  //  HiDPI canvas setup 
  function setupCanvas() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  setupCanvas();
  window.addEventListener('resize', setupCanvas);

  //  Game lifecycle 
  function startGame() {
    if (gs.phase === 'playing') return;
    gs.phase = 'playing'; gs.lastTs = null;
    buildFormation(gs.wave - 1);
    if (gs.rafId) cancelAnimationFrame(gs.rafId);
    gs.rafId = requestAnimationFrame(tick);
  }
  function pauseGame() {
    if (gs.phase !== 'playing') return;
    gs.phase = 'paused';
    cancelAnimationFrame(gs.rafId); gs.rafId = null;
    render();
  }
  function resumeGame() {
    if (gs.phase !== 'paused') return;
    gs.phase = 'playing'; gs.lastTs = null;
    gs.rafId = requestAnimationFrame(tick);
  }
  function resetGame() {
    if (gs.rafId) cancelAnimationFrame(gs.rafId);
    gs = newState();
    player = { x: W/2 - 20, y: PLAY_T + PLAY_H - 50, w: 40, h: 40, speed: 230 };
    bullets = []; enemyBullets = []; enemies = []; particles = [];
    swarm = { dx: 1, stepDelay: 0.55, stepTimer: 0.55, descendPending: false, fireTimer: 1.6, fireDelay: 1.6 };
    drawIdle();
  }
  function waveClear() {
    cancelAnimationFrame(gs.rafId); gs.rafId = null;
    if (gs.wave >= MAX_WAVE) {
      // Victory: all waves defeated
      gs.phase = 'victory';
      render();
      if (finalScoreVictoryEl) finalScoreVictoryEl.textContent = gs.score.toLocaleString();
      setTimeout(() => victoryDialog?.showModal(), 400);
    } else {
      gs.phase = 'waveclear';
      if (waveClearMsgEl) waveClearMsgEl.textContent = 'Prepare for Wave ' + (gs.wave + 1) + '...';
      waveClearDialog?.showModal();
    }
  }
  function beginNextWave() {
    gs.wave++; gs.phase = 'playing'; gs.lastTs = null;
    buildFormation(gs.wave - 1);
    gs.rafId = requestAnimationFrame(tick);
  }
  function gameOver() {
    gs.phase = 'over';
    cancelAnimationFrame(gs.rafId); gs.rafId = null;
    if (finalScoreEl) finalScoreEl.textContent = gs.score.toLocaleString();
    render();
    setTimeout(() => gameOverDialog?.showModal(), 400);
  }

  //  Main loop 
  function tick(ts) {
    if (gs.phase !== 'playing') return;
    gs.rafId = requestAnimationFrame(tick);
    if (!gs.lastTs) gs.lastTs = ts;
    const dt = Math.min((ts - gs.lastTs) / 1000, 0.05);
    gs.lastTs = ts;
    gs.timeSec += dt;
    update(dt);
    render();
  }

  //  Update 
  function update(dt) {
    // Player movement (left/right only)
    if (isLeft())  player.x -= player.speed * dt;
    if (isRight()) player.x += player.speed * dt;
    player.x = clamp(player.x, 0, W - player.w);

    // Player fire
    gs.fireCooldown -= dt;
    if (isFire() && gs.fireCooldown <= 0) {
      bullets.push({ x: player.x + player.w/2 - 4, y: player.y - 16, w: 8, h: 16 });
      gs.fireCooldown = 0.25;
    }

    // Move player bullets and check enemy hits
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.y -= 520 * dt;
      if (b.y < PLAY_T) { bullets.splice(i, 1); continue; }
      let hit = false;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (!e.alive) continue;
        if (overlap(b, e)) {
          e.hp--;
          if (e.hp <= 0) {
            e.alive = false;
            gs.score += e.points;
            burst(e.x + e.w/2, e.y + e.h/2, 12);
          }
          bullets.splice(i, 1); hit = true; break;
        }
      }
      if (hit) continue;
    }

    // Swarm march logic
    const alive = enemies.filter(e => e.alive);
    const frac  = alive.length / (enemies.length || 1);
    const step  = Math.max(0.06, swarm.stepDelay / (1 + (1 - frac) * 2.8));

    swarm.stepTimer -= dt;
    if (swarm.stepTimer <= 0) {
      swarm.stepTimer = step;
      if (swarm.descendPending) {
        enemies.forEach(e => { e.y += DIFF.descend; });
        swarm.descendPending = false;
        swarm.dx = -swarm.dx;
      } else {
        let wall = false;
        for (const e of alive) {
          const nx = e.x + swarm.dx * 10;
          if (nx < 0 || nx + e.w > W) { wall = true; break; }
        }
        if (wall) swarm.descendPending = true;
        else      enemies.forEach(e => { e.x += swarm.dx * 10; });
      }
    }

    // Enemies reaching player row triggers game over
    for (const e of alive) {
      if (e.y + e.h >= player.y) { gameOver(); return; }
    }

    // Enemy fire: random bottom-row enemy shoots downward
    swarm.fireTimer -= dt;
    if (swarm.fireTimer <= 0 && alive.length > 0) {
      swarm.fireTimer = swarm.fireDelay * (0.7 + Math.random() * 0.6);
      const s = bottomEnemy(alive);
      if (s) enemyBullets.push({ x: s.x + s.w/2 - 4, y: s.y + s.h, w: 8, h: 16 });
    }

    // Move enemy bullets and check player hit
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.y += DIFF.bulletSpd * dt;
      if (b.y > H) { enemyBullets.splice(i, 1); continue; }
      if (overlap(b, player)) {
        enemyBullets.splice(i, 1);
        gs.lives--;
        burst(player.x + player.w/2, player.y + player.h/2, 16);
        if (gs.lives <= 0) { gameOver(); return; }
      }
    }

    // Age and remove expired particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 80 * dt; p.ttl -= dt;
      if (p.ttl <= 0) particles.splice(i, 1);
    }

    if (alive.length === 0) waveClear();
  }

  //  Helpers 
  function bottomEnemy(alive) {
    if (!alive.length) return null;
    const cols = {};
    alive.forEach(e => {
      const k = Math.round(e.x / CELL_W);
      if (!cols[k] || e.y > cols[k].y) cols[k] = e;
    });
    const front = Object.values(cols);
    return front[Math.floor(Math.random() * front.length)];
  }
  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function burst(cx, cy, n) {
    for (let i = 0; i < n; i++) {
      const a   = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 190;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 40,
        spec: DOT_SPECS[Math.floor(Math.random() * DOT_SPECS.length)],
        size: 5 + Math.random() * 5,
        ttl: 0.3 + Math.random() * 0.4,
        maxTtl: 0.7,
      });
    }
  }
  function fmtTime(sec) {
    const s = Math.floor(sec);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  //  Top HUD bar: score / wave / time / buttons 
  function drawHUD() {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, HUD_H);
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, HUD_H - 1, W, 1);

    ctx.font = 'bold 11px monospace';
    ctx.textBaseline = 'middle';
    const mid = HUD_H / 2;

    ctx.fillStyle = '#555'; ctx.textAlign = 'left';
    ctx.fillText('SCORE', 10, mid);
    ctx.fillStyle = '#39ff14';
    ctx.fillText(gs.score.toLocaleString(), 66, mid);

    ctx.fillStyle = '#555';
    ctx.fillText('WAVE', 190, mid);
    ctx.fillStyle = '#ffe600';
    ctx.fillText(String(gs.wave), 236, mid);

    ctx.fillStyle = '#555';
    ctx.fillText('TIME', 300, mid);
    ctx.fillStyle = '#39ff14';
    ctx.fillText(fmtTime(gs.timeSec), 346, mid);

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  //  Bottom bar: lives as mini ship sprites 
  function drawFooter() {
    const y = H - FOOT_H;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, y, W, FOOT_H);
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, y, W, 1);

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#555';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('LIVES', 10, y + FOOT_H / 2);

    const iconSize = 18, iconGap = 4, startX = 70;
    for (let i = 0; i < gs.lives; i++) {
      drawSprite(SPRITES.ship, startX + i * (iconSize + iconGap), y + Math.floor((FOOT_H - iconSize) / 2), iconSize, iconSize);
    }

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  //  Render 
  function render() {
    // Clear full canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Draw space.jpg background in the play area
    drawBackground();

    // Draw all enemies (shown frozen when paused too)
    for (const e of enemies) {
      if (!e.alive) continue;
      drawSprite(SPRITES[e.type], e.x, e.y, e.w, e.h);
    }

    if (gs.phase === 'paused') {
      // Dim overlay and PAUSED text
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, PLAY_T, W, PLAY_H);
      ctx.font = 'bold 22px monospace';
      ctx.fillStyle = '#ffe600';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('PAUSED', W/2, PLAY_T + PLAY_H/2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    } else {
      // Enemy bullets drawn as the bullet sprite (flipped vertically)
      for (const b of enemyBullets) {
        ctx.save();
        ctx.translate(b.x + b.w/2, b.y + b.h/2);
        ctx.scale(1, -1);
        drawSprite(SPRITES.bullet, -b.w/2, -b.h/2, b.w, b.h);
        ctx.restore();
      }

      // Player bullets drawn as bullet sprite
      for (const b of bullets) {
        drawSprite(SPRITES.bullet, b.x, b.y, b.w, b.h);
      }

      // Player ship
      drawSprite(SPRITES.ship, player.x, player.y, player.w, player.h);
    }

    // Particles: coloured circle dot sprites with alpha fade
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.ttl / p.maxTtl);
      drawSprite(p.spec, p.x - p.size/2, p.y - p.size/2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // HUD bars always drawn on top
    drawHUD();
    drawFooter();
    drawButtons();
  }

  //  Idle / title screen 
  function drawIdle() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    drawBackground();
    const cy = PLAY_T + PLAY_H / 2;
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(57,255,20,0.18)';
    for (let ox = -2; ox <= 2; ox++) for (let oy = -2; oy <= 2; oy++)
      ctx.fillText('SPACE INVADERS', W/2 + ox, cy - 16 + oy);
    ctx.fillStyle = '#39ff14';
    ctx.fillText('SPACE INVADERS', W/2, cy - 16);
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#ccc';
    ctx.fillText('PRESS START OR ENTER', W/2, cy + 16);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    drawHUD();
    drawFooter();
    drawButtons();
  }

  //  Boot 
  (async function init() {
    [sheet, bgImg] = await Promise.all([
      loadImage('spritesheet.png'),
      loadImage('space.jpg'),
    ]);
    drawIdle();
  })();

  window.SpaceInvaders = { start: startGame, pause: pauseGame, resume: resumeGame, reset: resetGame };

})();
