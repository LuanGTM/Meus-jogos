/**
 * game.js
 *
 * Visão geral (comentada em PT-BR):
 * - Este arquivo concentra TODA a lógica do mini‑game de batalha por turnos (UI, estados, IA, animações, diálogo e placar).
 * - Você pode ajustar dificuldades, danos e custos editando apenas o objeto CONFIG logo abaixo.
 * - Comentários explicam o “o quê” e principalmente o “porquê” de cada parte (balanceamento, feedback visual e UX).
 *
 * Conceitos rápidos:
 * - HP (vida) e EP (energia) definem quanto dano se aguenta e quantas ações fortes cabem por turno.
 * - Ataques variam por custo/precisão: alguns são baratos e certos (sustentação), outros caros e fortes (pico de dano).
 * - Cooldown existe para impedir spam de especiais e forçar decisões.
 * - IA considera risco, overkill (desperdício de dano), acurácia e conservação de EP para ficar menos previsível.
 * - Diálogo e placar deixam o loop de partida mais recompensador e claro.
 */

// CONFIG: parâmetros centrais do jogo (fácil de ajustar para calibrar a dificuldade)
const CONFIG = {
  // Atributos base do jogador (mais frágil, menos EP) — incentiva boa gestão e timing de ataques
  PLAYER: { maxHP: 180, maxEP: 45 },
  // Atributos base do inimigo (mais robusto, mais EP) — gera pressão no jogador
  ENEMY: { maxHP: 240, maxEP: 60 },
  // Ataques do jogador — formato: {name, dmg, epCost, type, critChance, hitChance (0-1), cooldown}
  ATTACKS: {
    basic1: { name: "Golpe Rápido", dmg: 12, epCost: 10, type: "physical", hitChance: 1, cooldown: 0 },
    basic2: { name: "Corte Seguro", dmg: 18, epCost: 16, type: "physical", hitChance: 1, cooldown: 0 },
    precision: { name: "Mira Precisa", dmg: 32, epCost: 22, type: "precision", hitChance: 0.8, cooldown: 0 },
    special: { name: "Explosão Máxima", dmg: 50, epCost: 30, type: "special", hitChance: 0.95, cooldown: 2 }
  },
  // EP_REGEN: regeneração “global” de EP para o jogador — mantém opções em turnos seguintes
  EP_REGEN: 5,
  // ENEMY_EP_REGEN: regeneração de EP do inimigo ao descansar — maior para pressionar e punir erros
  ENEMY_EP_REGEN: 8,
  CRIT: { chance: 0.15, multiplier: 1.5 },
  // DMG_MULT: multiplicadores gerais — deixar o inimigo levemente mais forte cria um “piso” de dificuldade
  DMG_MULT: { player: 0.9, enemy: 1.15 },
  // STRONG_HIT_PERC: quando o dano passa esse percentual do HP máx, aplica shake (impacto percebido)
  STRONG_HIT_PERC: 0.30,
  // Cooldowns e timing
  TURNS: { playerStarts: true },
  // UI / animações
  UI: { damagePopDuration: 700, flashDuration: 420, explosionDuration: 700 }, // tempos escolhidos para “sentir” os hits
  // IA likelihood tweaks
  AI: {
    specialThresholdEP: 18, // se tem >= isto, considera usar special mais cedo (pressão)
    precisionWhenPlayerLowHP: 35 // quando jogador está fraco, precisão ganha valor
  }
};

/* =============================
   Estado do jogo (mutável)
   - Mantém HP/EP, cooldowns, de quem é o turno, placar e flags de UI.
   - Alteramos somente via funções (playerAction, applyDamageTo, etc.) para manter consistência.
   ============================= */
const state = {
  player: { hp: CONFIG.PLAYER.maxHP, ep: CONFIG.PLAYER.maxEP, cooldowns: {} }, // HP/EP do jogador
  enemy: { hp: CONFIG.ENEMY.maxHP, ep: CONFIG.ENEMY.maxEP, cooldowns: {} },   // HP/EP do inimigo
  playerTurn: CONFIG.TURNS.playerStarts,
  inBattle: true,
  position: 0,            // posição no tabuleiro (avanço/recuo pós-batalha)
  dialogOpen: false,      // trava ações quando diálogo está aberto
  score: 0,               // placar da sessão (+1 vitória, -1 derrota)
  lastEnemyAction: null   // memória simples da última ação do inimigo (reduz repetição)
};

/* =============================
   Utilitários e helpers
   - Pequenas funções auxiliares de DOM/tempo/álgebra usadas em vários pontos.
   ============================= */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function randFloat() { return Math.random(); }
function nowMs() { return Date.now(); }
function el(q){ return document.querySelector(q); }
function els(q){ return Array.from(document.querySelectorAll(q)); }

// Player sprite animation (idle 1,2; ataque -> 3; dano -> 4; em seguida volta ao idle)
let __playerIdleFrames = ['player1.png','player2.png'];
let __playerIdleIdx = 0;
let __playerIdleTimer = null;
let __playerAttackTimer = null;
let __playerDamageTimer = null;

function __setPlayerSprite(src){
  const img = el('#player-sprite');
  if (!img) return;
  // evita writes desnecessários no src
  try {
    const current = img.getAttribute('src') || '';
    if (current === src) return;
  } catch(_){}
  img.setAttribute('src', src);
}

// Frases
const __phrases_player_start = [
  "Vou clonar esse HD agora e trabalhar na cópia — nunca mexa no original. — Curiosidade: imagens bit-a-bit preservam metadados e evitam alterar provas.",
  "Abro o sistema de arquivos em modo somente leitura; cada byte conta. — Curiosidade: montar em read-only evita timestamps serem sobrescritos.",
  "Raspo o MFT e procuro referências a arquivos apagados — os rastros ficam lá. — Curiosidade: o MFT muitas vezes contém nomes de arquivos mesmo após exclusão.",
  "Vou fazer carving nos setores suspeitos para recuperar arquivos fragmentados. — Curiosidade: carving encontra arquivos por assinatura, mesmo sem entradas no índice.",
  "Extraio metadados e versões anteriores dos documentos — a verdade tá nas propriedades. — Curiosidade: metadados podem revelar autor, data e software usado.",
  "Gerando hashes das evidências para provar que nada foi alterado. — Curiosidade: um hash diferente prova alteração; é prova de integridade.",
  "Vou montar uma timeline dos acessos e modificações — ordem é prova. — Curiosidade: correlacionar logs e timestamps reconstrói eventos.",
  "Busco logs e histórico de rede para ver com quem esse disco falava. — Curiosidade: conexões de rede podem indicar exfiltração de dados.",
  "Procurando por artefatos de malware e backdoors — não subestime arquivos pequenos. — Curiosidade: malware costuma se esconder com nomes inofensivos e timestamps alterados.",
  "Aplicando busca por palavras-chave e hashes suspeitos — cada termo pode ser a chave. — Curiosidade: palavras-chave bem escolhidas aceleram a identificação de provas.",
  "Conectando o disco à estação de perícia — qualquer ruído elétrico pode corromper dados. — Curiosidade: Peritos usam bloqueadores de escrita (write blockers) pra garantir que nada no HD seja alterado.",
  "Desmontando a carcaça e inspecionando os pratos — o inimigo pode estar gravado em um setor físico. — Curiosidade: Danos físicos em setores podem esconder dados remanescentes de partições antigas.",
  "Extraindo partições perdidas — mesmo o que foi 'formatado' deixa rastros. — Curiosidade: Uma formatação rápida só apaga o índice; os arquivos ainda estão no disco.",
  "Abrindo o registro do sistema — cada log guarda um pedaço da história do suspeito. — Curiosidade: O Windows Registry mostra programas usados, dispositivos conectados e horários de acesso.",
  "Montando imagem forense e validando com hash duplo — tudo documentado, nada improvisado. — Curiosidade: A cadeia de custódia exige que cada evidência tenha registro de quem manipulou e quando.",
  "Investigando arquivos temporários — o lixo digital costuma contar a verdade. — Curiosidade: Arquivos temporários e caches podem revelar documentos abertos e até trechos de mensagens.",
  "Extraindo histórico de navegação e cookies — o HD lembra o que o suspeito tentou esconder. — Curiosidade: Mesmo limpando o histórico, fragmentos de URLs e cookies podem ser recuperados.",
  "Rodando análise de strings no binário — às vezes, o culpado assina sem querer. — Curiosidade: Comandos e nomes embutidos em executáveis podem identificar autores de malware.",
  "Buscando arquivos com timestamp incoerente — o tempo mente, mas os bytes entregam. — Curiosidade: Timestamps adulterados são pista clássica de tentativa de encobrimento.",
  "Mapeando conexões USB — quero saber que pendrive foi usado aqui. — Curiosidade: Logs de dispositivos mostram quando e qual mídia externa foi conectada no sistema."
];
const __phrases_player_end = [
  "Arquivo crítico recuperado e autenticado. AVANCE 6 casas.",
  "Timeline completa: provamos a sequência dos crimes. AVANCE 6 casas.",
  "Hashes conferem — evidência íntegra para o tribunal. AVANCE 6 casas.",
  "Mensagens ocultas expostas; o caso tomou rumo. AVANCE 6 casas.",
  "Dados fragmentados reunidos; lacunas preenchidas. AVANCE 6 casas.",
  "Backdoor identificado e neutralizado — pista confirmada. AVANCE 6 casas.",
  "Metadados provaram autoria — prova documental consolidada. AVANCE 6 casas.",
  "Logs de rede revelaram o destino dos arquivos vazados. AVANCE 6 casas.",
  "Evidências preservadas e catalogadas — pronto para o próximo desafio. AVANCE 6 casas.",
  "Caso resolvido neste disco — partimos pra próxima missão. AVANCE 6 casas."
];
const __phrases_hdd_end = [
  "Você falhou. Meus segredos ficarão enterrados. Retroceda... Retroceda quatro casas.",
  "Não vai me desmontar — voltou ao início. Retroceda... Retroceda quatro casas.",
  "Tentativa inútil. Siga de volta, investigador. Retroceda... Retroceda quatro casas.",
  "Haha, achou que podia me decifrar? Errou. Retroceda... Retroceda quatro casas.",
  "Meus arquivos riem de você. Volte quatro passos. Retroceda... Retroceda quatro casas.",
  "As provas somem com seu fracasso. Retroceda. Retroceda... Retroceda quatro casas.",
  "Senha impenetrável. Regressa e tente de novo. Retroceda... Retroceda quatro casas.",
  "Corrompi os rastros — sua busca recomeça. Retroceda... Retroceda quatro casas.",
  "Seu exame foi superficial. Recue e analise outra vez. Retroceda... Retroceda quatro casas.",
  "O disco sussurra: você perdeu. Volte já. Retroceda... Retroceda quatro casas."
];

function __randPick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
// Pool embaralhado para reduzir repetição das frases de início
let __startPool = [];
function __shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function getNextStartPhrase(){
  if (!__startPool || __startPool.length === 0) {
    __startPool = __shuffle([...__phrases_player_start]);
  }
  return __startPool.pop();
}

function showDialogue(opts){
  const speaker = opts.speaker;
  let text = String(opts.text||'');
  const onClose = typeof opts.onClose === 'function' ? opts.onClose : function(){};
  const withBounce = !!opts.bounce;
  if (speaker === 'playerWin') {
    const adv = '+6';
    text = text.replace(/AVANÇO\s*_+/g, 'AVANÇO ' + adv);
  }
  state.dialogOpen = true;
  let overlay = document.getElementById('dialogue-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'dialogue-overlay';
  // posiciona dentro do campo de batalha, ocupando ponta a ponta
  const area = el('#battle-area');
  if (area && getComputedStyle(area).position === 'static') area.style.position = 'relative';
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.right = '0';
  overlay.style.bottom = '0';
  overlay.style.padding = '10px 12px';
  overlay.style.display = 'block';
  overlay.style.background = 'rgba(40,40,40,0.88)';
  overlay.style.zIndex = '9999';
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.gap = '18px';
  wrap.style.alignItems = 'center';
  wrap.style.width = '100%';
  wrap.style.boxSizing = 'border-box';
  const img = document.createElement('img');
  img.style.width = '220px';
  img.style.height = '220px';
  img.style.objectFit = 'contain';
  img.style.filter = 'drop-shadow(0 6px 10px rgba(0,0,0,0.35))';
  img.src = speaker === 'hdd' ? 'hdd5.png' : 'player5.png';
  if (speaker === 'hdd') {
    img.onerror = () => { img.onerror = null; img.src = 'hdd1.png'; };
  }
  const box = document.createElement('div');
  box.style.flex = '1';
  box.style.background = '#1a1a1a';
  box.style.color = '#f0f0f0';
  box.style.border = '2px solid #444';
  box.style.borderRadius = '10px';
  box.style.padding = '18px 20px';
  box.style.minHeight = '110px';
  box.style.font = '600 22px/1.6 system-ui, -apple-system, Segoe UI, Roboto, Arial';
  box.style.position = 'relative';
  const txt = document.createElement('div');
  const tap = document.createElement('div');
  tap.textContent = 'Clique para avançar';
  tap.style.position = 'absolute';
  tap.style.right = '10px';
  tap.style.bottom = '6px';
  tap.style.fontSize = '14px';
  tap.style.opacity = '0.7';
  box.appendChild(txt);
  box.appendChild(tap);
  wrap.appendChild(img);
  wrap.appendChild(box);
  overlay.appendChild(wrap);
  if (area) area.appendChild(overlay); else document.body.appendChild(overlay);
  let i = 0;
  let typing = true;
  const speed = 14;
  let typer;
  function finish(){
    if (!overlay.parentNode) return;
    overlay.remove();
    state.dialogOpen = false;
    onClose();
  }
  function startType(){
    typing = true;
    txt.textContent = '';
    typer = setInterval(() => {
      if (i >= text.length){
        clearInterval(typer); typing = false; return;
      }
      txt.textContent += text[i++];
    }, speed);
  }
  let bounceInt = null;
  if (withBounce){
    let up = true;
    bounceInt = setInterval(()=>{
      img.style.transform = up ? 'translateY(-6px)' : 'translateY(0)';
      up = !up;
    }, 280);
  }
  startType();
  overlay.addEventListener('click', () => {
    if (typing){
      clearInterval(typer); typing = false; txt.textContent = text; return;
    }
    if (bounceInt) { clearInterval(bounceInt); bounceInt = null; }
    finish();
  });
}

function startPlayerIdleAnim(){
  if (__playerIdleTimer) clearInterval(__playerIdleTimer);
  // garante início em player1
  __playerIdleIdx = 0;
  __setPlayerSprite(__playerIdleFrames[__playerIdleIdx]);
  __playerIdleTimer = setInterval(() => {
    __playerIdleIdx = (__playerIdleIdx + 1) % __playerIdleFrames.length;
    __setPlayerSprite(__playerIdleFrames[__playerIdleIdx]);
  }, 360);
}

function showPlayerAttackSpriteOnce(durationMs = 360){
  if (__playerIdleTimer) { clearInterval(__playerIdleTimer); __playerIdleTimer = null; }
  if (__playerAttackTimer) { clearTimeout(__playerAttackTimer); __playerAttackTimer = null; }
  if (__playerDamageTimer) { clearTimeout(__playerDamageTimer); __playerDamageTimer = null; }
  __setPlayerSprite('player3.png');
  __playerAttackTimer = setTimeout(() => {
    startPlayerIdleAnim();
  }, durationMs);
}

function showPlayerDamagedSpriteOnce(durationMs = 420){
  if (__playerIdleTimer) { clearInterval(__playerIdleTimer); __playerIdleTimer = null; }
  if (__playerAttackTimer) { clearTimeout(__playerAttackTimer); __playerAttackTimer = null; }
  if (__playerDamageTimer) { clearTimeout(__playerDamageTimer); __playerDamageTimer = null; }
  __setPlayerSprite('player4.png');
  __playerDamageTimer = setTimeout(() => {
    startPlayerIdleAnim();
  }, durationMs);
}

// HDD (inimigo) — idle alternando 1/2, ataque -> 3, dano -> 4; sempre retorna ao idle
let __hddIdleFrames = ['hdd1.png','hdd2.png'];
let __hddIdleIdx = 0;
let __hddIdleTimer = null;
let __hddAttackTimer = null;
let __hddDamageTimer = null;

function __setHDDSprite(src){
  const img = el('#hdd-sprite');
  if (!img) return;
  try {
    const current = img.getAttribute('src') || '';
    if (current === src) return;
  } catch(_){}
  img.setAttribute('src', src);
}

function startHDDIdleAnim(){
  if (__hddIdleTimer) clearInterval(__hddIdleTimer);
  __hddIdleIdx = 0;
  __setHDDSprite(__hddIdleFrames[__hddIdleIdx]);
  __hddIdleTimer = setInterval(() => {
    __hddIdleIdx = (__hddIdleIdx + 1) % __hddIdleFrames.length;
    __setHDDSprite(__hddIdleFrames[__hddIdleIdx]);
  }, 360);
}

function showHDDAttackSpriteOnce(durationMs = 360){
  if (__hddIdleTimer) { clearInterval(__hddIdleTimer); __hddIdleTimer = null; }
  if (__hddAttackTimer) { clearTimeout(__hddAttackTimer); __hddAttackTimer = null; }
  if (__hddDamageTimer) { clearTimeout(__hddDamageTimer); __hddDamageTimer = null; }
  __setHDDSprite('hdd3.png');
  __hddAttackTimer = setTimeout(() => {
    startHDDIdleAnim();
  }, durationMs);
}

function showHDDDamagedSpriteOnce(durationMs = 420){
  if (__hddIdleTimer) { clearInterval(__hddIdleTimer); __hddIdleTimer = null; }
  if (__hddAttackTimer) { clearTimeout(__hddAttackTimer); __hddAttackTimer = null; }
  if (__hddDamageTimer) { clearTimeout(__hddDamageTimer); __hddDamageTimer = null; }
  __setHDDSprite('hdd4.png');
  __hddDamageTimer = setTimeout(() => {
    startHDDIdleAnim();
  }, durationMs);
}

// Move existing HP/EP bars to top corners without changing their style/size
function moveBarsToTopCorners(){
  const root = el('#battle-area');
  const pBars = el('#player-area .bars');
  const eBars = el('#enemy-area .bars');
  if (root && pBars && !root.contains(pBars)) { pBars.classList.add('hud-left'); root.appendChild(pBars); }
  if (root && eBars && !root.contains(eBars)) { eBars.classList.add('hud-right'); root.appendChild(eBars); }
}

// Sons simples (WebAudio) — feedback auditivo leve sem assets externos
let __ac; function ac(){ try{ return (__ac ||= new (window.AudioContext||window.webkitAudioContext)()); }catch(e){ return null; } }
function beep({freq=220, dur=0.1, type='square', vol=0.12, sweepTo=null}){
  const ctx = ac(); if(!ctx) return; try{
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20,sweepTo), ctx.currentTime + dur);
    o.start(); o.stop(ctx.currentTime + dur);
  }catch(e){}
}
function playImpact(){ beep({freq:150, dur:0.09, type:'square', vol:0.18, sweepTo:95}); }
function playWhoosh(){ beep({freq:420, dur:0.12, type:'sine', vol:0.12, sweepTo:240}); }
function playUltimate(){ beep({freq:220, dur:0.22, type:'sawtooth', vol:0.2, sweepTo:110}); setTimeout(()=>beep({freq:90, dur:0.14, type:'square', vol:0.16}),120); }
function playError(){ beep({freq:320, dur:0.12, type:'triangle', vol:0.12}); setTimeout(()=>beep({freq:180, dur:0.1, type:'triangle', vol:0.1}),80); }

function btnForAction(key){
  if (key==='basic1') return el('#btn-basic1');
  if (key==='basic2') return el('#btn-basic2');
  if (key==='precision') return el('#btn-precision');
  if (key==='special') return el('#btn-special');
  return null;
}

/* =============================
   Inicialização do DOM
   - Faz o bind dos botões, render inicial, move HUD e inicia animações/diálogo.
   ============================= */
document.addEventListener('DOMContentLoaded', () => {
  bindUI();
  renderAll();
  writeLog("Batalha iniciada. É seu turno!");
  updateConfigPreview();
  moveBarsToTopCorners();
  // iniciar animação de idle do player (1,2,1,2,...)
  startPlayerIdleAnim();
  // iniciar animação de idle do HDD (hdd1,hdd2,...)
  startHDDIdleAnim();
  showDialogue({ speaker: 'player', text: getNextStartPhrase() });
});

/* =============================
   Bindings de UI (botões, teclado)
   - O grid de ações mapeia cliques para ações.
   - Teclado segue mapeamentos 1..4 para ataques (pode ser ajustado se necessário).
   ============================= */
function bindUI(){
  el('#actions-grid').addEventListener('click', e => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'rest') { playerRest(); return; }
    playerAction(action);
  });

  const restBtn = el('#btn-rest');
  if (restBtn) restBtn.addEventListener('click', () => playerRest());
  el('#btn-restart').addEventListener('click', () => resetBattle());
  el('#result-ok').addEventListener('click', () => closeResultModal());
  el('#open-settings').addEventListener('click', () => openSettings());
  el('#close-settings').addEventListener('click', () => closeSettings());

  // keyboard support
  window.addEventListener('keydown', (ev) => {
    if (!state.inBattle) return;
    if (ev.key === '1') playerAction('basic1');
    if (ev.key === '2') playerAction('basic2');
    if (ev.key === '3') playerAction('precision');
    if (ev.key === '4') playerAction('special');
    if (ev.code === 'Space') { ev.preventDefault(); playerRest(); }
    if (ev.key.toLowerCase() === 'r') resetBattle();
  });

  // touch-friendly: already buttons are big; nothing extra needed.
}

/* =============================
   Renderização / Atualizações de DOM
   - Atualiza barras, cooldowns e indicador de turno.
   ============================= */
function renderAll(){
  renderBars();
  renderCooldowns();
  renderPosition();
  // update round indicator
  el('#round-indicator').textContent = state.playerTurn ? "Turno: Jogador" : "Turno: Inimigo";
}

function renderBars(){
  // Player
  const p = state.player;
  el('#player-hp-text').textContent = `${p.hp} / ${CONFIG.PLAYER.maxHP}`;
  el('#player-ep-text').textContent = `${p.ep} / ${CONFIG.PLAYER.maxEP}`;
  el('#player-hp-fill').style.width = `${(p.hp/CONFIG.PLAYER.maxHP)*100}%`;
  el('#player-ep-fill').style.width = `${(p.ep/CONFIG.PLAYER.maxEP)*100}%`;
  // Enemy
  const e = state.enemy;
  el('#enemy-hp-text').textContent = `${e.hp} / ${CONFIG.ENEMY.maxHP}`;
  el('#enemy-ep-text').textContent = `${e.ep} / ${CONFIG.ENEMY.maxEP}`;
  el('#enemy-hp-fill').style.width = `${(e.hp/CONFIG.ENEMY.maxHP)*100}%`;
  el('#enemy-ep-fill').style.width = `${(e.ep/CONFIG.ENEMY.maxEP)*100}%`;
}

function renderCooldowns(){
  // Update only the sublabel to keep image and label intact
  const specialBtn = el('#btn-special');
  if (!specialBtn) return;
  const sub = specialBtn.querySelector('.sub');
  const cd = state.player.cooldowns.special || 0;
  if (cd > 0) {
    if (sub) sub.textContent = `(${cd} turnos)`;
    specialBtn.classList.add('disabled');
    specialBtn.disabled = true;
  } else {
    if (sub) sub.textContent = `EP: ${CONFIG.ATTACKS.special.epCost} — cooldown (2)`;
    specialBtn.classList.remove('disabled');
    specialBtn.disabled = false;
  }
}

function renderPosition(){
  el('#position-value').textContent = String(state.position);
}

/* =============================
   Log de combate
   - Pequeno feed textual para clareza do que aconteceu (erros, dano, etc.).
   ============================= */
function writeLog(txt){
  const container = el('#log-entries');
  const entry = document.createElement('div');
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${txt}`;
  container.prepend(entry);
  // keep log length reasonable
  while (container.childNodes.length > 80) container.removeChild(container.lastChild);
}

/* =============================
   Ações do Jogador
   - Verifica EP/cooldown, anima sprite de ataque, calcula dano+crítico e aplica.
   - Usa efeitos visuais (golpe/estrela/explosão) para dar impacto.
   ============================= */
function playerAction(actionKey){
  if (state.dialogOpen) return;
  if (!state.playerTurn || !state.inBattle) return;
  if (!CONFIG.ATTACKS[actionKey]) return;
  const atk = CONFIG.ATTACKS[actionKey];

  // Check EP
  if (state.player.ep < atk.epCost) {
    writeLog(`EP insuficiente para ${atk.name}. Use Descansar.`);
    flashElement(el(`#player-area`));
    // EP error feedback
    playError();
    const b = btnForAction(actionKey);
    if (b) { b.classList.add('btn-flash-red'); setTimeout(()=> b.classList.remove('btn-flash-red'), 420); }
    return;
  }

  // Check cooldown for special
  if (atk.cooldown && (state.player.cooldowns[actionKey] || 0) > 0) {
    writeLog(`${atk.name} em cooldown (${state.player.cooldowns[actionKey]} turnos restantes).`);
    return;
  }

  // Consume EP
  state.player.ep = clamp(state.player.ep - atk.epCost, 0, CONFIG.PLAYER.maxEP);

  // Troca sprite para animação de ataque (player3) e retorna ao idle depois
  const atkSpriteDur = actionKey === 'special' ? 420 : (actionKey === 'precision' ? 360 : 320);
  showPlayerAttackSpriteOnce(atkSpriteDur);

  // Resolve hit chance
  if (randFloat() > (atk.hitChance ?? 1)) {
    // Miss
    writeLog(`Você usou ${atk.name} — errou!`);
    showFloatingText(el('#enemy-damage-pop'), 'MISS', 'large', 1500);
    playWhoosh();
    addAnimClass(el('#enemy-area .sprite-wrap'), 'dodge-right', 220);
    // proceed to enemy turn after small delay
    finishPlayerTurn();
    renderAll();
    return;
  }

  // attacker animation (player) por tipo de ataque
  const playerSprite = el('#player-area .sprite-wrap');
  if (actionKey === 'basic1') { addAnimClass(playerSprite, 'anim-basic1-right', 260); addAnimClass(playerSprite, 'attack-glow-physical', 260); }
  else if (actionKey === 'basic2') { addAnimClass(playerSprite, 'anim-basic2-right', 280); addAnimClass(playerSprite, 'attack-glow-physical', 280); }
  else if (actionKey === 'precision') { addAnimClass(playerSprite, 'anim-precision-right', 300); addAnimClass(playerSprite, 'attack-glow-precision', 300); }
  else if (actionKey === 'special') addAnimClass(playerSprite, 'anim-special-right', 340);

  // Damage calculation + crítico
  const variance = 0.85 + Math.random() * 0.3; // 0.85–1.15
  let damage = Math.max(1, Math.round(atk.dmg * variance * (CONFIG.DMG_MULT?.player ?? 1)));
  const isCrit = randFloat() < (CONFIG.CRIT?.chance ?? 0);
  if (isCrit) damage = Math.max(1, Math.round(damage * (CONFIG.CRIT?.multiplier ?? 1.5)));

  applyDamageTo('enemy', damage, isCrit ? { ...atk, _crit: true } : atk);

  // Strike effect for non-special hits (colors vary)
  if (atk.type !== 'special') {
    const color = actionKey === 'basic1'
      ? 'linear-gradient(90deg, rgba(255,230,120,0.95), rgba(255,180,40,0.85))'
      : actionKey === 'basic2'
      ? 'linear-gradient(90deg, rgba(255,120,120,0.95), rgba(255,60,60,0.85))'
      : 'linear-gradient(90deg, rgba(180,240,255,0.95), rgba(120,200,255,0.85))';
    createStrikeAt('#hdd-sprite', color);
  }

  writeLog(`Você usou ${atk.name} e causou ${damage} de dano${isCrit ? ' (Crítico!)' : ''}.`);

  // apply cooldowns if attack has cooldown
  if (atk.cooldown) state.player.cooldowns[actionKey] = atk.cooldown;

  // Special animation
  if (atk.type === 'special') { playUltimate(); createExplosionAt('#hdd-sprite'); }

  renderAll();

  // Check end battle
  if (state.enemy.hp <= 0) {
    endBattle(true);
    return;
  }

  // finish player's turn
  finishPlayerTurn();
}

/* Descansar / recuperar EP — mantém o jogador vivo em cenários de baixo EP */
function playerRest(){
  if (state.dialogOpen) return;
  if (!state.playerTurn || !state.inBattle) return;
  state.player.ep = clamp(state.player.ep + CONFIG.EP_REGEN, 0, CONFIG.PLAYER.maxEP);
  writeLog(`Você descansou e recuperou ${CONFIG.EP_REGEN} EP.`);
  renderAll();
  finishPlayerTurn();
}

/* =============================
   Fim do turno do jogador -> turno do inimigo
   - Regenera EP do jogador, reduz cooldowns e chama a IA após pequeno atraso.
   ============================= */
function finishPlayerTurn(){
  // Regenerate EP at end of player's turn (per spec)
  state.player.ep = clamp(state.player.ep + CONFIG.EP_REGEN, 0, CONFIG.PLAYER.maxEP);

  // reduce cooldowns for player
  for (const k of Object.keys(state.player.cooldowns)) {
    state.player.cooldowns[k] = Math.max(0, state.player.cooldowns[k] - 1);
    if (state.player.cooldowns[k] === 0) delete state.player.cooldowns[k];
  }

  // switch turn
  state.playerTurn = false;
  renderAll();

  // small delay to mimic thinking
  setTimeout(() => {
    enemyTakeTurn();
  }, 600);
}

/* =============================
   IA do Inimigo
   - Avalia ataques disponíveis por dano esperado, risco (overkill/precisão), conservação de EP e chance de KO.
   - Pode optar por descansar se atacar “não pagar”. Evita repetição de golpes.
   ============================= */
function enemyTakeTurn(){
  if (!state.inBattle) return;
  // Simple AI decision:
  const e = state.enemy;
  const p = state.player;

  // Determine available attacks
  const available = ['special','precision','basic2','basic1'].filter(k => {
    const a = CONFIG.ATTACKS[k];
    if (!a) return false;
    if (e.ep < a.epCost) return false;
    if (a.cooldown && e.cooldowns && (e.cooldowns[k]||0) > 0) return false;
    return true;
  });

  if (available.length === 0) {
    // enemy rests
    e.ep = clamp(e.ep + (CONFIG.ENEMY_EP_REGEN || CONFIG.EP_REGEN), 0, CONFIG.ENEMY.maxEP);
    writeLog(`Inimigo descansou e recuperou ${CONFIG.EP_REGEN} EP.`);
    // reduce enemy cooldowns
    if (e.cooldowns) {
      for (const k of Object.keys(e.cooldowns)) {
        e.cooldowns[k] = Math.max(0, e.cooldowns[k] - 1);
        if (e.cooldowns[k] === 0) delete e.cooldowns[k];
      }
    }
    state.playerTurn = true;
    renderAll();
    writeLog("Seu turno.");
    return;
  }

  // Score each available attack with smarter heuristics + simple risk assessment
  const playerHpPerc = (p.hp / CONFIG.PLAYER.maxHP) * 100;
  // estimate player's best expected damage next turn (affordable now)
  const playerAffordable = Object.values(CONFIG.ATTACKS).filter(a => state.player.ep >= a.epCost);
  let playerExpMax = 0;
  for (const a of playerAffordable) {
    const hit = Math.max(0.05, (a.hitChance ?? 1));
    const base = a.dmg * (CONFIG.DMG_MULT?.player ?? 1);
    playerExpMax = Math.max(playerExpMax, base * hit);
  }
  let pick = available[0];
  let bestScore = -Infinity;
  // detect if a cheaper KO option exists to avoid wasting special
  let cheaperKoEp = Infinity;
  for (const k of available) {
    const a = CONFIG.ATTACKS[k];
    const base = a.dmg * (CONFIG.DMG_MULT.enemy || 1);
    if (base >= p.hp * 0.92) cheaperKoEp = Math.min(cheaperKoEp, a.epCost);
  }
  const enemyAtRisk = playerExpMax >= e.hp * 0.8; // se o jogador pode tirar ~80% do nosso HP
  for (const k of available) {
    const a = CONFIG.ATTACKS[k];
    // weight low hit chances more severely
    const hit = Math.max(0.05, (a.hitChance ?? 1));
    const hitWeight = hit * hit; // non-linear penalty for low accuracy
    const base = a.dmg * (CONFIG.DMG_MULT.enemy || 1);
    // expected damage
    let exp = base * hitWeight;
    // overkill penalty: não desperdiçar muito dano além do HP atual
    const overkillFactor = Math.min(1, (p.hp * 1.1) / Math.max(1, base));
    exp *= overkillFactor;
    // preferências situacionais
    if (a.type === 'special') exp *= 1.06; // leve preferência
    if (playerHpPerc <= (CONFIG.AI.precisionWhenPlayerLowHP||35) && a.type === 'precision') exp *= 1.08;
    // finisher (quase certeza de KO)
    const couldKO = base >= p.hp * 0.92;
    if (couldKO) exp *= 1.2;
    // conservação de EP: penaliza gastos que deixem EP muito baixo sem garantir KO
    const epAfter = e.ep - a.epCost;
    if (epAfter < 10 && !couldKO) exp *= 0.86;
    if (a.type === 'special' && epAfter < 15 && !couldKO) exp *= 0.9;
    // custo/benefício: leve penalidade por EP gasto + bônus por conservar EP para próximo turno
    exp -= a.epCost * 0.22;
    const conserve = Math.max(0, epAfter - 14) * 0.35; // valorizar ficar >=15 EP
    exp += conserve;
    // eficiência por EP (especialmente quando EP está baixo)
    const dpe = exp / Math.max(1, a.epCost);
    exp += dpe * (e.ep < 20 ? 6 : 3);
    // se há KO mais barato, desestimular gastar SPECIAL
    if (couldKO && a.type === 'special' && cheaperKoEp < a.epCost) exp *= 0.88;
    // evitar repetição do mesmo golpe seguidamente (a menos que finalize)
    if (!couldKO && k === (state.lastEnemyAction||null)) exp *= 0.92;
    // risco: se deixarmos EP muito baixo e o jogador tem alto potencial de dano, penalizar
    const risky = epAfter < 8 && playerExpMax > (CONFIG.PLAYER.maxHP * 0.16);
    if (risky && !couldKO) exp *= 0.88;
    // se estamos sob risco de KO, priorizar mais dano imediato
    if (enemyAtRisk) exp *= 1.06;
    // pequeno ruído para evitar padrão
    exp *= (0.96 + Math.random()*0.08);
    if (exp > bestScore) { bestScore = exp; pick = k; }
  }

  // Caso os ataques não compensem, opte por descansar estrategicamente
  const shouldRest = (bestScore < 12 && e.ep < 22) || (e.ep < 9);
  if (shouldRest) pick = 'rest';

  // perform chosen attack or rest
  if (pick === 'rest') {
    e.ep = clamp(e.ep + (CONFIG.ENEMY_EP_REGEN || CONFIG.EP_REGEN), 0, CONFIG.ENEMY.maxEP);
    writeLog(`Inimigo descansou e recuperou ${CONFIG.EP_REGEN} EP.`);
    // reduce enemy cooldowns
    if (e.cooldowns) {
      for (const k of Object.keys(e.cooldowns)) {
        e.cooldowns[k] = Math.max(0, e.cooldowns[k] - 1);
        if (e.cooldowns[k] === 0) delete e.cooldowns[k];
      }
    }
    state.playerTurn = true;
    renderAll();
    writeLog("Seu turno.");
    return;
  }

  const atk = CONFIG.ATTACKS[pick];
  if (e.ep < atk.epCost) {
    // fallback: rest
    e.ep = clamp(e.ep + CONFIG.EP_REGEN, 0, CONFIG.ENEMY.maxEP);
    writeLog("Inimigo tentou atacar, mas não tinha EP. Recuperou EP ao invés disso.");
    state.playerTurn = true;
    renderAll();
    writeLog("Seu turno.");
    return;
  }

  // Deduct EP and possible cooldown
  e.ep = clamp(e.ep - atk.epCost, 0, CONFIG.ENEMY.maxEP);
  if (atk.cooldown) e.cooldowns = e.cooldowns || {}, e.cooldowns[pick] = (e.cooldowns[pick] || atk.cooldown);

  // memorize last action
  state.lastEnemyAction = pick;
  // Hit chance
  // HDD switches to attack sprite (hdd3) when attacking
  showHDDAttackSpriteOnce(pick === 'special' ? 420 : (pick === 'precision' ? 360 : 320));
  // attacker animation (enemy) por tipo de ataque
  const enemySprite = el('#enemy-area .sprite-wrap');
  if (pick === 'basic1') { addAnimClass(enemySprite, 'anim-basic1-left', 260); addAnimClass(enemySprite, 'attack-glow-physical', 260); }
  else if (pick === 'basic2') { addAnimClass(enemySprite, 'anim-basic2-left', 280); addAnimClass(enemySprite, 'attack-glow-physical', 280); }
  else if (pick === 'precision') { addAnimClass(enemySprite, 'anim-precision-left', 300); addAnimClass(enemySprite, 'attack-glow-precision', 300); }
  else if (pick === 'special') addAnimClass(enemySprite, 'anim-special-left', 340);

  if (Math.random() > (atk.hitChance ?? 1)) {
    writeLog(`Inimigo usou ${atk.name} — errou!`);
    showFloatingText(el('#player-damage-pop'), 'MISS', 'large', 1500);
    playWhoosh();
    addAnimClass(el('#player-area .sprite-wrap'), 'dodge-left', 220);
  } else {
    const variance = 0.85 + Math.random() * 0.3;
    let damage = Math.max(1, Math.round(atk.dmg * variance * (CONFIG.DMG_MULT?.enemy ?? 1)));
    const isCrit = randFloat() < (CONFIG.CRIT?.chance ?? 0);
    if (isCrit) damage = Math.max(1, Math.round(damage * (CONFIG.CRIT?.multiplier ?? 1.5)));
    applyDamageTo('player', damage, isCrit ? { ...atk, _crit: true } : atk);
    writeLog(`Inimigo usou ${atk.name} e causou ${damage} de dano${isCrit ? ' (Crítico!)' : ''}.`);
    if (atk.type !== 'special') {
      const color = pick === 'basic1'
        ? 'linear-gradient(90deg, rgba(255,230,120,0.95), rgba(255,180,40,0.85))'
        : pick === 'basic2'
        ? 'linear-gradient(90deg, rgba(255,120,120,0.95), rgba(255,60,60,0.85))'
        : 'linear-gradient(90deg, rgba(180,240,255,0.95), rgba(120,200,255,0.85))';
      createStrikeAt('#player-sprite', color, true);
    }
    if (atk.type === 'special') { playUltimate(); createExplosionAt('#player-sprite'); }
  }

  renderAll();

  // check player dead
  if (state.player.hp <= 0) {
    endBattle(false);
    return;
  }

  // reduce enemy cooldowns now (at end of enemy turn)
  if (e.cooldowns) {
    for (const k of Object.keys(e.cooldowns)) {
      e.cooldowns[k] = Math.max(0, e.cooldowns[k] - 1);
      if (e.cooldowns[k] === 0) delete e.cooldowns[k];
    }
  }

  // back to player
  state.playerTurn = true;
  renderAll();
  writeLog("Seu turno.");
}

/* =============================
   Aplicar dano e feedback visual
   - Mostra pop de dano, flash e shake conforme intensidade.
   - Troca sprites de dano (player4 / hdd4) momentaneamente.
   ============================= */
function applyDamageTo(target, damage, attackObj = null){
  const t = state[target];
  t.hp = clamp(t.hp - damage, 0, target === 'player' ? CONFIG.PLAYER.maxHP : CONFIG.ENEMY.maxHP);

  // Show floating damage text
  const popEl = target === 'player' ? el('#player-damage-pop') : el('#enemy-damage-pop');
  const isCrit = !!(attackObj && attackObj._crit);
  const critMark = isCrit ? ' CRIT!' : '';
  // Large for normal (1s), huge and red for critical (2s)
  const sz = isCrit ? 'huge' : 'large';
  const dur = isCrit ? 2000 : 1000;
  const color = isCrit ? '#ff3b3b' : null;
  showFloatingText(popEl, `-${damage}${critMark}`, sz, dur, color);
  playImpact();

  // Flash and maybe shake for strong hit (>30% max HP)
  const spriteWrap = target === 'player' ? el('#player-area .sprite-wrap') : el('#enemy-area .sprite-wrap');

  // Flash
  flashElement(spriteWrap);

  // small hit bounce; stronger for special
  if (attackObj && attackObj.type === 'special') {
    addAnimClass(spriteWrap, 'hit-bounce-strong', 420);
  } else {
    addAnimClass(spriteWrap, 'hit-bounce', 300);
  }

  const strongThreshold = (target === 'player' ? CONFIG.PLAYER.maxHP : CONFIG.ENEMY.maxHP) * CONFIG.STRONG_HIT_PERC;
  if (damage >= strongThreshold) {
    // for special, use stronger shake
    if (attackObj && attackObj.type === 'special') shakeElement(spriteWrap, true);
    else shakeElement(spriteWrap);
  }

  // Sprite change on damage events
  if (damage > 0) {
    if (target === 'player') {
      // Player shows damaged sprite (player4)
      showPlayerDamagedSpriteOnce(attackObj && attackObj.type === 'special' ? 520 : 420);
    } else {
      // HDD shows damaged sprite (hdd4)
      showHDDDamagedSpriteOnce(attackObj && attackObj.type === 'special' ? 520 : 420);
    }
  }

  renderAll();
}

/* =============================
   Efeitos visuais auxiliares
   - Texto flutuante, flash, tremor e explosão decorativa.
   ============================= */
function showFloatingText(container, text, size='normal', durationMs=null, color=null){
  if (!container) return;
  const dur = durationMs ?? CONFIG.UI.damagePopDuration;
  // size map
  let fontSize = '22px';
  if (size === 'small') fontSize = '16px';
  else if (size === 'large') fontSize = '42px';
  else if (size === 'huge') fontSize = '56px';

  container.textContent = text;
  container.style.fontSize = fontSize;
  if (color) container.style.color = color;
  container.style.opacity = 1;
  container.style.transform = 'translateY(-10px)';
  container.style.transition = `all ${dur}ms ease-out`;
  setTimeout(() => {
    container.style.transform = 'translateY(-60px)';
    container.style.opacity = 0;
  }, 30);
  // clear after animation
  setTimeout(() => { container.textContent = ''; container.style.transition = ''; container.style.transform=''; container.style.opacity= ''; container.style.fontSize=''; if (color) container.style.color=''; }, dur + 120);
}

// small helper to add temporary animation classes
function addAnimClass(elm, cls, duration){
  if (!elm) return;
  if (!isAnimationsEnabled()) return;
  elm.classList.add(cls);
  setTimeout(()=> elm.classList.remove(cls), duration);
}

function flashElement(elm){
  if (!isAnimationsEnabled()) return;
  elm.classList.add('flash-red');
  setTimeout(()=> elm.classList.remove('flash-red'), CONFIG.UI.flashDuration);
}

function shakeElement(elm, strong=false){
  if (!isAnimationsEnabled()) return;
  const cls = strong ? 'shake-strong' : 'shake';
  elm.classList.add(cls);
  setTimeout(()=> elm.classList.remove(cls), strong ? 560 : 420);
}

function createExplosionAt(selector){
  if (!isAnimationsEnabled()) return;
  const target = document.querySelector(selector);
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const cx = rect.left + rect.width/2;
  const cy = rect.top + rect.height/2;

  // screen shake on battle area for big impact
  addAnimClass(el('#battle-area'), 'shake-strong', 560);

  const rings = [
    { size: 24,  color: 'radial-gradient(circle at 30% 30%, rgba(255,240,160,1), rgba(255,120,40,0.95) 45%, rgba(200,40,30,0.85) 75%)', dur: 600 },
    { size: 44,  color: 'radial-gradient(circle, rgba(255,240,200,0.9), rgba(255,180,80,0.8) 50%, rgba(255,80,60,0.0) 70%)', dur: 720 },
    { size: 70,  color: 'radial-gradient(circle, rgba(255,255,255,0.35), rgba(255,200,60,0.0) 60%)', dur: 820 }
  ];

  rings.forEach(r => {
    const ex = document.createElement('div');
    ex.className = 'explosion';
    ex.style.left = cx + 'px';
    ex.style.top = cy + 'px';
    ex.style.width = r.size + 'px';
    ex.style.height = r.size + 'px';
    ex.style.background = r.color;
    ex.style.zIndex = 9999;
    document.body.appendChild(ex);
    setTimeout(()=> ex.remove(), r.dur + 80);
  });
}

// Quick colored strike effect (for non-special attacks)
function createStrikeAt(selector, gradient, mirror=false){
  if (!isAnimationsEnabled()) return;
  const target = document.querySelector(selector);
  if (!target) return;
  const r = target.getBoundingClientRect();
  const x = r.left + r.width * 0.62; // biased to right side of sprite
  const y = r.top + r.height * 0.38;
  const d = document.createElement('div');
  d.className = 'strike';
  d.style.left = x + 'px';
  d.style.top = y + 'px';
  d.style.background = gradient;
  if (mirror) {
    d.style.transform = 'translate(-50%,-50%) rotate(20deg) scale(0.9)';
    d.style.animationDirection = 'reverse';
  }
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 420);
}

/* =============================
   Encerramento da batalha & movimento no tabuleiro
   - Mostra frase (player/HDD), depois modal de resultado (OK), depois menu “Jogar de novo?”.
   ============================= */
function endBattle(playerWon){
  state.inBattle = false;
  renderAll();
  if (playerWon) {
    state.score += 1;
    writeLog("Você venceu a batalha!");
    animateAdvance(6);
    // 1) diálogo do jogador; 2) modal de resultado (OK); 3) menu jogar de novo
    showDialogue({ speaker: 'playerWin', text: __randPick(__phrases_player_end), onClose: () => {
      showResultModal(true, "Você venceu — avance 6 casas");
      const ok = el('#result-ok');
      if (ok) {
        const handler = () => { ok.removeEventListener('click', handler); showPlayAgainMenu(true); };
        ok.addEventListener('click', handler);
      }
    }});
  } else {
    state.score -= 1;
    writeLog("Você perdeu a batalha...");
    animateRetreat(4);
    // 1) diálogo do HDD; 2) modal de resultado (OK); 3) menu jogar de novo
    showDialogue({ speaker: 'hdd', text: __randPick(__phrases_hdd_end), bounce: true, onClose: () => {
      showResultModal(false, "Você perdeu — volte 4 casas");
      const ok = el('#result-ok');
      if (ok) {
        const handler = () => { ok.removeEventListener('click', handler); showPlayAgainMenu(false); };
        ok.addEventListener('click', handler);
      }
    }});
  }
}

// Menu "Jogar de novo?" após encerrar batalha
function showPlayAgainMenu(won){
  let menu = document.getElementById('play-again-menu');
  if (menu) menu.remove();
  const area = el('#battle-area');
  if (area && getComputedStyle(area).position === 'static') area.style.position = 'relative';
  menu = document.createElement('div');
  menu.id = 'play-again-menu';
  menu.style.position = 'absolute';
  menu.style.inset = '0';
  menu.style.display = 'flex';
  menu.style.alignItems = 'center';
  menu.style.justifyContent = 'center';
  menu.style.background = 'rgba(0,0,0,0.6)';
  menu.style.zIndex = '100000';
  const card = document.createElement('div');
  card.style.background = '#111';
  card.style.border = '2px solid #444';
  card.style.borderRadius = '12px';
  card.style.padding = '20px 22px';
  card.style.minWidth = '320px';
  card.style.maxWidth = '90%';
  card.style.color = '#f5f5f5';
  card.style.textAlign = 'center';
  card.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
  const title = document.createElement('div');
  title.textContent = won ? 'Você venceu! Jogar de novo?' : 'Você perdeu. Jogar de novo?';
  title.style.font = '700 22px system-ui, Segoe UI, Roboto, Arial';
  title.style.marginBottom = '10px';
  const score = document.createElement('div');
  score.textContent = `Score da sessão: ${state.score}`;
  score.style.opacity = '0.85';
  score.style.marginBottom = '14px';
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '12px';
  row.style.justifyContent = 'center';
  const yes = document.createElement('button');
  yes.textContent = 'Sim';
  yes.style.padding = '10px 16px';
  yes.style.font = '600 16px system-ui, Segoe UI, Roboto, Arial';
  yes.style.borderRadius = '8px';
  yes.style.border = '1px solid #2e7d32';
  yes.style.background = '#1b5e20';
  yes.style.color = '#fff';
  yes.addEventListener('click', () => { menu.remove(); resetBattle(); });
  const no = document.createElement('button');
  no.textContent = 'Não';
  no.style.padding = '10px 16px';
  no.style.font = '600 16px system-ui, Segoe UI, Roboto, Arial';
  no.style.borderRadius = '8px';
  no.style.border = '1px solid #7f1d1d';
  no.style.background = '#5b0f0f';
  no.style.color = '#fff';
  no.addEventListener('click', () => { menu.remove(); });
  row.appendChild(yes);
  row.appendChild(no);
  card.appendChild(title);
  card.appendChild(score);
  card.appendChild(row);
  menu.appendChild(card);
  (area || document.body).appendChild(menu);
}

/* Modal de resultado — exibe GANHOU/PERDEU e instrução de avanço/recuo */
function showResultModal(win, text){
  const modal = el('#result-modal');
  el('#result-title').textContent = win ? "GANHOU" : "PERDEU";
  el('#result-text').textContent = text;
  modal.setAttribute('aria-hidden', 'false');
  // Keep modal visible until OK pressed
}
function closeResultModal(){
  const modal = el('#result-modal');
  modal.setAttribute('aria-hidden', 'true');
  // After result modal closed, prepare next round (game over state persists; allow restart)
}

/* Animações simples de avanço/recuo no “tabuleiro” */
function animateAdvance(n){
  // move position by +n with simple animation
  const start = state.position;
  const end = state.position + n;
  // show incremental animation
  let step = 0;
  const totalSteps = n;
  const interval = setInterval(() => {
    step++;
    state.position = start + step;
    renderPosition();
    if (step >= totalSteps) clearInterval(interval);
  }, 220);
}

function animateRetreat(n){
  const start = state.position;
  const end = Math.max(0, start - n);
  let step = 0;
  const totalSteps = start - end;
  const interval = setInterval(() => {
    step++;
    state.position = Math.max(0, start - step);
    renderPosition();
    if (step >= totalSteps) clearInterval(interval);
  }, 220);
}

/* =============================
   Reset / restart
   - Restaura HP/EP, cooldowns e estado de batalha; mostra fala inicial novamente.
   ============================= */
function resetBattle(){
  state.player.hp = CONFIG.PLAYER.maxHP;
  state.player.ep = CONFIG.PLAYER.maxEP;
  state.player.cooldowns = {};
  state.enemy.hp = CONFIG.ENEMY.maxHP;
  state.enemy.ep = CONFIG.ENEMY.maxEP;
  state.enemy.cooldowns = {};
  state.playerTurn = CONFIG.TURNS.playerStarts;
  state.inBattle = true;
  writeLog("Batalha reiniciada.");
  renderAll();
  // diálogo inicial também no reinício da partida, usando pool embaralhado
  showDialogue({ speaker: 'player', text: getNextStartPhrase() });
}

/* =============================
   Modal de Configurações e preview do CONFIG
   - Útil para ver rapidamente valores ativos sem abrir o arquivo.
   ============================= */
function openSettings(){
  el('#settings-modal').setAttribute('aria-hidden','false');
}
function closeSettings(){
  el('#settings-modal').setAttribute('aria-hidden','true');
}
function isAnimationsEnabled(){
  const elAnim = el('#setting-animations');
  return elAnim ? elAnim.checked : true;
}
function updateConfigPreview(){
  el('#config-preview').textContent = JSON.stringify(CONFIG, null, 2);
}

/* =============================
   Helpers for robustness: prevent negative positions, etc.
   ============================= */
function safeUpdatePosition(newPos){
  state.position = Math.max(0, newPos);
  renderPosition();
}

/* =============================
   Expose some debug helpers (optional)
   ============================= */
window.__miniGame = {
  CONFIG, state, resetBattle, applyDamageTo, playerRest, playerAction
};

/* =============================
   Extra: show where to edit next HDD file
   (Exposed for developer to detect "data-hdd-next")
   ============================= */
(function exposeNextHDD(){
  const elh = el('#next-hdd');
  if (!elh) return;
  const name = elh.dataset.hddNext;
  if (name) {
    writeLog(`Próximo HD (callback): ${name} — para trocar, edite data-hdd-next no index.html.`);
  }
})();
