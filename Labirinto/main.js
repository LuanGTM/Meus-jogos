(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const startScreen = document.getElementById('startScreen');
  const endScreen = document.getElementById('endScreen');
  const endTitle = document.getElementById('endTitle');
  const endSubtitle = document.getElementById('endSubtitle');
  const finalScore = document.getElementById('finalScore');
  const finalTime = document.getElementById('finalTime');
  const btnRetry = document.getElementById('btnRetry');
  const btnMenu = document.getElementById('btnMenu');
  const btnCampaign = document.getElementById('btnCampaign');
  const btnPause = document.getElementById('btnPause');
  const btnInfinite = document.getElementById('btnInfinite');
  const toastContainer = document.getElementById('toast');
  const scoreEl = document.getElementById('score');
  const timerEl = document.getElementById('timer');
  const levelLabel = document.getElementById('levelLabel');

  const difficultyButtons = startScreen.querySelectorAll('button[data-difficulty]');

  const DIFFS = {
    easy:   { label: 'Fácil',   cols: 24, rows: 16, cell: 32, time: 240, color: '#39ff14', wallColor: '#9dff7a', itemCount: 20, itemValue: 20 },
    medium: { label: 'Médio',   cols: 30, rows: 20, cell: 32, time: 200, color: '#faff00', wallColor: '#fff27a', itemCount: 22, itemValue: 22 },
    hard:   { label: 'Difícil', cols: 36, rows: 24, cell: 32, time: 170, color: '#ff3131', wallColor: '#ff8a8a', itemCount: 24, itemValue: 24 }
  };

  // Resize canvas based on chosen grid
  function resizeFor(diff) {
    const w = diff.cols * diff.cell;
    const h = diff.rows * diff.cell;
    canvas.width = w; canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    initRain();
  }

  // Maze generation using recursive backtracker
  function generateMaze(cols, rows) {
    const cells = [];
    for (let y = 0; y < rows; y++) {
      const row = [];
      for (let x = 0; x < cols; x++) {
        row.push({ x, y, visited: false, walls: { N: true, S: true, E: true, W: true } });
      }
      cells.push(row);
    }

    function neighbors(x, y) {
      const list = [];
      if (y > 0) list.push({ x, y: y-1, dir: 'N', opp: 'S' });
      if (y < rows-1) list.push({ x, y: y+1, dir: 'S', opp: 'N' });
      if (x < cols-1) list.push({ x: x+1, y, dir: 'E', opp: 'W' });
      if (x > 0) list.push({ x: x-1, y, dir: 'W', opp: 'E' });
      return list;
    }

    const stack = [];
    const sx = Math.floor(Math.random() * cols);
    const sy = Math.floor(Math.random() * rows);
    let current = cells[sy][sx];
    current.visited = true;

    while (true) {
      const unvisited = neighbors(current.x, current.y).filter(n => !cells[n.y][n.x].visited);
      if (unvisited.length > 0) {
        const pick = unvisited[Math.floor(Math.random() * unvisited.length)];
        const next = cells[pick.y][pick.x];
        current.walls[pick.dir] = false;
        next.walls[pick.opp] = false;
        stack.push(current);
        current = next;
        current.visited = true;
      } else if (stack.length > 0) {
        current = stack.pop();
      } else break;
    }

    return cells;
  }

  // Build adjacency for pathfinding
  function neighborsFrom(cell, grid) {
    const res = [];
    const { x, y, walls } = cell;
    if (!walls.N) res.push(grid[y-1][x]);
    if (!walls.S) res.push(grid[y+1][x]);
    if (!walls.E) res.push(grid[y][x+1]);
    if (!walls.W) res.push(grid[y][x-1]);
    return res;
  }

  // Random distinct cells
  function randomCell(grid) {
    const rows = grid.length; const cols = grid[0].length;
    return grid[Math.floor(Math.random() * rows)][Math.floor(Math.random() * cols)];
  }

  function randomEdgeCell(grid) {
    const rows = grid.length; const cols = grid[0].length;
    const edgeCells = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (y === 0 || y === rows-1 || x === 0 || x === cols-1) edgeCells.push(grid[y][x]);
      }
    }
    return edgeCells[Math.floor(Math.random() * edgeCells.length)];
  }

  // BFS shortest path for reference (optional for placing collectibles away from path)
  function shortestPath(grid, start, goal) {
    const key = (c) => `${c.x},${c.y}`;
    const q = [start];
    const prev = new Map();
    const seen = new Set([key(start)]);
    while (q.length) {
      const c = q.shift();
      if (c === goal) break;
      for (const n of neighborsFrom(c, grid)) {
        const k = key(n);
        if (!seen.has(k)) { seen.add(k); prev.set(k, c); q.push(n); }
      }
    }
    const path = [];
    let cur = goal;
    while (cur && cur !== start) {
      path.push(cur);
      cur = prev.get(key(cur));
    }
    path.push(start);
    path.reverse();
    return path;
  }

  // Game state
  const state = {
    running: false,
    paused: false,
    score: 0, // cumulative in campaign, single-run otherwise
    phaseScore: 0,
    timeLeft: 0,
    timeElapsed: 0,
    difficulty: null,
    campaign: false,
    campaignOrder: ['easy','medium','hard'],
    campaignIndex: 0,
    totalTimeAccum: 0,
    grid: null,
    start: null,
    goal: null,
    path: [],
    collectibles: [],
    player: { x: 0, y: 0, px: 0, py: 0, size: 0.55, speed: 4.2 }, // px/py pixel coords
    inputs: { up: 0, down: 0, left: 0, right: 0 },
    infinite: false,
    infiniteLevel: 1,
    highScore: Number(localStorage.getItem('datamaze_highscore')||0),
    rain: { cols: [], fontSize: 16 }
  };

  const COLLECT_MSGS = [
    'Fragmento de log encontrado',
    'Acesso rastreado',
    'Checksum verificado',
    'Pacote autenticado',
    'Assinatura válida',
    'Cache decodificada',
    'Trilha de auditoria registrada',
    'Hash consistente',
    'Registro de servidor anexado',
    'Carimbo de tempo validado',
    'Trajeto de roteador mapeado',
    'Criptografia íntegra',
    'ACL verificada',
    'Sessão autenticada',
    'Header íntegro',
    'Payload limpo',
    'Checksum SHA-256 confere',
    'Pacote não alterado em trânsito',
    'Assinatura do perito confirmada'
  ];

  const FAILURE_MSGS = [
    'Pacote perdido na rede.',
    'Conexão expirada no servidor.',
    'Timeout de handshake.',
    'Checksum inválido – transmissão abortada.',
    'Rota congestionada – pacote descartado.',
    'Firewall bloqueou a saída.',
    'Sessão encerrada por inatividade.',
    'Retransmissões excedidas.',
    'Link instável – perda de pacote.',
    'DNS não resolveu o destino.',
    'Tunnel VPN caiu durante o envio.',
    'QoS rebaixou o fluxo – pacote expirou.',
    'Buffer overflow – pacote dropado.',
    'TTL zerado antes do destino.',
    'Janela TCP fechada – sem entrega.'
  ];

  function showToast(text) {
    const div = document.createElement('div');
    div.className = 'toast-item';
    div.textContent = text;
    toastContainer.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; div.style.transform = 'translate(-50%, -6px)'; }, 1800);
    setTimeout(() => { div.remove(); }, 2400);
  }

  function resetScoreboard() {
    scoreEl.textContent = '0';
    timerEl.textContent = '00:00';
  }

  function setDifficulty(diffKey) {
    state.difficulty = diffKey;
    document.body.classList.remove('easy','medium','hard');
    document.body.classList.add(diffKey);
    levelLabel.textContent = `Fase: ${DIFFS[diffKey].label}`;
    resizeFor(DIFFS[diffKey]);
  }

  function getInfiniteDiff() {
    // Scale grid gradually; every 3 levels increase size, reduce time slightly, increase item counts/values
    const base = DIFFS.easy;
    const step = state.infiniteLevel - 1;
    const sizeBoost = Math.floor(step / 3);
    const cols = Math.min(base.cols + sizeBoost * 4, 48);
    const rows = Math.min(base.rows + sizeBoost * 3, 32);
    const time = Math.max(80, base.time - step * 6);
    const itemCount = Math.min(30, base.itemCount + Math.floor(step/2));
    const itemValue = base.itemValue + Math.floor(step/3) * 5;
    return { label: `Infinito L${state.infiniteLevel}`, cols, rows, cell: base.cell, time, color: base.color, wallColor: base.wallColor, itemCount, itemValue };
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = String(Math.floor(sec/60)).padStart(2,'0');
    const s = String(sec%60).padStart(2,'0');
    return `${m}:${s}`;
  }

  function startRun() {
    // If campaign, pick difficulty from sequence
    if (state.campaign) {
      const key = state.campaignOrder[state.campaignIndex];
      setDifficulty(key);
    }
    let diff = DIFFS[state.difficulty];
    if (state.infinite) {
      diff = getInfiniteDiff();
      levelLabel.textContent = `Modo Infinito – ${diff.label}`;
      resizeFor(diff);
    }
    state.grid = generateMaze(diff.cols, diff.rows);
    state.start = randomCell(state.grid);
    state.goal = randomEdgeCell(state.grid);
    // Ensure start and goal are not same and are reachable (in a perfect maze all are reachable)
    while (state.goal === state.start) state.goal = randomEdgeCell(state.grid);
    state.path = shortestPath(state.grid, state.start, state.goal);

    // Place collectibles with target counts/values per difficulty (~400 max per fase)
    const floorCells = state.grid.flat();
    const pathSet = new Set(state.path.map(c => `${c.x},${c.y}`));
    const items = [];
    while (items.length < diff.itemCount && items.length < floorCells.length - 2) {
      const c = floorCells[Math.floor(Math.random() * floorCells.length)];
      const key = `${c.x},${c.y}`;
      if (key === `${state.start.x},${state.start.y}`) continue;
      if (key === `${state.goal.x},${state.goal.y}`) continue;
      // prefer fora do caminho principal
      if (pathSet.has(key) && Math.random() < 0.8) continue;
      if (items.find(it => it.x === c.x && it.y === c.y)) continue;
      items.push({ x: c.x, y: c.y, taken: false, value: diff.itemValue });
    }
    state.collectibles = items;

    // Set player pixel position center of start cell
    const cell = diff.cell;
    state.player.size = 0.55;
    state.player.speed = 4.2; // pixels per frame at 60fps-ish
    state.player.x = state.start.x + 0.5;
    state.player.y = state.start.y + 0.5;
    state.player.px = state.player.x * cell;
    state.player.py = state.player.y * cell;

    // Reset scores appropriately
    if (state.campaign) {
      state.phaseScore = 0;
    } else {
      if (!state.infinite) state.score = 0;
      state.phaseScore = 0;
    }
    state.timeLeft = diff.time;
    state.timeElapsed = 0;
    state.inputs = { up:0,down:0,left:0,right:0 };

    // Update HUD immediately
    scoreEl.textContent = String(state.campaign ? (state.score + state.phaseScore) : state.score);
    timerEl.textContent = formatTime(state.timeLeft);
    state.running = true;
    startScreen.classList.remove('visible');
    endScreen.classList.remove('visible');
    loop(0);
  }

  // Input
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') state.inputs.up = 1;
    if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') state.inputs.down = 1;
    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') state.inputs.left = 1;
    if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') state.inputs.right = 1;
    if (e.key === 'p') togglePause();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') state.inputs.up = 0;
    if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') state.inputs.down = 0;
    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') state.inputs.left = 0;
    if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') state.inputs.right = 0;
  });

  // Physics: smooth move and wall collisions per cell edges
  function stepPlayer(dt) {
    const diff = DIFFS[state.difficulty];
    const cell = diff.cell;
    const vel = state.player.speed * (dt/16.6667); // dt normalized to 60fps

    let vx = (state.inputs.right - state.inputs.left);
    let vy = (state.inputs.down - state.inputs.up);
    const len = Math.hypot(vx, vy) || 1;
    vx /= len; vy /= len;
    let nextPx = state.player.px + vx * vel;
    let nextPy = state.player.py + vy * vel;

    function collide(px, py) {
      const fx = px / cell; const fy = py / cell;
      const cx = Math.floor(fx); const cy = Math.floor(fy);
      const lx = fx - cx; const ly = fy - cy;
      const cur = state.grid[cy]?.[cx];
      if (!cur) return { x: state.player.px, y: state.player.py }; // out of bounds safeguard
      const s = 0.48; // half-size collision radius in cell space

      // Collide with each wall by clamping motion towards closed edges
      // North wall
      if (cur.walls.N && ly - s < 0) py = (cy + s) * cell;
      // South wall
      if (cur.walls.S && ly + s > 1) py = (cy + 1 - s) * cell;
      // West wall
      if (cur.walls.W && lx - s < 0) px = (cx + s) * cell;
      // East wall
      if (cur.walls.E && lx + s > 1) px = (cx + 1 - s) * cell;

      // Also check neighbor walls when near edges
      if (ly < 0.2) {
        const nb = state.grid[cy-1]?.[cx];
        if (nb && nb.walls.S && ly - s < 0) py = (cy + s) * cell;
      }
      if (ly > 0.8) {
        const nb = state.grid[cy+1]?.[cx];
        if (nb && nb.walls.N && ly + s > 1) py = (cy + 1 - s) * cell;
      }
      if (lx < 0.2) {
        const nb = state.grid[cy]?.[cx-1];
        if (nb && nb.walls.E && lx - s < 0) px = (cx + s) * cell;
      }
      if (lx > 0.8) {
        const nb = state.grid[cy]?.[cx+1];
        if (nb && nb.walls.W && lx + s > 1) px = (cx + 1 - s) * cell;
      }

      return { x: px, y: py };
    }

    const c = collide(nextPx, state.player.py);
    nextPx = c.x; // horizontal
    const c2 = collide(nextPx, nextPy);
    nextPx = c2.x; nextPy = c2.y; // vertical

    state.player.px = nextPx;
    state.player.py = nextPy;
    state.player.x = state.player.px / cell;
    state.player.y = state.player.py / cell;
  }

  function update(dt) {
    if (!state.running || state.paused) return;
    stepPlayer(dt);

    // Timer
    state.timeLeft -= dt/1000;
    state.timeElapsed += dt/1000;
    timerEl.textContent = formatTime(state.timeLeft);

    // Collectibles pickup
    const px = Math.floor(state.player.x);
    const py = Math.floor(state.player.y);
    for (const it of state.collectibles) {
      if (!it.taken && it.x === px && it.y === py) {
        it.taken = true;
        if (state.campaign) {
          state.phaseScore += it.value;
          scoreEl.textContent = String(state.score + state.phaseScore);
        } else {
          state.score += it.value;
          scoreEl.textContent = String(state.score);
        }
        const msg = COLLECT_MSGS[Math.floor(Math.random()*COLLECT_MSGS.length)];
        showToast(`${msg} (+${it.value})`);
      }
    }

    // Goal reached?
    if (px === state.goal.x && py === state.goal.y) {
      if (state.infinite) {
        // advance level, grant time bonus and score bonus, regenerate
        const diff = getInfiniteDiff();
        state.score += 100 + Math.floor(state.infiniteLevel * 10);
        showToast(`Nível ${state.infiniteLevel} completo!`);
        state.infiniteLevel += 1;
        startRun();
        return;
      } else {
        endRun(true);
      }
    }

    // Timeout
    if (state.timeLeft <= 0) {
      if (state.infinite) {
        endRun(false);
      } else {
        endRun(false);
      }
    }
  }

  function endRun(success) {
    state.running = false;
    const phaseTime = DIFFS[state.difficulty].time - Math.max(0, Math.floor(state.timeLeft));

    if (state.campaign) {
      state.totalTimeAccum += phaseTime;
      if (success) {
        state.score += state.phaseScore;
        const next = state.campaignIndex + 1;
        if (next < state.campaignOrder.length) {
          // Next phase
          state.campaignIndex = next;
          showToast(`Fase ${next} concluída. Avançando...`);
          setTimeout(() => startRun(), 700);
          return;
        } else {
          // Campaign completed – regra 750 ou perde
          if (state.score >= 750) {
            endTitle.textContent = 'Transferência concluída com sucesso.';
            endSubtitle.textContent = 'Pontuação alta: avance 6 casas.';
            showToast('Resultado: avance 6 casas.');
          } else {
            endTitle.textContent = 'Meta não atingida.';
            endSubtitle.textContent = 'Regra 750 ou perde: volte 4 casas.';
            showToast('Volte 4 casas.');
          }
          finalScore.textContent = String(state.score);
          finalTime.textContent = formatTime(state.totalTimeAccum);
          endScreen.classList.add('visible');
          return;
        }
      } else {
        // Campaign failed: check 750-point rule (applies if failing na fase 2 ou 3)
        const accumulated = state.score + state.phaseScore;
        if (accumulated >= 750 && state.campaignIndex >= 1) {
          endTitle.textContent = 'Sucesso por pontuação acumulada.';
          endSubtitle.textContent = 'Meta de 750 atingida: avance 4 casas.'; // mantém avanço 4 em falha com 750+
          finalScore.textContent = String(accumulated);
          finalTime.textContent = formatTime(state.totalTimeAccum + phaseTime);
          showToast('Bônus: avanço de 4 casas garantido.');
          endScreen.classList.add('visible');
        } else {
          endTitle.textContent = 'Falha na transmissão – dados incompletos.';
          endSubtitle.textContent = FAILURE_MSGS[Math.floor(Math.random()*FAILURE_MSGS.length)];
          finalScore.textContent = String(accumulated);
          finalTime.textContent = formatTime(state.totalTimeAccum + phaseTime);
          showToast('Volte 4 casas.');
          endScreen.classList.add('visible');
        }
        return;
      }
    }

    // Single-run end
    endTitle.textContent = success ? 'Transferência concluída com sucesso.' : 'Falha na transmissão – dados incompletos.';
    endSubtitle.textContent = success ? 'Pacote entregue ao servidor de destino.' : FAILURE_MSGS[Math.floor(Math.random()*FAILURE_MSGS.length)];
    finalScore.textContent = String(state.score);
    finalTime.textContent = formatTime(phaseTime);
    endScreen.classList.add('visible');

    // Infinite mode: save high score
    if (state.infinite) {
      if (state.score > state.highScore) {
        state.highScore = state.score;
        localStorage.setItem('datamaze_highscore', String(state.highScore));
        showToast(`Novo recorde: ${state.highScore}`);
      }
    }
  }

  // Rendering
  function draw() {
    const diff = DIFFS[state.difficulty];
    const cell = diff.cell;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background rain effect
    drawRain();
    // subtle base tint
    ctx.fillStyle = 'rgba(8,20,37,0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Maze walls
    ctx.strokeStyle = DIFFS[state.difficulty].wallColor || '#123a5f';
    ctx.lineWidth = 3;
    const grid = state.grid;
    if (grid) {
      for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[0].length; x++) {
          const c = grid[y][x];
          const px = x * cell; const py = y * cell;
          ctx.beginPath();
          if (c.walls.N) { ctx.moveTo(px, py); ctx.lineTo(px+cell, py); }
          if (c.walls.S) { ctx.moveTo(px, py+cell); ctx.lineTo(px+cell, py+cell); }
          if (c.walls.W) { ctx.moveTo(px, py); ctx.lineTo(px, py+cell); }
          if (c.walls.E) { ctx.moveTo(px+cell, py); ctx.lineTo(px+cell, py+cell); }
          ctx.stroke();
        }
      }
    }

    // Removed path glow highlight

    // Collectibles
    if (state.collectibles) {
      for (const it of state.collectibles) {
        if (it.taken) continue;
        const cx = it.x * cell + cell/2;
        const cy = it.y * cell + cell/2;
        const t = performance.now()/1000;
        const pulse = 0.5 + 0.5*Math.sin(t*4 + (it.x+it.y));
        const r = 6 + 2*pulse;
        ctx.save();
        ctx.shadowColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#7bff88';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#0af7cd';
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
        ctx.restore();
        // Little code fragment
        ctx.fillStyle = '#bff';
        ctx.fillRect(cx-1, cy-6, 2, 12);
        ctx.fillRect(cx-4, cy-3, 8, 2);
      }
    }

    // Goal portal
    if (state.goal) {
      const gx = state.goal.x * cell + cell/2;
      const gy = state.goal.y * cell + cell/2;
      const t = performance.now()/1000;
      ctx.save();
      ctx.strokeStyle = DIFFS[state.difficulty].wallColor || DIFFS[state.difficulty].color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      const r1 = 10 + 4*Math.sin(t*5);
      const r2 = 18 + 6*Math.cos(t*3);
      ctx.arc(gx, gy, r1, 0, Math.PI*2);
      ctx.stroke();
      ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.arc(gx, gy, r2, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }

    // Player (data packet cube)
    if (state.running) {
      const px = state.player.px; const py = state.player.py;
      const s = DIFFS[state.difficulty].cell * state.player.size*0.5;
      ctx.save();
      ctx.translate(px, py);
      ctx.shadowColor = DIFFS[state.difficulty].wallColor || DIFFS[state.difficulty].color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#bde7ff';
      ctx.strokeStyle = DIFFS[state.difficulty].wallColor || DIFFS[state.difficulty].color;
      ctx.lineWidth = 2;
      // cube-ish
      ctx.beginPath(); ctx.rect(-s, -s, s*2, s*2); ctx.fill(); ctx.stroke();
      // inner circuitry
      ctx.strokeStyle = '#69d2ff'; ctx.globalAlpha = 0.6; ctx.beginPath();
      ctx.moveTo(-s+4, -s+6); ctx.lineTo(s-4, -s+6);
      ctx.moveTo(-s+4, 0); ctx.lineTo(s-4, 0);
      ctx.moveTo(-s+4, s-6); ctx.lineTo(s-4, s-6);
      ctx.stroke();
      ctx.restore();
    }

    // HUD center glow
    // optional visuals
  }

  let last = 0;
  function loop(ts) {
    if (!state.running) return;
    const dt = Math.min(50, ts - last || 16.7);
    last = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // UI wiring
  difficultyButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const key = btn.dataset.difficulty;
      setDifficulty(key);
      // start single run
      state.campaign = false;
      state.infinite = false;
      state.campaignIndex = 0;
      state.totalTimeAccum = 0;
      startRun();
    });
  });
  btnRetry.addEventListener('click', () => {
    if (state.campaign) {
      // restart whole campaign
      state.campaignIndex = 0;
      state.totalTimeAccum = 0;
      state.score = 0;
      startRun();
    } else {
      startRun();
    }
  });
  btnMenu.addEventListener('click', () => {
    endScreen.classList.remove('visible');
    startScreen.classList.add('visible');
    state.running = false;
    resetScoreboard();
    if (btnPause) btnPause.textContent = 'Pausar';
  });

  // Campaign button
  if (btnCampaign) {
    btnCampaign.addEventListener('click', () => {
      state.campaign = true;
      state.infinite = false;
      state.campaignIndex = 0;
      state.totalTimeAccum = 0;
      state.score = 0;
      startRun();
    });
  }

  // Infinite mode button
  if (btnInfinite) {
    btnInfinite.addEventListener('click', () => {
      state.campaign = false;
      state.infinite = true;
      state.infiniteLevel = 1;
      state.score = 0;
      setDifficulty('easy');
      startRun();
    });
  }

  function togglePause() {
    state.paused = !state.paused;
    if (btnPause) btnPause.textContent = state.paused ? 'Retomar' : 'Pausar';
  }
  if (btnPause) {
    btnPause.addEventListener('click', togglePause);
  }

  // Matrix-like rain setup
  function initRain() {
    const fontSize = 16;
    state.rain.fontSize = fontSize;
    const columns = Math.floor(canvas.width / fontSize);
    state.rain.cols = new Array(columns).fill(0).map(() => ({ y: Math.random()*canvas.height, speed: 2 + Math.random()*3 }));
  }
  const RAIN_CHARS = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  function drawRain() {
    const fontSize = state.rain.fontSize;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(130,255,160,0.85)';
    ctx.font = `${fontSize}px monospace`;
    const cols = state.rain.cols;
    if (!cols || cols.length === 0) return;
    for (let i = 0; i < cols.length; i++) {
      const x = i * fontSize + 4;
      const c = RAIN_CHARS[Math.floor(Math.random()*RAIN_CHARS.length)];
      ctx.fillText(c, x, cols[i].y);
      cols[i].y += cols[i].speed * 3;
      if (cols[i].y > canvas.height + 20) cols[i].y = -20;
    }
  }

  // Default body theme
  document.body.classList.add('easy');
})();
