// --- Firebase 設定 (ランキング機能専用) ---
const firebaseConfig = {
  apiKey: "AIzaSyBiAVv5McatIqToYysNyoriV_FLW5AChr0",
  databaseURL: "https://shooting-34c1c-default-rtdb.asia-southeast1.firebasedatabase.app/",
};

let db = null;
try {
  if (firebaseConfig.apiKey !== "YOUR_API_KEY" && firebaseConfig.apiKey !== "") {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
  }
} catch(e) { console.log("Firebase connection skipped (Solo mode only)"); }

// --- Socket.io 設定 (ゲーム内同期・チャット用) ---
const socket = io(); 

// --- 変数定義 (デザイン・システム変更なし) ---
let inLobby = false;       
let currentRoomCode = "public"; 
let isSpectating = false; 

// モードやチームの同期用
let currentLobbyMode = 'solo_vs'; 
let myTeam = '';       
let roomTeams = {};
let lastLobbyData = null;
let mySelectedTeam = 'AUTO'; 

const myId = Math.random().toString(36).substring(2, 10);
const others = {};
let sharedNodes = {}; 
let sharedDrops = {}; 
let myPlayerName = ""; 

// UI要素の取得
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
const mCanvas = document.getElementById('minimap-canvas'), mCtx = mCanvas.getContext('2d');
const hpBar = document.getElementById('hp-bar'), expBar = document.getElementById('exp-bar'), hpTxt = document.getElementById('hp-txt'), expTxt = document.getElementById('exp-txt'), lvNum = document.getElementById('lv-num');
const lvlPanel = document.getElementById('level-panel'), cardWrap = document.getElementById('card-wrap'), overScreen = document.getElementById('over-screen'), victoryScreen = document.getElementById('victory-screen'), startScreen = document.getElementById('start-screen'), uiLayer = document.getElementById('ui-layer');
const scoreVal = document.getElementById('score-val'), finalScoreVal = document.getElementById('final-score-val'), victoryScoreVal = document.getElementById('victory-score-val');
const pauseScreen = document.getElementById('pause-screen');
const rankingScreen = document.getElementById('ranking-screen');
const grenadeVal = document.getElementById('grenade-val');
const btnGrenade = document.getElementById('btn-grenade');
const survivorsContainer = document.getElementById('survivors-container');
const survivorsVal = document.getElementById('survivors-val');

let w, h, isOver = false, isVictory = false, vsMatchActive = false, isPaused = true, gameStarted = false, level = 1, exp = 0, nextExp = 5, score = 0;
let camX = 0, camY = 0, shake = 0, gameMode = 'solo';
let loopId = null;
let isLevelUpInvincible = false;
let levelUpTimeout = null;
const GAME_SCALE = 1.5;

const TILE_SIZE = 80, MAP_W = 40, MAP_H = 40, map = [];

// --- 地形生成・当たり判定 (変更なし) ---
function generateMap() {
  for(let y=0; y<MAP_H; y++){
    map[y] = [];
    for(let x=0; x<MAP_W; x++) {
      if (x === 0 || x === MAP_W-1 || y === 0 || y === MAP_H-1) map[y][x] = 1;
      else map[y][x] = Math.random() < 0.12 ? 1 : 0;
    }
  }
}
generateMap();

function getWall(x, y) {
  const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H || !map[ty]) return 1;
  return map[ty][tx];
}

function isCollide(x, y, r) {
  for (let i = 0; i < 8; i++) {
    const ang = i * Math.PI / 4;
    if (getWall(x + Math.cos(ang) * r, y + Math.sin(ang) * r)) return true;
  }
  return false;
}

function updateInputs() {
  const nameVal = document.getElementById('player-name').value.trim();
  myPlayerName = nameVal !== "" ? nameVal : "ANONYMOUS";
  const codeVal = document.getElementById('room-code').value.trim();
  currentRoomCode = codeVal !== "" ? codeVal : "Public"; 
}

// --- ランキング機能 (Firebase) ---
function submitSoloScore() {
  if (!db || gameMode !== 'solo' || score <= 0) return;
  if (myPlayerName === '↑↑↓↓←→←→BA') return;
  const scoresRef = db.ref('solo_scores');
  scoresRef.push({ name: myPlayerName, score: score, timestamp: firebase.database.ServerValue.TIMESTAMP });
  scoresRef.orderByChild('score').once('value', snapshot => {
    const total = snapshot.numChildren();
    if (total > 100) {
      let count = 0;
      const removes = total - 100; 
      snapshot.forEach(child => { if (count < removes) child.ref.remove(); count++; });
    }
  });
}

function showRanking() {
  startScreen.style.display = 'none';
  rankingScreen.style.display = 'flex';
  const listDiv = document.getElementById('ranking-list');
  listDiv.innerHTML = "LOADING DATA...";
  if (!db) { listDiv.innerHTML = "FIREBASE NOT CONNECTED."; return; }
  db.ref('solo_scores').orderByChild('score').limitToLast(10).once('value', snapshot => {
    const data = snapshot.val();
    if (!data) { listDiv.innerHTML = "NO RECORDS FOUND."; return; }
    const scores = Object.values(data).sort((a, b) => b.score - a.score);
    let html = "";
    scores.forEach((s, index) => {
      let rankColor = "#fff";
      if (index === 0) rankColor = "var(--yellow)";
      if (index === 1) rankColor = "#e0e0e0";
      if (index === 2) rankColor = "#cd7f32";
      const pName = s.name.substring(0, 12).padEnd(12, ' ');
      const pScore = String(s.score).padStart(6, ' ');
      html += `<div style="color:${rankColor}; white-space:pre;">${String(index+1).padStart(2, ' ')}. ${pName} : <span style="color:var(--cyan);">${pScore}</span> pts</div>`;
    });
    listDiv.innerHTML = html;
  });
}

function closeRanking() {
  rankingScreen.style.display = 'none';
  startScreen.style.display = 'flex';
}

// --- Socket.io 通信イベント (Firebase同期の置き換え) ---

socket.on('lobby_update', (data) => {
  lastLobbyData = data;
  onLobbyUpdate();
});

socket.on('mode_update', (mode) => {
  currentLobbyMode = mode;
  updateModeUI(mode);
});

socket.on('state_update', (state) => {
  if (inLobby && state === 'playing') {
    onRoomStateUpdate(state);
  }
});

socket.on('map_update', (mapData) => {
  if (mapData) {
    for(let y=0; y<MAP_H; y++) map[y] = mapData[y];
  }
});

socket.on('teams_update', (teams) => {
  roomTeams = teams;
  myTeam = roomTeams[myId] || 'RED';
  if (typeof p !== 'undefined') p.team = myTeam;
});

socket.on('players_update', (data) => {
  if (!data) return;
  let opponentIds = 0;
  if (gameMode === 'team_vs') {
    opponentIds = Math.max(0, Object.keys(data).filter(id => id !== myId && roomTeams[id] !== myTeam).length);
  } else {
    opponentIds = Math.max(0, Object.keys(data).filter(id => id !== myId).length);
  }
  if (data[myId]) {
     if (Object.keys(data).length > 1) vsMatchActive = true; 
     if ((gameMode === 'solo_vs' || gameMode === 'team_vs') && vsMatchActive && opponentIds === 0 && p.hp > 0 && !isOver && !isVictory) {
       triggerVictory();
     }
  }
  Object.keys(data).forEach(id => {
    if (id !== myId) {
      if (!others[id]) {
        others[id] = data[id];
        others[id].targetX = data[id].x; others[id].targetY = data[id].y; others[id].targetAng = data[id].ang;
        if (gameMode === 'team_vs') others[id].team = roomTeams[id]; 
      } else {
        const cx = others[id].x, cy = others[id].y, cang = others[id].ang;
        others[id] = data[id];
        others[id].targetX = data[id].x; others[id].targetY = data[id].y; others[id].targetAng = data[id].ang;
        others[id].x = cx; others[id].y = cy; others[id].ang = cang;
        if (gameMode === 'team_vs') others[id].team = roomTeams[id];
      }
    }
  });
  Object.keys(others).forEach(id => { if (!data[id]) delete others[id]; });
});

socket.on('take_damage', ({ targetId, dmg }) => {
  if (targetId === myId) {
    if (isLevelUpInvincible) return;
    p.hp = Math.max(0, p.hp - dmg);
    shake = 10;
  }
});

socket.on('node_spawned', (nodeData) => { sharedNodes[nodeData.id] = nodeData; });
socket.on('node_updated', ({ nodeId, hp }) => { if(sharedNodes[nodeId]) sharedNodes[nodeId].hp = hp; });
socket.on('node_destroyed', ({ nodeId }) => { delete sharedNodes[nodeId]; });
socket.on('drop_spawned', ({ dropId, dropData }) => { sharedDrops[dropId] = dropData; });
socket.on('drop_picked', ({ dropId }) => { delete sharedDrops[dropId]; });
socket.on('node_list_update', (list) => { sharedNodes = list; });
socket.on('drop_list_update', (list) => { sharedDrops = list; });

// --- ロビー制御ロジック ---

function joinLobby() {
  updateInputs();
  document.getElementById('lobby-screen').style.display = 'flex';
  startScreen.style.display = 'none';
  document.getElementById('lobby-title').innerText = `VS LOBBY [${currentRoomCode}]`;
  document.getElementById('lobby-players').innerHTML = "LOADING...";
  inLobby = true;
  socket.emit('join_lobby', { roomCode: currentRoomCode, playerName: myPlayerName, myId: myId, selectedTeam: mySelectedTeam });
  initChat(currentRoomCode);
}

function updateModeUI(mode) {
  const btn = document.getElementById('mode-toggle-btn');
  if (!btn) return;
  if (mode === 'team_vs') {
    btn.innerText = 'TEAM MATCH'; btn.classList.remove('vs-btn'); btn.classList.add('team-btn');
  } else {
    btn.innerText = 'BATTLE ROYALE'; btn.classList.remove('team-btn'); btn.classList.add('vs-btn');
  }
  onLobbyUpdate(); 
}

window.cycleTeam = function(direction) {
  const teams = ['AUTO', 'RED', 'BLUE'];
  let idx = teams.indexOf(mySelectedTeam);
  if (idx === -1) idx = 0;
  idx = (idx + direction + teams.length) % teams.length;
  mySelectedTeam = teams[idx];
  if (inLobby) {
    socket.emit('change_team', { team: mySelectedTeam });
  }
};

window.toggleGameMode = function() {
  const newMode = (currentLobbyMode === 'solo_vs') ? 'team_vs' : 'solo_vs';
  socket.emit('toggle_mode', newMode);
};

window.startVsMatchWithMode = function() {
  startVsMatch(currentLobbyMode);
};

function onLobbyUpdate() {
  const data = lastLobbyData;
  if (!data) return;
  const count = Object.keys(data).length;
  const playersDiv = document.getElementById('lobby-players');
  if(playersDiv) {
    let html = `<span style="color:var(--lime); font-weight:bold;">ROOM CODE: ${currentRoomCode}</span><br>`;
    html += `<span style="color:var(--cyan);">PLAYERS WAITING: ${count}</span><br><br>`;
    Object.keys(data).forEach(id => {
      const pName = data[id].name || `PLAYER_${id.substring(0,4)}`;
      const pTeam = data[id].team || 'AUTO';
      if (currentLobbyMode === 'team_vs') {
        let teamColor = '#fff';
        if (pTeam === 'RED') teamColor = 'var(--red)';
        if (pTeam === 'BLUE') teamColor = 'var(--cyan)';
        if (id === myId) {
          html += `<div style="display:flex; align-items:center; margin-bottom:8px;">
                     <span style="width:140px; color:#fff;">> ${pName} (YOU)</span>
                     <button onclick="cycleTeam(-1)" style="padding:2px 8px; border:1px solid var(--cyan); background:rgba(0,242,255,0.1); color:var(--cyan); cursor:pointer; border-radius:4px;">◀</button>
                     <span style="display:inline-block; width:70px; text-align:center; color:${teamColor}; font-weight:bold; letter-spacing:1px; text-shadow:0 0 5px ${teamColor};">${pTeam}</span>
                     <button onclick="cycleTeam(1)" style="padding:2px 8px; border:1px solid var(--cyan); background:rgba(0,242,255,0.1); color:var(--cyan); cursor:pointer; border-radius:4px;">▶</button>
                   </div>`;
        } else {
          html += `<div style="display:flex; align-items:center; margin-bottom:8px;">
                     <span style="width:140px; color:#aaa;">  ${pName}</span>
                     <span style="display:inline-block; width:130px; text-align:center; color:${teamColor}; font-size:14px; opacity:0.8;">[ ${pTeam} ]</span>
                   </div>`;
        }
      } else {
        html += `<div style="margin-bottom:5px; color:${id === myId ? '#fff' : '#aaa'}">${id === myId ? '> ' : '  '}${pName} ${id === myId ? '(YOU)' : ''}</div>`;
      }
    });
    playersDiv.innerHTML = html;
  }
}

function onRoomStateUpdate(state) {
  if (inLobby && state === 'playing') {
    inLobby = false;
    document.getElementById('lobby-screen').style.display = 'none';
    cleanupChat();
    startGame(currentLobbyMode || 'solo_vs'); 
  }
}

function leaveLobby() {
  inLobby = false;
  socket.emit('leave_lobby');
  document.getElementById('lobby-screen').style.display = 'none';
  cleanupChat();
  startScreen.style.display = 'flex';
}

function startVsMatch(mode) {
  generateMap();
  socket.emit('start_match', { mapData: map, mode: mode });
}

function triggerVictory() {
  isVictory = true; isOver = true; 
  if(levelUpTimeout) { clearTimeout(levelUpTimeout); levelUpTimeout = null; }
  isLevelUpInvincible = false;
  if (gameMode === 'solo') submitSoloScore(); 
  socket.emit('player_death', { deadPlayerId: myId });
  victoryScoreVal.innerText = score;
  victoryScreen.style.display = 'flex';
  uiLayer.style.display = 'none';
  btnGrenade.style.display = 'none';
  if(document.getElementById('move-base')) document.getElementById('move-base').style.display = 'none';
  if(document.getElementById('aim-base')) document.getElementById('aim-base').style.display = 'none';
}

function startGame(mode) {
  gameMode = mode || 'solo';
  isOver = false; isVictory = false; vsMatchActive = false; isPaused = false; isSpectating = false; window.isSpectating = false; 
  score = 0; level = 1; exp = 0; nextExp = 5;
  const btnLeave = document.getElementById('btn-leave-spectate');
  if (btnLeave) btnLeave.style.display = 'none';
  isLevelUpInvincible = false;
  if(levelUpTimeout) { clearTimeout(levelUpTimeout); levelUpTimeout = null; }
  updateInputs(); 
  if (gameMode === 'solo') generateMap();
  bullets.length = 0; enemyBullets.length = 0; enemies.length = 0;
  cores.length = 0; items.length = 0; grenades.length = 0; nodes.length = 0; 
  sharedNodes = {}; sharedDrops = {}; Object.keys(others).forEach(id => delete others[id]);
  p.reset();
  startScreen.style.display = 'none'; overScreen.style.display = 'none'; victoryScreen.style.display = 'none'; pauseScreen.style.display = 'none';
  uiLayer.style.display = 'flex'; btnGrenade.style.display = 'flex';
  document.getElementById('minimap-container').style.display = 'block';
  document.getElementById('exp-group').style.visibility = 'visible';
  survivorsContainer.style.display = (gameMode === 'solo_vs' || gameMode === 'team_vs') ? 'block' : 'none';
  let rx, ry, px, py, attempts = 0;
  do {
    rx = Math.floor(Math.random() * (MAP_W - 2)) + 1; ry = Math.floor(Math.random() * (MAP_H - 2)) + 1;
    px = rx * TILE_SIZE + TILE_SIZE / 2; py = ry * TILE_SIZE + TILE_SIZE / 2;
    attempts++;
  } while (attempts < 100 && (!map[ry] || map[ry][rx] === 1 || isCollide(px, py, p.r + 10)));
  p.x = px; p.y = py;
  camX = p.x - (w / 2) / GAME_SCALE; camY = p.y - (h / 2) / GAME_SCALE;
  if('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    document.getElementById('move-base').style.display = 'block'; document.getElementById('aim-base').style.display = 'block';
  }
  if (loopId) cancelAnimationFrame(loopId);
  gameStarted = true;
  if (gameMode === 'solo' && myPlayerName === '↑↑↓↓←→←→BA') {
    window.pendingLevelUps = 49; isPaused = true; level++; nextExp += 5;
    if (typeof openPanel === 'function') openPanel();
  }
  loop();
}

function backToTitle() {
  if(levelUpTimeout) { clearTimeout(levelUpTimeout); levelUpTimeout = null; }
  isLevelUpInvincible = false;
  socket.emit('leave_lobby');
  gameStarted = false; isPaused = true; isOver = false; isVictory = false; vsMatchActive = false; isSpectating = false; window.isSpectating = false; 
  const btnLeave = document.getElementById('btn-leave-spectate');
  if (btnLeave) btnLeave.style.display = 'none';
  if(loopId) { cancelAnimationFrame(loopId); loopId = null; }
  overScreen.style.display = 'none'; victoryScreen.style.display = 'none'; pauseScreen.style.display = 'none'; uiLayer.style.display = 'none';
  btnGrenade.style.display = 'none'; lvlPanel.style.display = 'none'; document.getElementById('minimap-container').style.display = 'none';
  document.getElementById('lobby-screen').style.display = 'none';
  if(document.getElementById('move-base')) document.getElementById('move-base').style.display = 'none';
  if(document.getElementById('aim-base')) document.getElementById('aim-base').style.display = 'none';
  startScreen.style.display = 'flex';
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, w, h);
}

function togglePause() {
  if (isOver || !gameStarted || lvlPanel.style.display === 'block') return;
  isPaused = !isPaused; pauseScreen.style.display = isPaused ? 'flex' : 'none';
}

window.addEventListener('resize', () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; });
window.dispatchEvent(new Event('resize'));

const keys = {};
let mouseX = 0, mouseY = 0, isMouseDown = false;
let touchMoveDir = {x: 0, y: 0}, touchAimDir = {x: 0, y: 0};

window.addEventListener('keydown', e => { 
  keys[e.code] = true;
  if(e.code === 'Digit1') p.weaponIdx = 0;
  if(e.code === 'Digit2') p.weaponIdx = 1;
  if(e.code === 'Digit3') p.weaponIdx = 2;
  if(e.code === 'Digit4') p.weaponIdx = 3;
  if(e.code === 'KeyG') p.throwGrenade();
  if(e.code === 'KeyP' || e.code === 'Escape') togglePause();
});
window.addEventListener('keyup', e => keys[e.code] = false);
window.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
window.addEventListener('mousedown', (e) => {
  if(e.button === 0) isMouseDown = true;
  if(e.button === 2) { p.throwGrenade(); e.preventDefault(); }
});
window.addEventListener('mouseup', (e) => { if(e.button === 0) isMouseDown = false; });
window.addEventListener('contextmenu', e => e.preventDefault());

let lastWheelTime = 0;
window.addEventListener('wheel', (e) => {
  const isScrollable = e.target.closest('#chat-messages, #start-chat-messages, #lobby-players, #ranking-list');
  if (!isScrollable) e.preventDefault();
}, { passive: false });

document.addEventListener('touchmove', (e) => {
  if (!e.target.closest('#chat-messages, #start-chat-messages, #lobby-players, #ranking-list')) e.preventDefault();
}, { passive: false });

document.addEventListener('wheel', (e) => {
  const target = e.target;
  if (target.closest('#chat-messages') || target.closest('#start-chat-messages') || target.closest('#lobby-players') || target.closest('#ranking-list')) return;
  e.preventDefault();
  if (typeof gameStarted === 'undefined' || !gameStarted || isPaused || isOver) return;
  const now = Date.now();
  if (now - lastWheelTime < 100) return;
  if (e.deltaY > 0) { p.weaponIdx = (p.weaponIdx - 1 + 4) % 4; p.cd = 0; lastWheelTime = now; }
  else if (e.deltaY < 0) { p.weaponIdx = (p.weaponIdx + 1) % 4; p.cd = 0; lastWheelTime = now; }
}, { passive: false });

const moveBase = document.getElementById('move-base'), aimBase = document.getElementById('aim-base');
const moveKnob = document.getElementById('move-knob'), aimKnob = document.getElementById('aim-knob');

function handleTouch(e) {
  if (!gameStarted || isPaused) return; 
  let moveFound = false, aimFound = false;
  for (let i = 0; i < e.touches.length; i++) {
    const t = e.touches[i];
    if (t.target.closest('#ui-layer') || t.target.closest('#level-panel') || t.target === btnGrenade || t.target.parentElement === btnGrenade || t.target.closest('#start-chat-container') || t.target.closest('#lobby-chat-container')) continue;
    e.preventDefault();
    if (t.clientX < window.innerWidth / 2) {
      moveFound = true;
      const rect = moveBase.getBoundingClientRect();
      const dx = t.clientX - (rect.left + rect.width/2), dy = t.clientY - (rect.top + rect.height/2);
      const dist = Math.hypot(dx, dy) || 1;
      touchMoveDir.x = dx / dist; touchMoveDir.y = dy / dist;
      moveKnob.style.transform = `translate(calc(-50% + ${touchMoveDir.x * 25}px), calc(-50% + ${touchMoveDir.y * 25}px))`;
    } else {
      if (!isSpectating) { 
        aimFound = true;
        const rect = aimBase.getBoundingClientRect();
        const dx = t.clientX - (rect.left + rect.width/2), dy = t.clientY - (rect.top + rect.height/2);
        const dist = Math.hypot(dx, dy) || 1;
        touchAimDir.x = dx / dist; touchAimDir.y = dy / dist;
        isMouseDown = true;
        mouseX = (p.x - camX) * GAME_SCALE + touchAimDir.x * 200;
        mouseY = (p.y - camY) * GAME_SCALE + touchAimDir.y * 200;
        aimKnob.style.transform = `translate(calc(-50% + ${touchAimDir.x * 25}px), calc(-50% + ${touchAimDir.y * 25}px))`;
      }
    }
  }
  if (!moveFound) { touchMoveDir = {x: 0, y: 0}; moveKnob.style.transform = `translate(-50%, -50%)`; }
  if (!aimFound) { isMouseDown = false; aimKnob.style.transform = `translate(-50%, -50%)`; }
}
document.addEventListener('touchstart', handleTouch, {passive: false});
document.addEventListener('touchmove', handleTouch, {passive: false});
document.addEventListener('touchend', handleTouch, {passive: false});

const UPGRADES = [
  { name: "RELOADER", desc: "全武器の連射速度が上昇", action: () => p.rapidMod += 2 },
  { name: "FIREPOWER", desc: "全武器のダメージが向上", action: () => p.atkBonus += 2.0 },
  { name: "PIERCING", desc: "SNIPERの貫通数と威力強化", action: () => { p.sniperPierce += 1;p.sniperAtkBonus += 5.0; } },
  { name: "REACH", desc: "Swordの 攻撃半径が拡大", action: () => p.swordRange += 15 },
  { name: "HITPOINT", desc: "最大HP+40", action: () => { p.maxHp += 40; p.hp += 40; } },
  { name: "AGILITY", desc: "移動速度が上昇", action: () => p.speed += 0.6 },
  { name: "SCATTER", desc: "SHOTGUNの発射弾数が増加", action: () => { p.shotgunPelletsBase += 0.5; p.shotgunSpreadRatio += 0.01; } },
  { name: "CRITICAL", desc: "クリティカル発生率が5%上昇", action: () => p.critChance += 0.05 },
  { name: "REGENE", desc: "体力が徐々に回復する", action: () => p.regen += 0.005 },
  { name: "EXPLOSION", desc: "グレネードの爆発範囲が拡大",  action: () => { p.grenadeRangeBonus = (p.grenadeRangeBonus || 0) + 30; } },
];

function joinMidMatchSpectator() {
  updateInputs(); socket.emit('join_spectator', { roomCode: currentRoomCode, myId: myId });
  startScreen.style.display = 'none'; document.getElementById('lobby-screen').style.display = 'none';
  gameMode = 'solo_vs'; isOver = false; isVictory = false; vsMatchActive = true; isPaused = false; gameStarted = true; isSpectating = true; window.isSpectating = true; 
  bullets.length = 0; enemyBullets.length = 0; enemies.length = 0; cores.length = 0; items.length = 0; grenades.length = 0; nodes.length = 0;
  uiLayer.style.display = 'none'; btnGrenade.style.display = 'none';
  p.x = (MAP_W * TILE_SIZE) / 2; p.y = (MAP_H * TILE_SIZE) / 2; p.hp = 0; 
  if (typeof startSpectate === 'function') startSpectate();
  if (loopId) cancelAnimationFrame(loopId);
  loop(); 
}

// --- チャット機能ロジック ---

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}
function autoLink(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}
function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

socket.on('global_chat_history', (history) => {
  const messagesDiv = document.getElementById('start-chat-messages');
  if (messagesDiv) {
    messagesDiv.innerHTML = '';
    history.forEach(msg => addChatMessage('start-chat-messages', msg));
  }
});

socket.on('global_chat_received', (msg) => {
  addChatMessage('start-chat-messages', msg);
});

socket.on('chat_history', (history) => {
  const messagesDiv = document.getElementById('chat-messages');
  if (messagesDiv) {
    messagesDiv.innerHTML = '';
    history.forEach(msg => addChatMessage('chat-messages', msg));
  }
});

socket.on('chat_received', (msg) => {
  addChatMessage('chat-messages', msg);
});

function addChatMessage(containerId, data) {
  const messagesDiv = document.getElementById(containerId);
  if (!messagesDiv) return;
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg';
  const isMe = data.name === myPlayerName;
  const nameColor = isMe ? "var(--lime)" : "var(--cyan)";
  const safeText = autoLink(escapeHTML(data.text)); 
  msgEl.innerHTML = `<span class="chat-time">${formatTime(data.timestamp)}</span><span class="chat-name" style="color: ${nameColor};">[${escapeHTML(data.name)}]</span> <span class="chat-text">${safeText}</span>`;
  messagesDiv.appendChild(msgEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function sendGlobalChatMessage() {
  const input = document.getElementById('start-chat-input');
  if (input && input.value.trim()) {
    socket.emit('send_global_chat', { name: myPlayerName, text: input.value.trim() });
    input.value = '';
  }
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (input && input.value.trim()) {
    socket.emit('send_chat', input.value.trim());
    input.value = '';
  }
}

function initChat(roomId) {
  document.getElementById('chat-messages').innerHTML = '';
}
function cleanupChat() {
  document.getElementById('chat-messages').innerHTML = '';
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-send-chat')?.addEventListener('click', sendChatMessage);
  document.getElementById('chat-input')?.addEventListener('keypress', e => { if (e.key === 'Enter') sendChatMessage(); });
  document.getElementById('btn-start-send-chat')?.addEventListener('click', sendGlobalChatMessage);
  document.getElementById('start-chat-input')?.addEventListener('keypress', e => { if (e.key === 'Enter') sendGlobalChatMessage(); });
  document.getElementById('start-chat-tab').classList.add('visible');
  document.getElementById('lobby-chat-tab').classList.add('visible');
});

function toggleChat(containerId, tabId) {
  const container = document.getElementById(containerId);
  const tab = document.getElementById(tabId);
  container.classList.toggle('chat-collapsed');
  if (container.classList.contains('chat-collapsed')) tab.classList.add('visible');
  else tab.classList.remove('visible');
}
