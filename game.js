// Riptide Runner — versión mejorada: menú, escenarios, powerups y serpiente fija en X
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Pixel scale: render to low-res buffer then scale up for pixel-art look
  const BASE_W = 320; // logical width
  const BASE_H = 160; // logical height
  const SCALE = 3; // final canvas size = BASE * SCALE

  canvas.width = BASE_W * SCALE;
  canvas.height = BASE_H * SCALE;
  canvas.style.width = canvas.width + 'px';
  canvas.style.height = canvas.height + 'px';
  const buffer = document.createElement('canvas');
  buffer.width = BASE_W; buffer.height = BASE_H;
  const bctx = buffer.getContext('2d');

  // Read DOM texts (we will draw them inside the canvas for pixel look)
  const domTitle = document.querySelector('main h1');
  const domFooter = document.querySelector('main footer');

  // Game state
  let gameState = 'playing'; // 'playing' | 'gameover' | 'paused'
  let baseSpeed = 1.8;
  let speed = baseSpeed; // world speed
  let distance = 0;
  let highScore = parseInt(localStorage.getItem('riptide.high') || '0', 10) || 0;

  // Physics
  // GRAV reduced slightly so jump feels more prolonged; tuned with jump impulse below.
  const GRAV = 0.45;

  // Scenarios (paletas) — cambiar cada 1500m
  const scenarios = [
    {name:'Rosado-Dunas', sky0:'#ffdff0', sky1:'#ffcfae', sun:'#fff0d6', dune1:'#ffc0c9', dune2:'#ffb09a', ground:'#ffd1d9', accent:'#7b3f3f'},
    {name:'Atardecer', sky0:'#ffe6da', sky1:'#ffc8a6', sun:'#fff1c5', dune1:'#ffd3b8', dune2:'#ffbfa0', ground:'#ffd8c8', accent:'#653232'},
    {name:'Oasis', sky0:'#fff7f4', sky1:'#ffdfe6', sun:'#fff9d9', dune1:'#eafff4', dune2:'#c8ffd8', ground:'#ffdfe6', accent:'#2f5f4f'},
    {name:'Nocturno', sky0:'#2b1b2b', sky1:'#4b2b3a', sun:'#ffd6b3', dune1:'#5b3240', dune2:'#7b4b5a', ground:'#3b242b', accent:'#ffd6c2'}
  ];

  // Snake (fixed X) — segments follow head; head.x is constant
  const snake = {
    x: 48,
    y: BASE_H - 28,
    vy: 0,
    radius: 6,
    segments: [],
    segCount: 9,
    targetGap: 6,
    dashTimer: 0,
    curlTimer: 0,
    active: {shield:0, slow:0, mult:0, magnet:0},
    scoreMult: 1,
  };
  for (let i = 0; i < snake.segCount; i++) snake.segments.push({x: snake.x - i * snake.targetGap, y: snake.y});

  // Obstacles and powerups
  const obstacles = [];
  const powerups = [];
  let obstacleTimer = 40;
  let powerupTimer = 300; // frames-ish

  // Input handling
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') doJump();
    if (e.key.toLowerCase() === 'c') toggleCurl(true);
    if (e.key === 'Shift') doDash(true);
    if (e.code === 'KeyP') togglePause();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'c') toggleCurl(false);
    if (e.key === 'Shift') doDash(false);
  });

  let pointerDownTime = 0; let pointerHoldTimeout = null;
  canvas.addEventListener('pointerdown', () => {
    if (gameState === 'menu') return; // menu buttons handle start
    doJump();
    pointerDownTime = Date.now();
    pointerHoldTimeout = setTimeout(() => doDash(true), 220);
  });
  canvas.addEventListener('pointerup', () => {
    const d = Date.now() - pointerDownTime;
    if (pointerHoldTimeout) { clearTimeout(pointerHoldTimeout); pointerHoldTimeout = null; }
    if (d >= 220) doDash(false);
    pointerDownTime = 0;
  });

  function doJump() {
    if (gameState === 'menu') return;
    if (gameState === 'gameover') { startGame(); return; }
    // stronger initial impulse for a faster takeoff, combined with lower gravity for longer hang-time
    if (snake.y >= BASE_H - 28) snake.vy = -10.2;
  }
  function doDash(on=true) {
    if (on) { snake.dashTimer = 18; speed = Math.min(speed * 1.6, 9); }
    else { /* will decay naturally */ }
  }
  function toggleCurl(on=true) { snake.curlTimer = on ? 90 : 0; }
  function togglePause() { if (gameState==='playing') { gameState='paused'; } else if (gameState==='paused') { gameState='playing'; } }

  // helper: no menu — game starts immediately. show controls via README or key H if desired

  // Spawners
  function spawnObstacle() {
    const h = 10 + Math.random()*28;
    const w = 6 + Math.random()*12;
    const types = ['rock','cactus','spike'];
    const type = types[Math.floor(Math.random()*types.length)];
    obstacles.push({x: BASE_W + 18, y: BASE_H - 16 - h, w, h, type, phase: Math.random()*1000});
    obstacleTimer = 40 + Math.floor(70 / Math.max(0.8, (baseSpeed + distance*0.0006)));
  }
  function spawnPowerup() {
    const types = ['shield','slow','mult','magnet'];
    const type = types[Math.floor(Math.random()*types.length)];
    powerups.push({x: BASE_W + 26, y: BASE_H - 30 - Math.random()*42, type, w:10, h:10, phase: Math.random()*1000});
    powerupTimer = 350 + Math.floor(Math.random()*380);
  }

  // Particles system for effects
  const particles = [];
  let screenFlash = 0; // flash alpha when picking powerup
  function spawnParticles(x,y,color,count){
    for (let i=0;i<count;i++){
      particles.push({x,y, vx:(Math.random()-0.5)*1.8, vy:(Math.random()-0.8)*1.6, life:30+Math.random()*30, size:1+Math.random()*2, color});
    }
  }

  // Helpers
  function rectIntersect(a,b){ return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

  // Update loop
  let last = performance.now();
  function step(now){
    const dt = Math.min(40, now - last) / 16.6667; last = now;
    update(dt); render(); requestAnimationFrame(step);
  }

  function update(dt){
    // scene animation continues in all states
    const currentScenario = scenarios[Math.floor(distance/1500) % scenarios.length];

    if (gameState !== 'playing') return;

  // distance increases with multiplier
  distance += (speed * dt * 0.5) * (snake.scoreMult || 1);

  // recompute base desired speed and apply slow/dash modifiers
  const desired = Math.min(6, baseSpeed + distance * 0.0006);
  if (snake.dashTimer > 0) snake.dashTimer = Math.max(0, snake.dashTimer - dt);
  if (snake.curlTimer > 0) snake.curlTimer = Math.max(0, snake.curlTimer - dt);
  // apply modifiers
  speed = desired;
  if (snake.active.slow > 0) speed *= 0.6;
  if (snake.dashTimer > 0) speed *= 1.6;

    // active powerups timers
    for (const k of Object.keys(snake.active)){
      if (snake.active[k] > 0) snake.active[k] = Math.max(0, snake.active[k] - dt);
    }
    snake.scoreMult = snake.active.mult > 0 ? 2 : 1;

    // spawn logic
    obstacleTimer -= dt;
    if (obstacleTimer <= 0) spawnObstacle();
    powerupTimer -= dt;
    if (powerupTimer <= 0) spawnPowerup();

    // move obstacles/powerups left (world moves)
    const worldFactor = 1.6;
    for (let i = obstacles.length-1; i>=0; i--){
      const ob = obstacles[i];
      ob.x -= speed * dt * worldFactor;
      if (ob.x + ob.w < -24) obstacles.splice(i,1);
    }
    for (let i = powerups.length-1; i>=0; i--){
      const p = powerups[i];
      // magnet effect
      if (snake.active.magnet > 0){
        // simple attraction toward head
        p.x += (snake.x - p.x) * 0.06 * dt;
        p.y += (snake.y - p.y) * 0.06 * dt;
      } else {
        p.x -= speed * dt * worldFactor * 0.9;
      }
      if (p.x + p.w < -20) powerups.splice(i,1);
    }

    // update particles
    for (let i=particles.length-1;i>=0;i--){
      const pa = particles[i];
      pa.vy += 0.06 * dt;
      pa.x += pa.vx * dt * 1.6; pa.y += pa.vy * dt * 1.6;
      pa.life -= dt*1.2;
      if (pa.life <= 0) particles.splice(i,1);
    }
    // flash decay
    screenFlash = Math.max(0, screenFlash - dt*0.03);

    // physics for snake (vertical)
    snake.vy += GRAV * dt;
    snake.y += snake.vy * dt;
    if (snake.y > BASE_H - 28){ snake.y = BASE_H - 28; snake.vy = 0; }

    // head position with breathing/sway
    const head = {x: snake.x + Math.sin(distance/18)*1.6, y: snake.y + Math.sin(distance/12)*0.6};

    // follow segments with smoother interpolation for calm feel
    for (let i = 0; i < snake.segments.length; i++){
      const seg = snake.segments[i];
      const target = i===0 ? head : snake.segments[i-1];
      seg.x += (target.x - seg.x) * (0.18 + i*0.01) * dt;
      seg.y += (target.y - seg.y) * (0.18 + i*0.01) * dt;
    }

    // collisions with obstacles
    const headBox = getHeadBox();
    for (let i=obstacles.length-1;i>=0;i--){
      const ob = obstacles[i];
      // obstacle bobbing animation
      const bob = Math.sin((ob.phase + distance*0.06))*2.2;
      const obBox = {x: ob.x, y: ob.y + bob, w: ob.w, h: ob.h};
      if (rectIntersect(headBox, obBox)){
        if (snake.active.shield > 0){
          snake.active.shield = 0;
          spawnParticles(headBox.x+headBox.w/2, headBox.y+headBox.h/2, '#ffd1d9', 14);
          obstacles.splice(i,1);
        } else {
          spawnParticles(headBox.x+headBox.w/2, headBox.y+headBox.h/2, '#222222', 20);
          gameOver();
          return;
        }
      }
    }

    // pickups
    for (let i = powerups.length-1; i>=0; i--){
      const p = powerups[i];
      if (rectIntersect(headBox, p)){
        applyPowerup(p.type);
        spawnParticles(p.x + p.w/2, p.y + p.h/2, '#fff7d6', 12);
        screenFlash = 0.36;
        powerups.splice(i,1);
      }
    }
  }

  function applyPowerup(type){
    if (type === 'shield') { snake.active.shield = 480; }
    if (type === 'slow') { snake.active.slow = 360; }
    if (type === 'mult') { snake.active.mult = 540; }
    if (type === 'magnet') { snake.active.magnet = 480; }
  }

  function gameOver(){
    gameState = 'gameover';
    highScore = Math.max(highScore, Math.floor(distance));
    localStorage.setItem('riptide.high', String(highScore));
  }

  function getHeadBox(){
    const head = snake.segments[0];
    const size = snake.radius + (snake.curlTimer>0 ? -2 : 0);
    return {x: head.x - size, y: head.y - size, w: size*2, h: size*2};
  }

  // Render
  function render(){
    bctx.clearRect(0,0,BASE_W,BASE_H);
    const scenario = scenarios[Math.floor(distance/1500) % scenarios.length];

    // sky
    const g = bctx.createLinearGradient(0,0,0,BASE_H);
    g.addColorStop(0, scenario.sky0);
    g.addColorStop(1, scenario.sky1);
    bctx.fillStyle = g; bctx.fillRect(0,0,BASE_W,BASE_H);

    // sun (position varies by scenario)
    bctx.fillStyle = scenario.sun; bctx.beginPath(); bctx.arc(BASE_W - 40, 30, 16, 0, Math.PI*2); bctx.fill();

    // dunes (parallax varies)
    drawDunes(bctx, distance*0.32, scenario);

    // ground
    bctx.fillStyle = scenario.ground; bctx.fillRect(0, BASE_H - 16, BASE_W, 16);

  // obstacles
  for (const ob of obstacles) drawObstacle(bctx, ob, scenario, distance);

  // powerups
  for (const p of powerups) drawPowerup(bctx, p, distance);

    // snake segments (tail->head)
    for (let i = snake.segments.length-1; i>=0; i--){
      const s = snake.segments[i];
      const t = i / snake.segments.length;
      const baseW = 7 - t*3 - (snake.dashTimer>0?1:0);
      const baseH = 6 - t*1.6;
      // breathing scale
      const breathe = 1 + Math.sin((distance/14 + i)/8) * 0.03;
      const w = Math.max(2, Math.round(baseW * breathe));
      const h = Math.max(2, Math.round(baseH * breathe));
      const r = 200 - Math.floor(t*70);
      const gcol = 110 + Math.floor(t*70);
      const bcol = 130 + Math.floor(t*20);
      bctx.fillStyle = `rgb(${r},${gcol},${bcol})`;
      bctx.fillRect(Math.round(s.x - w/2), Math.round(s.y - h/2), w, h);
    }
    // head eye + shield halo if active
    const head = snake.segments[0];
    bctx.fillStyle = scenario.accent; bctx.fillRect(Math.round(head.x+2), Math.round(head.y-2), 2, 2);
    if (snake.active.shield > 0){
      bctx.save();
      bctx.globalAlpha = 0.9;
      const grad = bctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 18);
      grad.addColorStop(0, 'rgba(255,255,220,0.9)'); grad.addColorStop(1, 'rgba(255,200,200,0)');
      bctx.fillStyle = grad;
      bctx.beginPath(); bctx.arc(head.x, head.y, 16, 0, Math.PI*2); bctx.fill();
      bctx.restore();
    }

  // Draw title/meta/footer inside canvas so they appear pixelated
  const titleText = (domTitle && domTitle.textContent) ? domTitle.textContent.trim() : 'Riptide Runner';
  const footerText = (domFooter && domFooter.textContent) ? domFooter.textContent.trim() : 'Desarollado por @_eduardo.nunez';
  bctx.fillStyle = scenario.accent;
  bctx.font = 'bold 12px monospace';
  const tw = bctx.measureText(titleText).width;
  bctx.fillText(titleText, Math.round((BASE_W - tw)/2), 12);

  // HUD: distance, highscore (moved a bit lower to avoid overlapping with title)
  bctx.fillStyle = scenario.accent; bctx.font = '10px monospace';
  bctx.fillText('Dist: ' + Math.floor(distance), 8, 26);
  bctx.fillText('High: ' + highScore, 8, 38);

  // footer inside canvas above ground
  bctx.font = '9px monospace';
  const fw = bctx.measureText(footerText).width;
  bctx.fillText(footerText, Math.round((BASE_W - fw)/2), BASE_H - 6);

    // show active powerups small icons
    let ix = BASE_W - 90;
    const icons = ['shield','slow','mult','magnet'];
    for (let id of icons){
      if (snake.active[id] > 0){
        bctx.fillStyle = 'rgba(255,255,255,0.06)';
        bctx.fillRect(ix-2,6,22,14);
        bctx.fillStyle = scenario.accent; bctx.fillText(id[0].toUpperCase(), ix+4, 16);
        ix += 22;
      }
    }

    // draw particles on top
    for (const pa of particles){
      bctx.fillStyle = pa.color;
      bctx.fillRect(Math.round(pa.x), Math.round(pa.y), Math.round(pa.size), Math.round(pa.size));
    }

    // screen flash on pickup
    if (screenFlash > 0){
      bctx.fillStyle = 'rgba(255,240,220,'+screenFlash.toFixed(2)+')'; bctx.fillRect(0,0,BASE_W,BASE_H);
    }

    // if game over, dim
    if (gameState === 'gameover'){
      bctx.fillStyle = 'rgba(0,0,0,0.18)'; bctx.fillRect(0,0,BASE_W,BASE_H);
      bctx.fillStyle = '#fff'; bctx.fillText('Game Over — Click Jugar', BASE_W/2-60, BASE_H/2);
    }

    // blit scaled
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(buffer, 0, 0, BASE_W, BASE_H, 0, 0, BASE_W * SCALE, BASE_H * SCALE);
  }

  function drawDunes(ctx, offset, sc){
    ctx.fillStyle = sc.dune1;
    ctx.beginPath(); ctx.moveTo(0, BASE_H - 22);
    for (let x=0;x<=BASE_W;x+=6){
      const y = BASE_H - 22 - Math.sin((x+offset)/40)*6 - Math.cos((x+offset)/22)*3;
      ctx.lineTo(x,y);
    }
    ctx.lineTo(BASE_W, BASE_H); ctx.lineTo(0, BASE_H); ctx.closePath(); ctx.fill();

    ctx.fillStyle = sc.dune2;
    ctx.beginPath(); ctx.moveTo(0, BASE_H - 34);
    for (let x=0;x<=BASE_W;x+=8){
      const y = BASE_H - 34 - Math.sin((x+offset*0.6)/36)*8 - Math.cos((x+offset)/18)*3;
      ctx.lineTo(x,y);
    }
    ctx.lineTo(BASE_W, BASE_H); ctx.closePath(); ctx.fill();
  }

  function drawObstacle(ctx, o, sc, distance){
    const bob = Math.sin((o.phase + distance*0.06))*2.2;
    const x = Math.round(o.x);
    const y = Math.round(o.y + bob);
    const w = Math.round(o.w);
    const h = Math.round(o.h);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(x+1, y+h-1, w-2, 2);
    if (o.type === 'cactus'){
      // stem
      ctx.fillStyle = sc.accent; ctx.fillRect(x, y, Math.max(3,w-2), h);
      // arms
      ctx.fillRect(x - 4, y + Math.floor(h/3), Math.min(4, w), 3);
      ctx.fillRect(x + Math.floor(w/2), y + Math.floor(h/2), 3, Math.min(6, Math.floor(h/3)));
      // little highlight
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x+1, y+2, Math.min(3,w-2), 2);
    } else if (o.type === 'spike'){
      // triangular spike
      ctx.fillStyle = sc.accent;
      ctx.beginPath(); ctx.moveTo(x, y+h); ctx.lineTo(x + w/2, y); ctx.lineTo(x + w, y+h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x + Math.floor(w/2)-1, y+2, 2, Math.max(2,h-4));
    } else { // rock
      ctx.fillStyle = sc.accent; ctx.fillRect(x, y, w, h);
      // textured dots
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      for (let i=0;i<3;i++) ctx.fillRect(x + (i*3)%w, y + (i*5)%h, 1, 1);
    }
  }

  function drawPowerup(ctx, p, distance){
    const colors = {shield:'#f1c40f', slow:'#3498db', mult:'#9b59b6', magnet:'#2ecc71'};
    const col = colors[p.type] || '#fff';
    const cx = p.x + p.w/2; const cy = p.y + p.h/2 + Math.sin((p.phase + distance*0.08))*2;
    // glow
    const rad = Math.max(10, p.w*2.2);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, hexToRgba(col, 0.9)); grad.addColorStop(1, hexToRgba(col, 0));
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI*2); ctx.fill();
    // core
    ctx.fillStyle = col; ctx.fillRect(Math.round(p.x), Math.round(p.y + Math.sin(p.phase/10)), p.w, p.h);
    // icon letter
    ctx.fillStyle = '#fff'; ctx.font = '9px monospace'; ctx.fillText(p.type[0].toUpperCase(), Math.round(p.x)+2, Math.round(p.y)+8);
  }

  function hexToRgba(hex, a){
    // simple hex to rgba for #rrggbb
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return 'rgba(255,255,255,'+a+')';
    return `rgba(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)},${a})`;
  }

  function reset(){
    // reset state
    gameState = 'playing'; distance = 0; baseSpeed = 1.8; speed = baseSpeed;
    obstacles.length = 0; powerups.length = 0; obstacleTimer = 40; powerupTimer = 300;
    snake.y = BASE_H - 28; snake.vy = 0; snake.segments = [];
    snake.active = {shield:0, slow:0, mult:0, magnet:0}; snake.scoreMult = 1; snake.dashTimer = 0; snake.curlTimer = 0;
    for (let i=0;i<snake.segCount;i++) snake.segments.push({x: snake.x - i*snake.targetGap, y: snake.y});
    menu.classList.add('hidden');
  }

  // click menu start if clicking menu while in menu state
  canvas.addEventListener('click', () => {
    if (gameState === 'menu') startGame();
  });

  function startGame(){ reset(); gameState = 'playing'; menu.classList.add('hidden'); }

  // initialize
  obstacleTimer = 40; powerupTimer = 300; requestAnimationFrame(step);

})();
