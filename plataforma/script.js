// Computação Forence — Salvamento nas Nuvens (Canvas Platformer)
// Controles: ← → mover, Espaço pular, R reiniciar. Botão 🔊 alterna o som.

(() => {
  // Estado global do jogo (pontuação e som)
  const state = {
    score: 0,
    muted: false,
  };

  // Referências de DOM
  const el = {
    game: document.getElementById('game'),
    dialog: document.getElementById('dialog'),
    startBtn: document.getElementById('startBtn'),
    muteToggle: document.getElementById('muteToggle'),
    score: document.getElementById('score'),
    collected: document.getElementById('collected'),
    goal: document.getElementById('goal'),
    canvas: document.getElementById('gameCanvas'),
    boot: document.getElementById('boot'),
    btnRight: document.getElementById('btnRight'),
    btnJump: document.getElementById('btnJump'),
    mobileControls: document.getElementById('mobileControls'),
  };

  // Sons via WebAudio
  const audio = (() => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let muted = false;
    const vol = ctx.createGain();
    vol.gain.value = 0.05;
    vol.connect(ctx.destination);
    function tone(freq = 440, dur = 0.08, type = 'square') {
      if (muted) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g).connect(vol);
      o.start();
      o.stop(ctx.currentTime + dur + 0.02);
    }
    return {
      setMuted: (v) => (muted = v),
      beep: () => tone(880, 0.05, 'square'),       // pulo
      type: () => tone(440, 0.03, 'square'),       // interface
      ok: () => { tone(740, 0.06, 'sine'); setTimeout(() => tone(980, 0.08, 'sine'), 70); },
      err: () => { tone(220, 0.08, 'sawtooth'); setTimeout(() => tone(150, 0.08, 'sawtooth'), 70); },
    };
  })();

  // Utilidades HUD
  function setDialog(text){ el.dialog && (el.dialog.textContent = `Forence: ${text}`); }
  function setScore(delta){ state.score = Math.max(0, state.score + delta); if (el.score) el.score.textContent = state.score; }

  // Controles UI
  el.startBtn && el.startBtn.addEventListener('click', start);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && el.boot && el.boot.style.display !== 'none') start();
  });
  el.muteToggle && el.muteToggle.addEventListener('click', () => {
    state.muted = !state.muted; audio.setMuted(state.muted); el.muteToggle.textContent = state.muted ? '🔇' : '🔊';
  });

  function start(){
    audio.type();
    if (el.boot) el.boot.style.display = 'none';
    if (el.canvas) el.canvas.style.display = 'block';
    setDialog('Modo plataformas nas nuvens iniciado. Boa sorte!');
    startPlatformer();
  }

  // =====================
  // Modo: Plataformas nas Nuvens (canvas)
  // =====================
  function startPlatformer(){
    const canvas = el.canvas;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    // Estado do platformer
    const PF = {
      running: true,
      collected: 0,
      goal: 10,
      cameraX: 0,
      mode: 'alive', // 'alive' | 'dying' | 'dead'
      deathTimer: 0,
      particles: [],
      bgOff: [0,0,0],
      minX: 0,
      spawnGrace: 1.5, // segundos de invulnerabilidade ao spawn
      spawnLock: 0.35, // tempo colado na plataforma inicial
      time: 0,
      animSx: 1,
      animSy: 1,
      hasDoubleJump: true,
      maxJumps: 2,
      groundPlat: null,
      timeLeft: 80.0,
      specialReady: false,
      specialUsed: false,
      specialUses: 0,
      specialFx: 0.0,
    };
    if (el.collected) el.collected.textContent = '0';
    if (el.goal) el.goal.textContent = PF.goal.toString();
    state.score = 0; if (el.score) el.score.textContent = '0';

    // Física
    const G = 1750;    // gravidade px/s^2 (ainda mais difícil)
    const MOVE = 190;  // vel. lateral menor (menos controle)
    const JUMP = 450;  // impulso (pulo mais alto)
    const JUMP_AIR = 340; // pulo aéreo menor (mais difícil)o segundo pulo (duplo)
    const DT_MAX = 1/30;
    const COYOTE_TIME = 0.04;   // menor tolerância após sair da borda (mais difícil)
    const JUMP_BUFFER = 0.05;   // menor tolerância antes de tocar o chão (mais difícil)
    let coyote = 0;             // timer de coyote
    let jumpBuffer = 0;         // timer do buffer de pulo
    let jumpsUsed = 0;

    // Input
    const keys = { left:false, right:false, jump:false };
    let touchId = null;
    let touchStartX = 0;
    let touchStartY = 0;
    const TOUCH_THRESHOLD = 10; // pixels mínimos para considerar um arrasto
    const SWIPE_THRESHOLD = 50; // pixels para considerar um swipe

    // Funções de controle
    const pressRight = (down) => { 
      if (PF.mode === 'alive') {
        keys.right = down; 
        keys.left = false; // Garante que não haja conflito entre esquerda e direita
      }
    };
    
    const pressLeft = (down) => { 
      if (PF.mode === 'alive') {
        keys.left = down; 
        keys.right = false; // Garante que não haja conflito entre esquerda e direita
      }
    };
    
    const pressJump = () => { 
      if (PF.mode === 'alive') {
        jumpBuffer = JUMP_BUFFER; 
        audio.beep(); // Feedback sonoro ao pular
      }
    };

    // Bind dos botões de toque
    const bindBtn = (btn, onDown, onUp) => {
      if (!btn) return;
      
      // Função para prevenir comportamentos padrão
      const preventDefault = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };

      // Eventos de toque
      btn.addEventListener('touchstart', (e) => {
        preventDefault(e);
        if (onDown) onDown();
      }, { passive: false });
      
      btn.addEventListener('touchend', (e) => {
        preventDefault(e);
        if (onUp) onUp();
      }, { passive: false });
      
      btn.addEventListener('touchcancel', (e) => {
        preventDefault(e);
        if (onUp) onUp();
      }, { passive: false });
      
      // Eventos de mouse (para navegadores desktop com toque)
      btn.addEventListener('mousedown', (e) => {
        preventDefault(e);
        if (onDown) onDown();
      });
      
      btn.addEventListener('mouseup', (e) => {
        preventDefault(e);
        if (onUp) onUp();
      });
      
      btn.addEventListener('mouseleave', (e) => {
        preventDefault(e);
        if (onUp) onUp();
      });
      
      // Previne menu de contexto
      btn.addEventListener('contextmenu', (e) => {
        preventDefault(e);
        return false;
      });
    };
    
    // Configura controles móveis
    if (el.btnLeft && el.btnRight && el.btnJump) {
      bindBtn(el.btnLeft, () => pressLeft(true), () => pressLeft(false));
      bindBtn(el.btnRight, () => pressRight(true), () => pressRight(false));
      bindBtn(el.btnJump, () => pressJump(), null);
      
      // Adiciona feedback visual ao tocar nos botões
      const addButtonFeedback = (btn) => {
        if (!btn) return;
        
        btn.addEventListener('touchstart', () => {
          btn.style.transform = 'scale(0.95)';
          btn.style.opacity = '0.9';
        });
        
        const resetButton = () => {
          btn.style.transform = '';
          btn.style.opacity = '';
        };
        
        btn.addEventListener('touchend', resetButton);
        btn.addEventListener('touchcancel', resetButton);
      };
      
      addButtonFeedback(el.btnLeft);
      addButtonFeedback(el.btnRight);
      addButtonFeedback(el.btnJump);
    }
    
    // Controles por gestos na tela
    function handleTouchStart(e) {
      // Se já estiver rastreando um toque, ignora novos toques
      if (touchId !== null) return;
      
      const touch = e.touches[0];
      touchId = touch.identifier;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      
      // Verifica se é um toque na área esquerda da tela (movimento)
      if (touch.clientX < window.innerWidth / 2) {
        pressLeft(true);
      } else {
        // Se for na direita, pode ser pulo ou movimento para direita
        if (PF.mode === 'alive') {
          jumpBuffer = JUMP_BUFFER;
          audio.beep();
        }
      }
      
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    
    function handleTouchMove(e) {
      if (touchId === null) return;
      
      // Encontra o toque que estamos rastreando
      const touch = Array.from(e.changedTouches).find(t => t.identifier === touchId);
      if (!touch) return;
      
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      
      // Se o movimento for significativo, atualiza a direção
      if (Math.abs(dx) > TOUCH_THRESHOLD) {
        if (dx > 0) {
          pressRight(true);
          pressLeft(false);
        } else {
          pressLeft(true);
          pressRight(false);
        }
      }
      
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    
    function handleTouchEnd(e) {
      if (touchId === null) return;
      
      // Verifica se o toque que terminou é o que estávamos rastreando
      const touch = Array.from(e.changedTouches).find(t => t.identifier === touchId);
      if (!touch) return;
      
      // Libera todos os controles
      pressLeft(false);
      pressRight(false);
      touchId = null;
      
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    
    // Adiciona listeners de toque à tela com opções otimizadas
    const passiveOptions = { passive: false };
    canvas.addEventListener('touchstart', handleTouchStart, passiveOptions);
    canvas.addEventListener('touchmove', handleTouchMove, passiveOptions);
    canvas.addEventListener('touchend', handleTouchEnd, passiveOptions);
    canvas.addEventListener('touchcancel', handleTouchEnd, passiveOptions);
    
    // Previne o comportamento padrão de rolagem e zoom
    document.body.addEventListener('touchmove', (e) => {
      if (e.target === canvas || e.target.closest('.mobile-controls')) {
        e.preventDefault();
      }
    }, { passive: false });
    
    // Ajusta o viewport para dispositivos móveis
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta) {
      viewportMeta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
    }

    const onKey = (e) => {
      const d = e.type === 'keydown';
      const k = e.key.toLowerCase();
      if (PF.mode === 'alive'){
        // Movimento apenas para frente: ignoramos esquerda
        if (k === 'arrowright' || k === 'd') keys.right = d;
        if (k === 'arrowleft'  || k === 'a') keys.left  = d;
        if (e.code === 'Space') {
          if (d) {
            jumpBuffer = JUMP_BUFFER; // registra intenção de pulo
          }
          e.preventDefault();
        }
      }
      // Reset só quando não estiver vivo (após morte)
      if (k === 'r' && d && PF.mode !== 'alive') reset();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    // Plataformas
    const platforms = [];
    // chão
    platforms.push({x:-4000, y:H-40, w:8000, h:40, cloud:false});

    // plataforma inicial para o spawn (empurrada cedo, antes das demais)
    const startPlat = {x: 45, y: H-292, w: 16, h: 10, cloud: true};
    platforms.push(startPlat);
    PF.startPlat = startPlat;

    // degraus
    const steps = [
      [220, H-160],[460, H-200],[720, H-230],[1000, H-255],[1300, H-265],[1600, H-250]
    ];
    // degraus desativados para manter apenas as nuvens com espaçamento uniforme de dois pulos
    void 0;
    // nuvens altas (fase encurtada; finais mais próximas entre si)
    (function genCloudsRandom(){
      // RNG por sessão (aleatório a cada reload), determinístico dentro da sessão
      const rng = (() => {
        const buf = new Uint32Array(1);
        (window.crypto || window.msCrypto).getRandomValues(buf);
        let s = buf[0] || (Date.now()|0);
        return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
      })();
      const baseY = H - 292;
      // Tamanho da fase aleatório por load
      const MIN_COUNT = 110, MAX_COUNT = 180;
      const count = MIN_COUNT + Math.floor(rng() * (MAX_COUNT - MIN_COUNT + 1));
      // Alcance de 2 pulos e gap de AR reduzido com jitter para ficar mais próximo e aleatório
      const t1 = (2*JUMP)/G;
      const t2 = (2*JUMP_AIR)/G;
      const maxHang = t1 + t2;
      const maxGap = MOVE * maxHang;
      // Gap base e jitter leve por plataforma
      const BASE_GAP = 16; // px (mais longo — mais difícil)
      const GAP_JITTER = 8; // variação +/-8 px (bem mais aleatório)
      const nextGap = () => {
        const j = Math.floor((rng()*2 - 1) * GAP_JITTER); // -2..+2
        return Math.max(0, BASE_GAP + j);
      };
      const sep = 10; // margem visual mínima (não interfere no gap)
      // Primeira nuvem: usa gap com jitter a partir da startPlat
      let x = startPlat.x + startPlat.w + nextGap();
      let y = baseY; // todas na mesma altura
      // lacunas especiais removidas: usaremos gap horizontal uniforme para todas as nuvens
      let lastX = x;
      // Limites verticais seguros para as nuvens (parkour):
      const minY = Math.max(80, baseY - 120); // mais alto (desnível maior)
      const maxY = Math.min(H - 120, baseY + 120); // mais baixo (desnível maior)
      let i = 0;
      while (i < count){
        // Escolhe um tipo de segmento: 0=reto, 1=escada up, 2=escada down, 3=onda
        const segType = Math.floor(rng()*4);
        const segLen = 4 + Math.floor(rng()*5); // 4..8 plataformas por segmento
        // Passo vertical por segmento
        let stepY = 0;
        if (segType === 1) stepY = -22;       // escada subindo (ainda mais íngreme)
        else if (segType === 2) stepY = 22;   // escada descendo (ainda mais íngreme)
        else if (segType === 3) stepY = (rng() < 0.5 ? -20 : 20); // onda com amplitude maior

        for (let k=0; k<segLen && i<count; k++, i++){
          // Dimensões estreitas (difícil) com leve variação periódica
          const w = (i % 3 === 0) ? 12 : ((i % 2 === 0) ? 14 : 16), h = 10;
          const cloud = { x, y, w, h, cloud: true };
          platforms.push(cloud);

          // Obstáculo tipo SPIKES sobre algumas plataformas (morte ao pousar)
          if (i > 3 && rng() < 0.12){
            const spikeH = 4; // mais baixo (mais fácil)
            platforms.push({ x: cloud.x, y: cloud.y - spikeH, w: cloud.w, h: spikeH, cloud: false, obstacle: true, type: 'spike' });
          }

          // Calcula gap para a próxima
          const gap = nextGap();
          PF.lastGap = gap;

          // Obstáculo tipo PILAR em alguns gaps (bloqueio/força salto alto)
          if (i > 4 && rng() < 0.10){
            const pillarW = 8 + Math.floor(rng()*5);       // 8..12 (mais estreito)
            const pillarH = 14 + Math.floor(rng()*15);     // 14..29 (mais baixo)
            const pillarX = x + w + Math.max(2, Math.floor((gap - pillarW)/2)); // centraliza no gap
            const pillarY = Math.max(minY, y - Math.floor(pillarH*0.7)); // menor altura efetiva (mais fácil)
            platforms.push({ x: pillarX, y: pillarY, w: pillarW, h: pillarH, cloud: false, obstacle: true, type: 'pillar' });
          }

          lastX = x + w; // borda direita da última plataforma
          // Próxima começa após a borda direita + gap com jitter leve
          x = x + w + gap;

          // Atualiza Y conforme o segmento, com clamp para limites seguros
          if (segType === 3){
            // onda: alterna a direção a cada passo
            y += stepY;
            stepY = -stepY;
          } else {
            y += stepY;
          }
          if (y < minY) y = minY; else if (y > maxY) y = maxY;
        }
        // Entre segmentos, puxa levemente de volta para a faixa central
        if (y < baseY - 20) y += 10; else if (y > baseY + 20) y -= 10;
      }
      PF.lastCloudX = lastX;
      PF.gapBase = 10; // referência de gap base
    })();

    // plataformas móveis (mais exigentes, mas justas)
    void 0;

    for (const p of platforms){
      if (!p.move) continue;
      if (p.move.axis === 'x'){
        let minX = (p.move.origX ?? p.x) - p.move.amp;
        let maxX = (p.move.origX ?? p.x) + p.move.amp;
        for (const q of platforms){
          if (q === p) continue;
          const overlapY = !(p.y + p.h <= q.y || p.y >= q.y + q.h);
          if (!overlapY) continue;
          // aplica margem de separação contra qualquer plataforma (fixa ou móvel)
          if (q.x + q.w <= p.x){
            if (q.x + q.w + 6 > minX) minX = q.x + q.w + 6;
          } else if (q.x >= p.x + p.w){
            if (q.x - p.w - 6 < maxX) maxX = q.x - p.w - 6;
          }
        }
        if (maxX < minX){ const cx = (minX + maxX)/2; minX = cx; maxX = cx; }
        p.move.minX = minX; p.move.maxX = maxX;
      } else if (p.move.axis === 'y'){
        let minY = (p.move.origY ?? p.y) - p.move.amp;
        let maxY = (p.move.origY ?? p.y) + p.move.amp;
        for (const q of platforms){
          if (q === p) continue;
          const overlapX = !(p.x + p.w <= q.x || p.x >= q.x + q.w);
          if (!overlapX) continue;
          // aplica margem de separação contra qualquer plataforma (fixa ou móvel)
          if (q.y + q.h <= p.y){
            if (q.y + q.h + 6 > minY) minY = q.y + q.h + 6;
          } else if (q.y >= p.y + p.h){
            if (q.y - p.h - 6 < maxY) maxY = q.y - p.h - 6;
          }
        }
        if (maxY < minY){ const cy = (minY + maxY)/2; minY = cy; maxY = cy; }
        p.move.minY = minY; p.move.maxY = maxY;
      }
    }

    // Verificação (não move): apenas recalcula PF.lastCloudX e confere separação
    (function verifySeparation(){
      const SEP = 18;
      let ok = true;
      for (let i=0;i<platforms.length;i++){
        const p = platforms[i]; if (!p || !p.cloud) continue;
        for (let j=0;j<i;j++){
          const q = platforms[j]; if (!q || !q.cloud) continue;
          const overlapY = !(p.y + p.h <= q.y - SEP || p.y >= q.y + q.h + SEP);
          if (!overlapY) continue;
          if (!(p.x >= q.x + q.w + SEP || q.x >= p.x + p.w + SEP)){
            ok = false; break;
          }
        }
        if (!ok) break;
      }
      let last = 0;
      for (const p of platforms){ if (p.cloud) last = Math.max(last, p.x + p.w); }
      PF.lastCloudX = last;
      // opcional: se quiser garantir correção automática, volte a habilitar a normalização acima
    })();

    // Player nasce sobre a plataforma inicial (topo CENTRAL da plataforma)
    const player = { x: 80, y: H-300, w: 28, h: 36, vx:0, vy:0, onGround:false };
    function settleOnTop(p){
      player.x = p.x + (p.w/2) - (player.w/2);
      player.y = p.y - player.h;
      player.vx = 0; player.vy = 0; player.onGround = true;
    }
    PF.minX = player.x; // não pode voltar atrás deste ponto
    PF.cameraX = Math.max(0, player.x - W*0.4);

    // Garantia adicional: antes do loop, faça uma checagem rápida para ajustar ao topo caso haja qualquer interseção residual
    (function preSolve(){
      for (const p of platforms){
        if (p.cloud && rectsOverlap(player.x, player.y, player.w, player.h, p.x, p.y, p.w, p.h)){
          settleOnTop(p);
          break;
        }
      }
    })();

    // Pacotes coletáveis: geração simples e estável (corrige contagem)
    const packages = [];
    const platForItems = platforms.filter(p => p.cloud);
    const maxItems = Math.min(14, platForItems.length);
    for (let i = 0; i < maxItems; i++){
      const p = platForItems[Math.floor(i * (platForItems.length / maxItems))];
      const lead = 0.75 + 0.1*Math.random();
      const px = p.x + p.w*Math.min(0.9, lead);
      const py = p.y - (i % 2 === 0 ? 24 : 22);
      packages.push({ x: px, y: py, r: 7, taken: false, bobPhase: Math.random()*Math.PI*2 });
    }
    PF.collected = 0; if (el.collected) el.collected.textContent = '0';
    PF.goal = packages.length; if (el.goal) el.goal.textContent = PF.goal.toString();

    // Power-up removido: duplo pulo disponível desde o início
    const djPower = null;

    // Estrelas para cenário de fundo (com fase para cintilar)
    const stars = Array.from({length: 70}, () => ({ x: Math.random()*W*3, y: Math.random()*H*0.5, r: Math.random()*1.6+0.4, ph: Math.random()*Math.PI*2 }));

    // Ponto de chegada (bandeira) — ajustado para a nova cauda
    const lastPlatX = (PF.lastCloudX ?? 6000); // última nuvem/mover (aleatório)
    PF.finishX = lastPlatX + (PF.lastGap ?? 10);
    // Loop principal
    let last = performance.now();
    function frame(now){
      if (!PF.running) return;
      let dt = (now - last)/1000; last = now; if (dt>DT_MAX) dt=DT_MAX;
      update(dt);
      draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    function update(dt){
      // Atualiza parallax de fundo
      PF.bgOff[0] = (PF.bgOff[0] + 10*dt) % (W*2);
      PF.bgOff[1] = (PF.bgOff[1] + 25*dt) % (W*2);
      PF.bgOff[2] = (PF.bgOff[2] + 50*dt) % (W*2);

      // tempo global e invulnerabilidade de spawn
      PF.time += dt;
      if (PF.spawnGrace > 0) PF.spawnGrace = Math.max(0, PF.spawnGrace - dt);
      if (PF.spawnLock > 0) PF.spawnLock = Math.max(0, PF.spawnLock - dt);
      // cronômetro de fase (60s)
      if (PF.mode === 'alive'){
        PF.timeLeft = Math.max(0, PF.timeLeft - dt);
        if (PF.timeLeft <= 0){
          setDialog('Tempo esgotado!');
          triggerDie();
        }
      }
      // VFX especial decaindo
      if (PF.specialFx > 0) PF.specialFx = Math.max(0, PF.specialFx - dt);

      // atualiza plataformas com movimento e calcula delta de movimento
      for (const p of platforms){
        p.prevX = p.prevX ?? p.x; p.prevY = p.prevY ?? p.y;
        if (p.move && p.move.type === 'sine'){
          p.prevX = p.x; p.prevY = p.y;
          const SEP = 6; // margem para não encostar
          if (p.move.axis === 'x'){
            const min = (p.move.minX ?? (p.move.origX - p.move.amp));
            const max = (p.move.maxX ?? (p.move.origX + p.move.amp));
            const c = (min + max) * 0.5;
            const span = Math.max(0, (max - min) * 0.5);
            let nx = c + Math.sin(PF.time * p.move.speed) * span;
            // clamp dinâmico contra qualquer outra plataforma (fixa ou móvel)
            for (const q of platforms){
              if (q === p) continue;
              const overlapY = !((p.y + p.h) <= q.y || p.y >= (q.y + q.h));
              if (!overlapY) continue;
              // verifica se ao mover para nx tocaria/ultrapassaria q
              if (nx < q.x && nx + p.w > q.x - SEP) nx = q.x - SEP - p.w;
              else if (nx > q.x && nx < q.x + q.w + SEP) nx = q.x + q.w + SEP;
            }
            // respeita limites globais também
            nx = Math.max(min, Math.min(max, nx));
            p.x = nx;
          } else if (p.move.axis === 'y'){
            const min = (p.move.minY ?? (p.move.origY - p.move.amp));
            const max = (p.move.maxY ?? (p.move.origY + p.move.amp));
            const c = (min + max) * 0.5;
            const span = Math.max(0, (max - min) * 0.5);
            let ny = c + Math.sin(PF.time * p.move.speed) * span;
            // clamp dinâmico contra qualquer outra plataforma (fixa ou móvel)
            for (const q of platforms){
              if (q === p) continue;
              const overlapX = !((p.x + p.w) <= q.x || p.x >= (q.x + q.w));
              if (!overlapX) continue;
              if (ny < q.y && ny + p.h > q.y - SEP) ny = q.y - SEP - p.h;
              else if (ny > q.y && ny < q.y + q.h + SEP) ny = q.y + q.h + SEP;
            }
            // respeita limites globais também
            ny = Math.max(min, Math.min(max, ny));
            p.y = ny;
          }
        }
        p.dx = (p.x - p.prevX) || 0; p.dy = (p.y - p.prevY) || 0;
      }
      // sem power-up para atualizar

      if (PF.mode === 'alive'){
        // Aplica carona da plataforma móvel (se estiver aterrissado)
        if (PF.groundPlat && PF.groundPlat.dx !== undefined && PF.groundPlat.dy !== undefined){
          player.x += PF.groundPlat.dx;
          player.y += PF.groundPlat.dy;
        }
        // Se ainda está no spawnLock, mantém preso no topo da plataforma inicial
        if (PF.spawnLock > 0 && PF.startPlat){
          player.x = PF.startPlat.x + (PF.startPlat.w/2) - (player.w/2);
          player.y = PF.startPlat.y - player.h;
          player.vx = 0; player.vy = 0; player.onGround = true;
        }

        // Movimento esquerda/direita
        const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        player.vx = dir * MOVE;

        // Coyote time e jump buffer
        if (player.onGround) coyote = COYOTE_TIME; else coyote = Math.max(0, coyote - dt);
        if (jumpBuffer > 0) jumpBuffer -= dt;
        if (jumpBuffer > 0){
          const canFirst = (player.onGround || coyote > 0);
          const baseMax = PF.hasDoubleJump ? 2 : 1; // total de saltos permitidos sem especial
          const allowed = (PF.specialReady && PF.specialUses > 0) ? 3 : baseMax;
          const canAerial = (!player.onGround && jumpsUsed < allowed);
          if (canFirst || canAerial){
            const nextCount = canFirst ? 1 : (jumpsUsed + 1);
            const isThird = (!canFirst && nextCount === 3);
            const impulse = canFirst ? JUMP : (isThird ? Math.max(JUMP_AIR-20, JUMP_AIR*0.9) : JUMP_AIR);
            player.vy = -impulse;
            player.onGround = false;
            PF.groundPlat = null; // deixa de estar preso a plataforma ao saltar
            coyote = 0; jumpBuffer = 0;
            jumpsUsed = nextCount;
            audio.beep();
            PF.animSx = 0.92; PF.animSy = 1.10; // stretch no salto
            // VFX para saltos aéreos e especial no terceiro
            if (!canFirst){
              for(let k=0;k<8;k++){
                const ang = Math.random()*Math.PI*2; const spd = 90 + Math.random()*110;
                PF.particles.push({ x: player.x+player.w/2, y: player.y+player.h/2, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd-60, life: 0.3+Math.random()*0.25, color:'#38f1ff', r:2, g:500 });
              }
            }
            if (isThird){
              PF.specialUses = Math.max(0, (PF.specialUses||0) - 1);
              if (PF.specialUses <= 0) PF.specialReady = false;
              PF.specialFx = 0.6;
              setScore(20);
              setDialog('Habilidade Forence: Salto triplo ativado!');
              // rajada de "dados" verdes
              for(let k=0;k<18;k++){
                const ang = Math.random()*Math.PI*2; const spd = 120 + Math.random()*160;
                PF.particles.push({ x: player.x+player.w/2, y: player.y+player.h/2, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd-80, life: 0.5+Math.random()*0.4, color:'#69f0ae', r:3, g:500 });
              }
            }
          }
        }

        // Física básica
        player.vy += G*dt;
        player.x += player.vx*dt;
        // sem travar retorno
        collide('x');
        const wasGround = player.onGround;
        player.y += player.vy*dt;
        collide('y');
        if (player.onGround && !wasGround){
          PF.animSx = 1.12; PF.animSy = 0.90; // squash ao pousar
        }
        // Coleta
        for (const p of packages){
          if (!p.taken && circleRectOverlap(p.x, p.y, p.r, player.x, player.y, player.w, player.h)){
            p.taken = true; PF.collected += 1; if (el.collected) el.collected.textContent = PF.collected.toString(); setScore(10); audio.ok();
            // desbloqueia especial ao atingir 7 (duas utilizações de salto triplo)
            if (!PF.specialUsed && PF.collected >= 7){
              PF.specialReady = true; PF.specialUses = 2; PF.specialUsed = true; // marca que já foi desbloqueado para não repetir
              setDialog('Especial pronta: salto triplo disponível (duas vezes)');
              for(let k=0;k<12;k++){
                const ang = Math.random()*Math.PI*2; const spd = 90 + Math.random()*130;
                PF.particles.push({ x: p.x, y: p.y, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd-50, life: 0.5+Math.random()*0.3, color:'#69f0ae', r:2, g:500 });
              }
            }
            // faíscas azuis ao coletar
            for(let k=0;k<10;k++){
              const ang = Math.random()*Math.PI*2;
              const spd = 100 + Math.random()*120;
              PF.particles.push({ x: p.x, y: p.y, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd-40, life: 0.4+Math.random()*0.3, color:'#38f1ff', r:2, g:500 });
            }
          }
        }
        // sem power-up: duplo pulo já liberado desde o início

        // Câmera segue em ambos os sentidos
        PF.cameraX = Math.max(0, player.x - W*0.4);

        // Vitória ao alcançar a bandeira de chegada
        if (player.x + player.w/2 >= PF.finishX) {
          win();
          PF.mode = 'dead'; // Impede movimento após vencer
          return;
        }

        // Queda fora da tela (ignora durante spawnGrace)
        if (player.y > H + 200 && PF.spawnGrace <= 0) {
          triggerDie();
          setDialog('Game Over! Recarregue a página para jogar novamente.');
        }
      } else if (PF.mode === 'dead'){
        // Apenas atualiza partículas, sem lógica de morte
        PF.particles.forEach(pt => { pt.vy += (pt.g||700)*dt; pt.x += pt.vx*dt; pt.y += pt.vy*dt; pt.life -= dt; });
        PF.particles = PF.particles.filter(pt => pt.life > 0);
      }

      // relaxa escala do player
      PF.animSx += (1 - PF.animSx) * Math.min(8*dt, 1);
      PF.animSy += (1 - PF.animSy) * Math.min(8*dt, 1);
    }

    function collide(axis){
      const SKIN = 0.01;
      for (const p of platforms){
        if (rectsOverlap(player.x, player.y, player.w, player.h, p.x, p.y, p.w, p.h)){
          if (axis==='x'){
            if (player.vx>0) player.x = p.x - player.w; else if (player.vx<0) player.x = p.x + p.w;
            player.vx = 0;
          } else {
            if (player.vy>0){ // caindo
              // Se tocar no chão (plataforma não-nuvem), morre (exceto durante spawnGrace)
              if (!p.cloud && PF.mode === 'alive' && PF.spawnGrace <= 0){
                player.y = p.y - player.h - SKIN; // garante alinhamento visual
                triggerDie();
                return;
              }
              player.y = p.y - player.h - SKIN; player.vy = 0; player.onGround = true; PF.groundPlat = p;
            } else if (player.vy<0){
              player.y = p.y + p.h; player.vy = 0; PF.groundPlat = null;
            }
          }
        }
      }
    }

    function triggerDie(){
      if (PF.mode !== 'alive') return;
      if (PF.spawnGrace > 0) return; // não morre durante a graça de spawn
      PF.mode = 'dead'; // Muda direto para 'dead' em vez de 'dying'
      audio.err();
      // cria partículas na posição do jogador
      PF.particles = [];
      const cx = player.x + player.w/2;
      const cy = player.y + player.h/2;
      for(let i=0;i<24;i++){
        const ang = Math.random()*Math.PI*2;
        const spd = 120 + Math.random()*200;
        PF.particles.push({ x: cx, y: cy, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd-100, life: 0.8+Math.random()*0.5 });
      }
    }

    function draw(){
      // Fundo gradiente
      ctx.clearRect(0,0,W,H);
      const g = ctx.createLinearGradient(0,0,0,H);
      g.addColorStop(0,'#0a1e28'); g.addColorStop(1,'#06131a');
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

      // HUD: cronômetro (superior esquerdo)
      ctx.save();
      ctx.fillStyle = '#aef1d1';
      ctx.font = '16px monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const t = Math.ceil(PF.timeLeft);
      ctx.fillText(`Tempo: ${t}s`, 10, 8);
      ctx.restore();

      // Estrelas (camada distante) com cintilação
      stars.forEach(s => {
        const sx = (s.x - PF.cameraX*0.15) % (W*3);
        const sy = s.y;
        const px = sx < 0 ? sx + W*3 : sx;
        const a = 0.35 + 0.35*Math.sin(PF.time*1.4 + s.ph);
        ctx.fillStyle = `rgba(174,241,209,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(px, sy, s.r, 0, Math.PI*2); ctx.fill();
      });

      // Montanhas ao fundo (silhuetas)
      drawMountains(0.12, '#07202a', H*0.82);
      drawMountains(0.18, '#092732', H*0.86);

      // Camadas de nuvens em parallax (cenário móvel)
      drawParallaxLayer(0.15, PF.bgOff[0], 'rgba(56,241,255,0.07)');
      drawParallaxLayer(0.35, PF.bgOff[1], 'rgba(56,241,255,0.10)');
      drawParallaxLayer(0.55, PF.bgOff[2], 'rgba(174,241,209,0.12)');

      ctx.save();
      ctx.translate(-PF.cameraX, 0);

      // Plataformas
      for(const p of platforms){
        if (p.obstacle){
          ctx.fillStyle = 'rgba(255, 64, 64, 0.75)'; // vermelho para obstáculos
          ctx.strokeStyle = '#a10000';
        } else {
          ctx.fillStyle = p.cloud ? 'rgba(104, 240, 174, 0.25)' : '#0b2530';
          ctx.strokeStyle = '#2d7a88';
        }
        roundRect(ctx, p.x, p.y, p.w, p.h, 6, true, true);
      }

      // Pacotes (chips de dados) com bobbing leve
      for(const pkg of packages){
        if (pkg.taken) continue;
        const w = 14, h = 10;
        const bob = Math.sin(PF.time*2 + (pkg.bobPhase||0)) * 3;
        const yy = pkg.y + bob;
        ctx.save();
        ctx.shadowColor = 'rgba(56,241,255,0.35)'; ctx.shadowBlur = 8;
        ctx.fillStyle = '#38f1ff'; ctx.strokeStyle = '#1e5865';
        roundRect(ctx, pkg.x - w/2, yy - h/2, w, h, 3, true, true);
        ctx.shadowBlur = 0; ctx.fillStyle = '#0a2a32';
        ctx.fillRect(pkg.x - 3, yy - 2, 2, 4);
        ctx.fillRect(pkg.x + 1, yy - 2, 2, 4);
        ctx.restore();
      }

      // sem power-up para desenhar

      // Bandeira de chegada
      ctx.save();
      ctx.translate(PF.finishX, 0);
      ctx.fillStyle = '#186373';
      ctx.fillRect(0, H-40-60, 6, 60); // mastro
      ctx.fillStyle = '#69f0ae';
      ctx.beginPath(); ctx.moveTo(6, H-40-60); ctx.lineTo(46, H-40-45); ctx.lineTo(6, H-40-30); ctx.closePath(); ctx.fill();
      ctx.restore();

      // Partículas (morte e faíscas de coleta)
      if (PF.mode !== 'alive' || PF.particles.length){
        PF.particles.forEach(pt => {
          ctx.globalAlpha = Math.max(0, pt.life);
          ctx.fillStyle = pt.color || '#ff6b6b';
          ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r||3, 0, Math.PI*2); ctx.fill();
        });
        ctx.globalAlpha = 1;
      }

      // Efeito visual do salto triplo (curto): linhas/"dados" próximos ao jogador
      if (PF.specialFx > 0){
        ctx.save();
        ctx.translate(-PF.cameraX, 0);
        const cx = player.x + player.w/2, cy = player.y + player.h/2;
        const alpha = Math.min(0.6, PF.specialFx+0.2);
        for (let i=0;i<10;i++){
          const ox = (Math.random()*40 - 20), oy = (Math.random()*30 - 15);
          ctx.strokeStyle = `rgba(105,240,174,${alpha})`;
          ctx.beginPath(); ctx.moveTo(cx+ox, cy+oy-6); ctx.lineTo(cx+ox, cy+oy+6); ctx.stroke();
          ctx.fillStyle = `rgba(56,241,255,${alpha})`;
          ctx.font = '10px monospace'; ctx.textAlign = 'center';
          ctx.fillText(Math.random()<0.5 ? '0' : '1', cx+ox, cy+oy-8);
        }
        ctx.restore();
      }

      // Jogador (cápsula) com animação de morte (fade/encolher) e squash/stretch
      let alpha = 1, scale = 1;
      if (PF.mode === 'dying'){
        alpha = Math.max(0, PF.deathTimer);
        scale = Math.max(0.4, PF.deathTimer);
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(player.x + player.w/2, player.y + player.h/2);
      ctx.scale(scale, scale);
      ctx.scale(PF.animSx, PF.animSy);
      ctx.translate(-player.w/2, -player.h/2);
      ctx.fillStyle = '#aef1d1';
      ctx.strokeStyle = '#186373';
      roundRect(ctx, 0, 0, player.w, player.h, 8, true, true);
      ctx.restore();

      ctx.restore();
    }

    function drawParallaxLayer(heightFrac, offset, color){
      const y = H*heightFrac;
      const cloudW = 160, cloudH = 40;
      ctx.fillStyle = color;
      for(let x=-cloudW*2; x<W+cloudW*2; x+=cloudW*1.2){
        const cx = x - (offset % (cloudW*1.2));
        roundedCloud(cx, y + Math.sin((cx+offset)*0.002)*10, cloudW, cloudH);
      }
    }
    function roundedCloud(x,y,w,h){
      ctx.beginPath();
      ctx.ellipse(x+w*0.3, y, h*0.6, h*0.45, 0, 0, Math.PI*2);
      ctx.ellipse(x+w*0.6, y-5, h*0.55, h*0.4, 0, 0, Math.PI*2);
      ctx.ellipse(x+w*0.8, y+2, h*0.5, h*0.35, 0, 0, Math.PI*2);
      ctx.ellipse(x+w*0.45, y+10, w*0.5, h*0.5, 0, 0, Math.PI*2);
      ctx.fill();
    }

    function drawMountains(parallax, color, baseY){
      const step = 180;
      ctx.fillStyle = color;
      ctx.beginPath();
      let startX = - (PF.cameraX * parallax) % (step*2) - step;
      for (let x = startX; x < W + step*2; x += step){
        const peakH = 60 + ((x/step)%3)*25;
        ctx.moveTo(x, baseY);
        ctx.lineTo(x + step*0.5, baseY - peakH);
        ctx.lineTo(x + step, baseY);
      }
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fill();
    }

    function win(){
      PF.running = false;
      PF.mode = 'dead';
      audio.ok();
      setDialog('Você ganhou! Sistema nas nuvens restaurado.');
      // Overlay de vitória
      const panel = document.createElement('div');
      panel.className = 'victory panel';
      panel.innerHTML = `
        <h1>Você ganhou! 🎉</h1>
        <div>Pontuação: <strong>${state.score}</strong></div>
        <div class="small">Forence: "Sistema nas nuvens estável. Ótimo trabalho!"</div>
        <div class="row">
          <button class="btn" id="restartBtn">Jogar novamente</button>
        </div>
      `;
      // Limpa e mostra overlay acima do canvas
      if (el.game){
        // evita múltiplos painéis
        [...el.game.querySelectorAll('.victory')].forEach(n=>n.remove());
        el.game.appendChild(panel);
      }
      const rb = panel.querySelector('#restartBtn');
      rb && rb.addEventListener('click', () => {
        // reinicia jogo
        if (el.boot) el.boot.style.display = 'none';
        if (el.canvas) el.canvas.style.display = 'block';
        // remove overlay
        panel.remove();
        startPlatformer();
      });
    }
    function lose(){
      PF.running = false;
      audio.err();
      setDialog('Queda detectada! Pressione R para reiniciar.');
    }
    function reset(){
      // Não faz mais nada, não permite reiniciar o jogo
      return;
      // Reinicia
      if (el.boot) el.boot.style.display = 'none';
      if (el.canvas) el.canvas.style.display = 'block';
      startPlatformer();
    }

    // Utilitários geométricos
    function rectsOverlap(ax,ay,aw,ah, bx,by,bw,bh){
      return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    }
    function circleRectOverlap(cx,cy,cr, rx,ry,rw,rh){
      const nx = Math.max(rx, Math.min(cx, rx+rw));
      const ny = Math.max(ry, Math.min(cy, ry+rh));
      const dx = cx - nx, dy = cy - ny; return dx*dx + dy*dy <= cr*cr;
    }
    function roundRect(ctx, x, y, w, h, r, fill, stroke){
      if (w < 2*r) r = w/2; if (h < 2*r) r = h/2;
      ctx.beginPath();
      ctx.moveTo(x+r, y);
      ctx.arcTo(x+w, y, x+w, y+h, r);
      ctx.arcTo(x+w, y+h, x, y+h, r);
      ctx.arcTo(x, y+h, x, y, r);
      ctx.arcTo(x, y, x+w, y, r);
      ctx.closePath();
      if (fill) ctx.fill(); if (stroke) ctx.stroke();
    }
  }
})();

