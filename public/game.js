// --- Firebase Config (ランキング専用) ---
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
} catch(e) { console.log("Firebase Ranking connection skipped."); }

// --- Socket.io (Renderサーバー接続安全接続処理) ---
let socket = null;
if (typeof io !== 'undefined') {
  try {
    socket = io();
  } catch(e) {
    console.warn("Socket.io connection failed, using dummy socket.", e);
  }
}

if (!socket) {
  console.warn("io is not defined. Solo mode remains active.");
  socket = {
    on: function(event, callback) { console.log(`[Dummy Socket] on: ${event}`); },
    emit: function(event, data) { console.log(`[Dummy Socket] emit: ${event}`, data); },
    disconnect: function() {},
    connect: function() {}
  };
}

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

// --- ゲームオブジェクト管理用配列 ---
const bullets = [];
const enemyBullets = [];
const enemies = [];
const cores = [];
const items = [];
const grenades = [];
const nodes = [];
const explosions = [];
const particles = [];

// Canvas DOM
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

// ==========================================
// CLASSES DEFINITION (元の完全なゲーム設計)
// ==========================================

class Player {
  constructor() { this.reset(); }
  
  reset() {
    this.x = 0; this.y = 0; this.r = 13; this.hp = 100; this.maxHp = 100;
    this.speed = 4.0; this.weaponIdx = 0; this.cd = 0; this.atkBonus = 0; this.sniperAtkBonus = 0; this.rapidMod = 0;
    this.sniperPierce = 3; this.swordRange = 90; this.swinging = 0; this.swingStartAng = 0;
    this.swingArc = Math.PI * 1.2; this.swingHitList = [];
    this.grenades = 3; this.grenadeCd = 0;
    this.contactCd = 0; 
    this.shotgunPelletsBase = 2; this.shotgunSpreadRatio = 1.0;
    this.critChance = 0.05; this.critMult = 2.0;
    this.myCrits = []; 
    this.regen = 0;
    
    // 安全エリア（安地）用の設定
    this.matchStartTime = Date.now();
    this.safeZoneR = 9999;
    this.safeZoneX = 0;
    this.safeZoneY = 0;

    // 通信頻度制限用
    this.lastSyncTime = 0;

    // チーム色（初期状態）
    this.team = ''; 
    this.knownTeammates = {}; 
  }

  throwGrenade() {
    if (this.grenades > 0 && this.grenadeCd <= 0) {
      const px = (this.x - camX) * GAME_SCALE, py = (this.y - camY) * GAME_SCALE;
      const ang = Math.atan2(mouseY - py, mouseX - px);
      
      const damage = 35 + (this.atkBonus || 0) * 15; 
      const range = 280 + (this.grenadeRangeBonus || 0);
      
      const ownerId = typeof myId !== 'undefined' ? myId : 'solo';
      
      grenades.push(new Grenade(this.x, this.y, ang, ownerId, damage, range)); 
      
      this.grenades--;
      this.grenadeCd = 150;
    }
  }

  update() {
    if (this.regen > 0 && this.hp < this.maxHp && this.hp > 0) {
      this.hp = Math.min(this.maxHp, this.hp + this.regen);
    }

    // --- 移動速度の計算（攻撃中のデバフ処理） ---
    let currentMoveSpeed = this.speed;

    if (this.weaponIdx === 2) { 
      if (this.swinging > 0 || this.cd > 0) {
        currentMoveSpeed *= 0.7; 
      }
    } else {
      if (this.swinging > 0) {
        currentMoveSpeed *= 0.7;
      } else if (this.cd > 0) {
        if (this.weaponIdx === 1) currentMoveSpeed *= 0.7; 
        else if (this.weaponIdx === 3) currentMoveSpeed *= 0.75; 
        else if (this.weaponIdx === 0) currentMoveSpeed *= 0.85; 
      }
    }

    let mx = 0, my = 0;
    if (keys['KeyW'] || keys['ArrowUp']) my -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) my += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
    if (typeof touchMoveDir !== 'undefined' && (touchMoveDir.x !== 0 || touchMoveDir.y !== 0)) { mx = touchMoveDir.x; my = touchMoveDir.y; }
    
    if (mx !== 0 || my !== 0) {
      const mag = Math.hypot(mx, my);
      const vx = (mx / mag) * currentMoveSpeed; 
      const vy = (my / mag) * currentMoveSpeed; 
      if (!isCollide(this.x + vx, this.y, this.r)) this.x += vx;
      if (!isCollide(this.x, this.y + vy, this.r)) this.y += vy;
    }

    camX += (this.x - (w / 2) / GAME_SCALE - camX) * 0.12;
    camY += (this.y - (h / 2) / GAME_SCALE - camY) * 0.12;

    const px = (this.x - camX) * GAME_SCALE, py = (this.y - camY) * GAME_SCALE;
    const ang = Math.atan2(mouseY - py, mouseX - px);

    if (isMouseDown && this.cd <= 0) {
      if (this.weaponIdx === 0) { 
        bullets.push(new Bullet(this.x, this.y, ang + (Math.random()-0.5)*0.1, 1.2+this.atkBonus*0.5, 16, "#fff000", 3, 1)); 
        this.cd = Math.max(3, 9 - this.rapidMod*0.5); shake = 2; 
      }
      else if (this.weaponIdx === 1) { 
        bullets.push(new Bullet(this.x, this.y, ang, 15+this.atkBonus*1.5+ this.sniperAtkBonus, 38, "#ffffff", 2, this.sniperPierce, true)); 
        this.cd = Math.max(10, 54 - this.rapidMod*2.0); shake = 15; 
      }
      else if (this.weaponIdx === 2) { 
        this.swinging = 12; this.swingStartAng = ang - this.swingArc / 2; 
        this.cd = Math.max(10, 30 - this.rapidMod); 
        shake = 8; this.swingHitList = []; 
      }
      else if (this.weaponIdx === 3) { 
        for(let i=-this.shotgunPelletsBase; i<=this.shotgunPelletsBase; i++) bullets.push(new Bullet(this.x, this.y, ang + i * (0.05 * this.shotgunSpreadRatio) + (Math.random() - 0.5) * (0.15 * this.shotgunSpreadRatio), 2.0+this.atkBonus * 0.5, 18, "#ffaa00", 2.5, 1)); 
        this.cd = Math.max(10, 43 - this.rapidMod*1.5); shake = 10; 
      }
    }

    this.myCrits = this.myCrits.filter(c => Date.now() - c.t < 1000);

    // --- 安全エリア（ストーム）のダメージ処理 ---
    if (isVsMode() && this.hp > 0) {
      if (Math.hypot(this.x - this.safeZoneX, this.y - this.safeZoneY) > this.safeZoneR) {
        this.hp -= 0.5; 
      }
    }

    if (gameStarted && isVsMode() && !isPaused && !isOver) {
      const now = Date.now();
      if (now - this.lastSyncTime >= 33) {
        const myBullets = bullets.map(b => ({x: b.x, y: b.y, r: b.r, col: b.col}));
        const myGrenades = grenades.filter(g => g.owner === myId).map(g => ({x: g.x, y: g.y, blastR: g.blastR, exploded: g.exploded}));
        
        socket.emit('sync_player', { 
          x: this.x, y: this.y, hp: this.hp, maxHp: this.maxHp, ang: ang, name: typeof myPlayerName !== 'undefined' ? myPlayerName : "UNKNOWN", 
          bullets: myBullets, 
          grenades: myGrenades,
          swinging: this.swinging, 
          swingStartAng: this.swingStartAng, 
          swordRange: this.swordRange,
          crits: this.myCrits,
          team: this.team 
        });
        this.lastSyncTime = now;
      }
    }

    if (this.cd > 0) this.cd--;
    if (this.grenadeCd > 0) this.grenadeCd--;
    if (this.swinging > 0) this.swinging--;
    if (this.contactCd > 0) this.contactCd--; 

    document.querySelectorAll('.w-slot').forEach((s, i) => s.className = i === this.weaponIdx ? 'w-slot active' : 'w-slot');
    
    if (hpBar) {
      hpBar.style.width = (this.hp/this.maxHp)*100 + "%"; 
      hpTxt.innerText = `${Math.ceil(this.hp)} / ${this.maxHp}`;
      expBar.style.width = (exp/nextExp)*100 + "%"; 
      expTxt.innerText = `${Math.floor((exp/nextExp)*100)}%`; 
      lvNum.innerText = level;
      scoreVal.innerText = score;
      grenadeVal.innerText = this.grenades;
    }
    
    const btnNode = document.getElementById('btn-grenade');
    if (btnNode) {
      if (this.grenadeCd > 0) {
        const cdPercent = (this.grenadeCd / 150) * 100;
        const completedPercent = 100 - cdPercent;
        btnNode.style.background = `conic-gradient(rgba(0, 242, 255, 0.4) ${completedPercent}%, rgba(0, 0, 0, 0.85) ${completedPercent}%)`;
        btnNode.style.pointerEvents = 'none';
        btnNode.style.opacity = '0.8';
      } else {
        btnNode.style.background = `rgba(0, 242, 255, 0.1)`;
        btnNode.style.pointerEvents = 'auto';
        btnNode.style.opacity = '1.0';
      }
    }
    
    if (isVsMode()) {
      const aliveCount = Object.keys(others).length + (this.hp > 0 ? 1 : 0);
      if (survivorsVal) survivorsVal.innerText = aliveCount;
    }

    // チーム生存者リストの更新
    const teamContainer = document.getElementById('team-status-container');
    const teamList = document.getElementById('team-members-list');
    
    if (gameMode === 'team_vs' && teamContainer && teamList) {
      teamContainer.style.display = 'block';
      
      Object.keys(others).forEach(id => {
        const o = others[id];
        if (o.team === this.team) {
          this.knownTeammates[id] = { name: o.name, isAlive: o.hp > 0 };
        }
      });

      Object.keys(this.knownTeammates).forEach(id => {
        if (!others[id]) {
          this.knownTeammates[id].isAlive = false;
        }
      });

      let html = '';
      const myDisplayName = typeof myPlayerName !== 'undefined' ? myPlayerName : "PLAYER";
      const myAliveStatus = this.hp > 0 ? `<span class="member-alive">ALIVE</span>` : `<span class="member-dead">DEAD</span>`;
      const myNameClass = this.hp > 0 ? "member-name" : "member-name member-dead";
      html += `
        <li class="member-item">
          <span class="${myNameClass}">[YOU] ${myDisplayName}</span>
          ${myAliveStatus}
        </li>
      `;

      Object.values(this.knownTeammates).forEach(mate => {
        const status = mate.isAlive ? `<span class="member-alive">ALIVE</span>` : `<span class="member-dead">DEAD</span>`;
        const nameClass = mate.isAlive ? "member-name" : "member-name member-dead";
        html += `
          <li class="member-item">
            <span class="${nameClass}">${mate.name || "UNKNOWN"}</span>
            ${status}
          </li>
        `;
      });
      
      if (teamList.innerHTML !== html) {
        teamList.innerHTML = html;
      }
    } else if (teamContainer) {
      teamContainer.style.display = 'none'; 
    }
  }

  draw() {
    const px = this.x - camX, py = this.y - camY;
    const ang = Math.atan2(mouseY - py * GAME_SCALE, mouseX - px * GAME_SCALE);

    let myCol = "#00f2ff"; 
    let myRgb = "0, 242, 255";
    if (gameMode === 'team_vs') {
      if (this.team === 'RED') { myCol = "#ff3e3e"; myRgb = "255, 62, 62"; }
      else if (this.team === 'BLUE') { myCol = "#3e82ff"; myRgb = "62, 130, 255"; }
    }

    ctx.save();
    ctx.setLineDash([5, 15]); ctx.strokeStyle = `rgba(${myRgb}, 0.2)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang) * 1200, py + Math.sin(ang) * 1200); ctx.stroke();
    ctx.restore();
    
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    ctx.fillStyle = `rgba(${myRgb}, 0.9)`; ctx.shadowBlur = 15; ctx.shadowColor = myCol;
    ctx.beginPath(); ctx.moveTo(this.r+18, 0); ctx.lineTo(this.r+6, -7); ctx.lineTo(this.r+6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    
    if (this.swinging > 0) {
      const p_val = (12 - this.swinging) / 12, currentAng = this.swingStartAng + p_val * this.swingArc;
      const tipX = px + Math.cos(currentAng) * this.swordRange, tipY = py + Math.sin(currentAng) * this.swordRange;
      
      const grad = ctx.createRadialGradient(px, py, 10, px, py, this.swordRange);
      grad.addColorStop(0, 'transparent'); grad.addColorStop(1, `rgba(${myRgb}, ${0.4 * (1 - p_val * 0.7)})`); 
      ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, this.swordRange, this.swingStartAng, currentAng); ctx.closePath(); ctx.fill();
      
      ctx.save(); ctx.shadowBlur = 15; ctx.shadowColor = myCol;
      const bladeGrad = ctx.createLinearGradient(px, py, tipX, tipY);
      bladeGrad.addColorStop(0.2, `rgba(${myRgb}, 0.5)`); 
      bladeGrad.addColorStop(0.8, "#fff"); 
      bladeGrad.addColorStop(1, "#fff");
      ctx.strokeStyle = bladeGrad; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(px + Math.cos(currentAng) * 5, py + Math.sin(currentAng) * 5); ctx.lineTo(tipX, tipY); ctx.stroke(); ctx.restore();
      
      if (gameMode === 'solo') {
        enemies.forEach(e => {
          if (!this.swingHitList.includes(e) && Math.hypot(e.x-this.x, e.y-this.y) < this.swordRange + e.r) {
            let diff = (Math.atan2(e.y-this.y, e.x-this.x) - this.swingStartAng) % (Math.PI * 2); if (diff < 0) diff += Math.PI * 2;
            if (diff <= p_val * this.swingArc) { 
              let crit = Math.random() < this.critChance ? this.critMult : 1;
              e.hp -= (4 + this.atkBonus) * crit; this.swingHitList.push(e); 
              if(crit > 1) explosions.push(new Explosion(e.x, e.y, 15, "rgba(255, 0, 170, 0.4)", "CRIT!"));
              else { for(let i=0; i<4; i++) particles.push(new Particle(e.x, e.y, myCol)); } 
              if (e.hp <= 0 && !e.dead) e.die();
            }
          }
        });

        nodes.forEach(n => {
          if (!this.swingHitList.includes(n) && Math.hypot(n.x-this.x, n.y-this.y) < this.swordRange + n.r) {
            let diff = (Math.atan2(n.y-this.y, n.x-this.x) - this.swingStartAng) % (Math.PI * 2); if (diff < 0) diff += Math.PI * 2;
            if (diff <= p_val * this.swingArc) { 
              let crit = Math.random() < this.critChance ? this.critMult : 1;
              n.hp -= (4 + this.atkBonus) * crit; this.swingHitList.push(n); 
              if(crit > 1) explosions.push(new Explosion(n.x, n.y, 15, "rgba(255, 0, 170, 0.4)", "CRIT!"));
              else { for(let i=0; i<4; i++) particles.push(new Particle(n.x, n.y, myCol)); } 
              if (n.hp <= 0 && !n.dead) n.die();
            }
          }
        });

      } else if (isVsMode()) {
        Object.keys(others).forEach(id => {
          const o = others[id];
          if (gameMode === 'team_vs' && o.team === this.team) return;

          if (!this.swingHitList.includes(id) && Math.hypot(o.x - this.x, o.y - this.y) < this.swordRange + 13) {
            let diff = (Math.atan2(o.y - this.y, o.x - this.x) - this.swingStartAng) % (Math.PI * 2); if (diff < 0) diff += Math.PI * 2;
            if (diff <= p_val * this.swingArc) { 
              this.swingHitList.push(id); 
              let crit = Math.random() < this.critChance ? this.critMult : 1;
              let dmg = (4 + this.atkBonus) * crit;

              if (o.hp <= dmg) {
                if (!window.myKills) window.myKills = {}; 
                window.myKills[id] = Date.now();
              }

              socket.emit('damage_event', { targetId: id, dmg: dmg });

              if(crit > 1) {
                explosions.push(new Explosion(o.x, o.y, 15, "rgba(255, 0, 170, 0.4)", "CRIT!"));
                this.myCrits.push({ id: Math.random().toString(36).substring(2), x: o.x, y: o.y, t: Date.now() });
              } else {
                for(let i=0; i<4; i++) particles.push(new Particle(o.x, o.y, myCol)); 
              }
            }
          }
        });
      }
    }
    
    if (this.contactCd > 0 && Math.floor(Date.now() / 50) % 2 === 0) {
      ctx.globalAlpha = 0.5;
    }
    ctx.shadowBlur = 10; ctx.shadowColor = myCol; ctx.fillStyle = myCol; ctx.beginPath(); ctx.arc(px, py, this.r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    ctx.globalAlpha = 1.0;
  }
}

class Bullet {
  constructor(x, y, ang, atk, spd, col, r, pierce, isSniper = false) {
    this.x = x; this.y = y; this.vx = Math.cos(ang)*spd; this.vy = Math.sin(ang)*spd;
    this.atk = atk; this.col = col; this.r = r; this.pierce = pierce; this.dead = false; this.hitList = [];
    this.isSniper = isSniper; 
    this.history = []; 
    this.maxHistory = isSniper ? 10 : 4; 
  }
  update() {
    this.history.push({x: this.x, y: this.y});
    if (this.history.length > this.maxHistory) this.history.shift();

    this.x += this.vx; this.y += this.vy;
    
    if (getWall(this.x, this.y)) {
      this.dead = true;
      for(let i=0; i<3; i++) {
        particles.push(new Particle(this.x, this.y, this.col, 0.5));
      }
    }
    
    if (gameMode === 'solo') {
      enemies.forEach(e => {
        if (!this.hitList.includes(e) && Math.hypot(this.x-e.x, this.y-e.y) < e.r + this.r + 5) {
          let blocked = false;
          if (e.type === 'HEAVY' && !this.isSniper) {
            const impactAng = Math.atan2(this.y - e.y, this.x - e.x);
            let diff = (impactAng - e.facingAngle) % (Math.PI * 2);
            if (diff < -Math.PI) diff += Math.PI * 2;
            if (diff > Math.PI) diff -= Math.PI * 2;
            if (Math.abs(diff) <= 0.8) blocked = true;
          }

          if (blocked) {
            this.dead = true;
            for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, "#aaa")); 
          } else {
            let crit = Math.random() < p.critChance ? p.critMult : 1;
            e.hp -= this.atk * crit; this.hitList.push(e); this.pierce--; 
            if (this.pierce <= 0) this.dead = true;
            if (crit > 1) explosions.push(new Explosion(e.x, e.y, 15, "rgba(255, 0, 170, 0.4)", "CRIT!"));
            else { for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, this.col)); }
            if (e.hp <= 0 && !e.dead) e.die();
          }
        }
      });
      nodes.forEach(n => {
        if (!this.hitList.includes(n) && Math.hypot(this.x-n.x, this.y-n.y) < n.r + this.r + 5) {
          let crit = Math.random() < p.critChance ? p.critMult : 1;
          n.hp -= this.atk * crit; this.hitList.push(n); this.pierce--; 
          if (this.pierce <= 0) this.dead = true;
          if (crit > 1) explosions.push(new Explosion(n.x, n.y, 15, "rgba(255, 0, 170, 0.4)", "CRIT!"));
          else { for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, this.col)); }
          if (n.hp <= 0 && !n.dead) n.die();
        }
      });
    } else if (isVsMode()) {
      Object.keys(others).forEach(id => {
        const o = others[id];

        if (gameMode === 'team_vs' && o.team === p.team) return;

        if (!this.hitList.includes(id) && Math.hypot(this.x - o.x, this.y - o.y) < this.r + 13) {
          let crit = Math.random() < p.critChance ? p.critMult : 1;
          let dmg = this.atk * crit;

          if (o.hp <= dmg) {
            if (!window.myKills) window.myKills = {};
            window.myKills[id] = Date.now();
          }

          socket.emit('damage_event', { targetId: id, dmg: dmg });
          this.hitList.push(id);
          this.pierce--;
          if (this.pierce <= 0) this.dead = true;

          if (crit > 1) {
            explosions.push(new Explosion(o.x, o.y, 15, "rgba(255, 0, 170, 0.4)", "CRIT!"));
            p.myCrits.push({ id: Math.random().toString(36).substring(2), x: o.x, y: o.y, t: Date.now() });
          } else {
            for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, this.col));
          }
        }
      });
    }
  }
  draw() { 
    if (this.history.length > 1) {
      ctx.save(); ctx.lineCap = "round";
      for (let i = 1; i < this.history.length; i++) {
        ctx.beginPath();
        ctx.moveTo(this.history[i-1].x - camX, this.history[i-1].y - camY);
        ctx.lineTo(this.history[i].x - camX, this.history[i].y - camY);
        const alpha = (i / this.history.length);
        ctx.globalAlpha = alpha * (this.isSniper ? 0.8 : 0.4);
        ctx.strokeStyle = this.col; ctx.lineWidth = this.r * (this.isSniper ? 1.5 : 0.8); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1.0; ctx.fillStyle = this.col; ctx.beginPath(); ctx.arc(this.x-camX, this.y-camY, this.r, 0, 7); ctx.fill(); 
  }
}

class Explosion {
  constructor(x, y, r, col, text = "", textCol = null) {
    this.x = x; this.y = y; this.r = r; this.col = col; 
    this.timer = 35; 
    this.maxTimer = 35;
    this.text = text;
    this.textCol = textCol || (text === "CRIT!" ? "#ff00aa" : "#2d7d46");
    this.isTakumi = (text === "匠");
  }
  update() { this.timer--; }
  draw() {
    const progress = (this.maxTimer - this.timer) / this.maxTimer; 
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1.0 - progress); 
    ctx.fillStyle = this.col;
    ctx.beginPath(); 
    ctx.arc(this.x - camX, this.y - camY, this.r * (0.9 + progress * 0.15), 0, 7); 
    ctx.fill();
    if (this.text) {
      ctx.save();
      ctx.translate(this.x - camX, this.y - camY);
      const easeOutScale = 1.0 - Math.pow(1.0 - progress, 3);
      
      let baseFontSize = this.isTakumi ? 64 : 16;
      let scale = 1.0 + easeOutScale * (this.isTakumi ? 1.2 : 0.5); 
      
      ctx.scale(scale, scale);
      ctx.fillStyle = this.textCol; 
      ctx.font = `900 ${baseFontSize}px 'Segoe UI', Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowBlur = this.isTakumi ? 20 : 8;
      ctx.shadowColor = this.isTakumi ? "rgba(50, 255, 126, 0.8)" : "rgba(0,0,0,0.6)";
      ctx.fillText(this.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

class Grenade {
  constructor(x, y, ang, owner = 'solo', dmg = 35, range = 280) { 
    this.x = x; this.y = y;
    const dist = 250;
    this.tx = x + Math.cos(ang) * dist;
    this.ty = y + Math.sin(ang) * dist;
    this.timer = 150; this.dead = false; this.exploded = false; 
    this.blastR = range; 
    this.owner = owner;
    this.dmg = dmg;
  }
  update() {
    this.x += (this.tx - this.x) * 0.1;
    this.y += (this.ty - this.y) * 0.1;
    this.timer--;
    if (this.timer <= 0 && !this.exploded) this.explode();
  }
  explode() {
    this.exploded = true; shake = 35;
    explosions.push(new Explosion(this.x, this.y, this.blastR, "rgba(0, 242, 255, 0.4)"));
    if (gameMode === 'solo') {
      enemies.forEach(e => {
        const d = Math.hypot(e.x - this.x, e.y - this.y);
        if (d < this.blastR) {
          e.hp -= this.dmg;
          const ang = Math.atan2(e.y - this.y, e.x - this.x);
          e.x += Math.cos(ang) * (e.type === 'HEAVY' ? 20 : 60); e.y += Math.sin(ang) * (e.type === 'HEAVY' ? 20 : 60);
          if (e.hp <= 0 && !e.dead) e.die();
        }
      });
      nodes.forEach(n => {
        if (Math.hypot(n.x - this.x, n.y - this.y) < this.blastR) {
          n.hp -= this.dmg;
          if (n.hp <= 0 && !n.dead) n.die();
        }
      });
    } else if (isVsMode()) {
      Object.keys(others).forEach(id => {
        const o = others[id];

        if (gameMode === 'team_vs' && o.team === p.team) return;

        if (Math.hypot(o.x - this.x, o.y - this.y) < this.blastR) {
          if (this.owner === myId) {
            if (o.hp <= this.dmg) { 
              if (!window.myKills) window.myKills = {};
              window.myKills[id] = Date.now();
            }
          }
          socket.emit('damage_event', { targetId: id, dmg: this.dmg }); 
        }
      });
    }
    setTimeout(() => { this.dead = true; }, 300);
  }
  draw() {
    const px = this.x - camX, py = this.y - camY;
    if (!this.exploded) {
      ctx.fillStyle = "#00f2ff"; ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(0, 242, 255, 0.3)"; ctx.beginPath(); ctx.arc(px, py, this.blastR, 0, 7); ctx.stroke();
    }
  }
}

class EnemyBullet {
  constructor(x, y, ang, spd, dmg, type) {
    this.x = x; this.y = y; this.vx = Math.cos(ang) * spd; this.vy = Math.sin(ang) * spd;
    this.ang = ang; this.r = type === 'HEAVY' ? 6 : (type === 'SCOUT' ? 3 : 4); 
    this.dead = false; this.dmg = dmg; this.type = type;
  }
  update() {
    this.x += this.vx; this.y += this.vy;
    if (getWall(this.x, this.y)) {
      this.dead = true;
      for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, "#ff3e3e", 0.5)); 
    }
    if (Math.hypot(this.x - p.x, this.y - p.y) < p.r + this.r) { 
      p.hp -= this.dmg; shake = 10; this.dead = true; 
      for(let i=0; i<5; i++) particles.push(new Particle(this.x, this.y, "#ff3e3e")); 
    }
  }
  draw() {
    ctx.save(); ctx.translate(this.x - camX, this.y - camY);
    if (this.type === 'SCOUT') {
      ctx.rotate(this.ang); ctx.shadowBlur = 10; ctx.shadowColor = "#bf00ff"; ctx.fillStyle = "#fff";
      ctx.fillRect(-6, -1, 12, 2); ctx.strokeStyle = "#bf00ff"; ctx.lineWidth = 1; ctx.strokeRect(-6, -1, 12, 2);
    } else if (this.type === 'HEAVY') {
      ctx.fillStyle = '#ff8c00'; ctx.shadowBlur = 12; ctx.shadowColor = "orange"; ctx.beginPath(); ctx.arc(0, 0, this.r, 0, 7); ctx.fill();
    } else { ctx.fillStyle = '#ff3e3e'; ctx.shadowBlur = 8; ctx.shadowColor = "red"; ctx.beginPath(); ctx.arc(0, 0, this.r, 0, 7); ctx.fill(); }
    ctx.restore();
  }
}

class Enemy {
  constructor() {
    const rand = Math.random();
    if (rand < 0.10) {
      this.type = 'HEAVY'; this.r = 22; this.maxHp = 5 + level * 2.5; this.speed = 0.8 + level * 0.05; 
    } else if (rand < 0.25) {
      this.type = 'TICK'; this.r = 8; this.maxHp = 1.2 + level * 0.2; this.speed = 4.0 + level * 0.1; 
      this.blastDmg = 38 + level * 2.0; this.blastR = 130; this.exploding = 0;
    } else if (rand < 0.35) {
      this.type = 'MEDIC'; this.r = 14; this.maxHp = 3.2 + level * 2.0; this.speed = 1.2 + level * 0.1; 
      this.healCd = 120;
    } else if (rand < 0.60) {
      this.type = 'SCOUT'; this.r = 9; this.maxHp = 1.5 + level * 0.8; this.speed = 3.5 + level * 0.1; 
    } else {
      this.type = 'NORMAL'; this.r = 16; this.maxHp = 3 + level * 1.8; this.speed = 1.5 + level * 0.1;  
    }

    let ex, ey; 
    let attempts = 0;
    do { 
      ex = Math.random() * MAP_W * TILE_SIZE; 
      ey = Math.random() * MAP_H * TILE_SIZE; 
      attempts++;
    } while ((isCollide(ex, ey, this.r) || Math.hypot(p.x - ex, p.y - ey) < 600) && attempts < 100);
    
    this.x = ex; this.y = ey;
    this.hp = this.maxHp;
    this.dead = false; this.shootCd = Math.random() * 100; this.angleOffset = Math.random() * Math.PI * 2;
    this.facingAngle = 0; 
    this.path = [];
    this.pathTimer = Math.floor(Math.random() * 30);
  }
  
  die() {
    if (this.dead) return;
    if (this.type === 'TICK') { this.explode(false); } else {
      this.dead = true;
      score += (this.type === 'SCOUT' ? 200 : (this.type === 'HEAVY' ? 300 : (this.type === 'MEDIC' ? 250 : 100)));
      cores.push(new ExpCore(this.x, this.y)); spawnDrop(this.x, this.y);
      explosions.push(new Explosion(this.x, this.y, this.r * 1.8, "rgba(255, 255, 255, 0.4)")); 
      let pCol = this.type === 'HEAVY' ? '#ff8c00' : (this.type === 'SCOUT' ? '#bf00ff' : (this.type === 'MEDIC' ? '#32cd32' : '#ff3e3e'));
      for(let i=0; i<6; i++) particles.push(new Particle(this.x, this.y, pCol, 1.5)); 
    }
  }

  explode(isSelfDestruct = true) {
    this.dead = true; shake = 20;
    if (isSelfDestruct) { 
      explosions.push(new Explosion(this.x, this.y, this.blastR, "rgba(50, 205, 50, 0.6)", "匠")); 
    } else {
      explosions.push(new Explosion(this.x, this.y, this.blastR, "rgba(0, 242, 255, 0.4)"));
    }
    if (isSelfDestruct && Math.hypot(p.x - this.x, p.y - this.y) < this.blastR) {
      p.hp -= this.blastDmg; shake = 30;
    }
    enemies.forEach(e => {
      if (e !== this && !e.dead && Math.hypot(e.x - this.x, e.y - this.y) < this.blastR) {
        e.hp -= 20; 
        if (e.hp <= 0 && !e.dead) e.die();
      }
    });
    if (!isSelfDestruct) {
      score += 150; cores.push(new ExpCore(this.x, this.y)); spawnDrop(this.x, this.y);
    }
  }

  update() {
    if (this.dead) return;
    const distToPlayer = Math.hypot(p.x - this.x, p.y - this.y);
    const angToPlayer = Math.atan2(p.y - this.y, p.x - this.x);
    this.facingAngle = angToPlayer; 

    this.pathTimer--;
    if (this.pathTimer <= 0) {
      this.path = getPath(this.x, this.y, p.x, p.y);
      this.pathTimer = 30 + Math.floor(Math.random() * 15); 
    }

    let vx = 0, vy = 0;

    if (this.type === 'MEDIC') {
      let targetFriend = null;
      let minDist = 9999;

      enemies.forEach(e => {
        if (e !== this && !e.dead && e.hp < e.maxHp) {
          let d = Math.hypot(e.x - this.x, e.y - this.y);
          if (d < minDist) { minDist = d; targetFriend = e; }
        }
      });

      if (!targetFriend) {
        minDist = 9999;
        enemies.forEach(e => {
          if (e !== this && !e.dead) {
            let d = Math.hypot(e.x - this.x, e.y - this.y);
            if (d < minDist) { minDist = d; targetFriend = e; }
          }
        });
      }

      if (targetFriend) {
        if (minDist > 30) {
          const ang = Math.atan2(targetFriend.y - this.y, targetFriend.x - this.x);
          vx = Math.cos(ang) * this.speed; vy = Math.sin(ang) * this.speed;
          this.facingAngle = ang;
        }
      } else {
        vx = -Math.cos(angToPlayer) * this.speed; vy = -Math.sin(angToPlayer) * this.speed;
      }

    } else {
      let moveTargetX = p.x;
      let moveTargetY = p.y;
      if (this.path && this.path.length > 0) {
        let nextNode = this.path[0];
        if (Math.hypot(nextNode.x - this.x, nextNode.y - this.y) < this.r + TILE_SIZE / 2) {
          this.path.shift();
          if (this.path.length > 0) nextNode = this.path[0];
        }
        if (nextNode) { moveTargetX = nextNode.x; moveTargetY = nextNode.y; }
      }
      const targetAng = Math.atan2(moveTargetY - this.y, moveTargetX - this.x);

      if (this.type === 'TICK') {
        if (this.exploding > 0) {
          this.exploding--; if (this.exploding <= 0) this.explode(true); return; 
        } else if (distToPlayer < 40) {
          this.exploding = 40; return;
        } else { vx = Math.cos(targetAng) * this.speed; vy = Math.sin(targetAng) * this.speed; }
      } else if (this.type === 'SCOUT') {
        this.angleOffset += 0.05;
        const targetX = p.x + Math.cos(this.angleOffset) * 200, targetY = p.y + Math.sin(this.angleOffset) * 200;
        const moveAng = Math.atan2(targetY - this.y, targetX - this.x);
        vx = Math.cos(moveAng) * this.speed; vy = Math.sin(moveAng) * this.speed; this.facingAngle = moveAng;
      } else if (this.type === 'HEAVY') {
        const optimalDist = 350;
        if (distToPlayer > optimalDist + 30) { vx = Math.cos(targetAng) * this.speed; vy = Math.sin(targetAng) * this.speed; }
        else if (distToPlayer < optimalDist - 30) { vx = -Math.cos(angToPlayer) * this.speed; vy = -Math.sin(angToPlayer) * this.speed; }
      } else { 
        if (distToPlayer > 120) { vx = Math.cos(targetAng) * this.speed; vy = Math.sin(targetAng) * this.speed; } 
      }
    }

    if (vx !== 0 || vy !== 0) {
      let stuck = isCollide(this.x, this.y, this.r); 
      if (!isCollide(this.x + vx, this.y, this.r) || stuck) this.x += vx; 
      if (!isCollide(this.x, this.y + vy, this.r) || stuck) this.y += vy; 
    }

    if (this.type === 'MEDIC') {
      this.healCd--;
      if (this.healCd <= 0) {
        const healR = 250; let healed = false;
        enemies.forEach(e => {
          if (!e.dead && e.hp < e.maxHp && Math.hypot(e.x - this.x, e.y - this.y) < healR) {
            e.hp = Math.min(e.maxHp, e.hp + (e.maxHp * 0.4)); healed = true;
            for(let i=0; i<3; i++) particles.push(new Particle(e.x, e.y, "#32cd32"));
          }
        });
        if (healed) {
          explosions.push(new Explosion(this.x, this.y, healR, "rgba(50, 205, 50, 0.2)"));
          this.healCd = 120 + Math.random() * 60;
        } else { this.healCd = 30; }
      }
    } else if (this.type !== 'TICK') { 
      const atkRange = this.type === 'HEAVY' ? 900 : 650;
      if (distToPlayer < atkRange) {
        this.shootCd--;
        if (this.shootCd <= 0) {
          const dmg = this.type === 'HEAVY' ? 15 + level * 1.5 : (this.type === 'SCOUT' ? 4 + level * 0.5 : 10 + level * 1.0);
          const bSpd = this.type === 'HEAVY' ? 8.5 + level * 0.2 : 4.5 + level * 0.2;
          enemyBullets.push(new EnemyBullet(this.x, this.y, angToPlayer, bSpd, dmg, this.type));
          this.shootCd = (this.type === 'HEAVY' ? 150 : (this.type === 'SCOUT' ? 20 : 80)) + Math.random() * 60;
        }
      }
    }
  }

  draw() {
    let col = this.type === 'HEAVY' ? '#ff8c00' : (this.type === 'SCOUT' ? '#bf00ff' : (this.type === 'MEDIC' ? '#32cd32' : '#ff3e3e'));
    if (this.type === 'TICK') { col = (this.exploding > 0 && Math.floor(Date.now() / 60) % 2 === 0) ? "#ffffff" : "#006400"; }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(this.x-camX, this.y-camY, this.r, 0, 7); ctx.fill();
    
    if (this.type === 'HEAVY') {
      ctx.save(); ctx.translate(this.x - camX, this.y - camY); ctx.rotate(this.facingAngle);
      ctx.strokeStyle = "rgba(255, 140, 0, 0.8)"; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(0, 0, this.r + 6, -0.8, 0.8); ctx.stroke(); ctx.restore();
    } else if (this.type === 'MEDIC') {
      ctx.save(); ctx.translate(this.x - camX, this.y - camY);
      ctx.fillStyle = "#fff"; ctx.fillRect(-2, -6, 4, 12); ctx.fillRect(-6, -2, 12, 4);
      ctx.restore();
    }
    
    const barW = this.r * 1.5; ctx.fillStyle = "#000"; ctx.fillRect(this.x-camX-barW/2, this.y-camY-this.r-9, barW, 4);
    ctx.fillStyle = col; ctx.fillRect(this.x-camX-barW/2, this.y-camY-this.r-9, barW*(this.hp/this.maxHp), 4);
  }
}

class DataNode {
  constructor() {
    let ex, ey;
    do { ex = Math.random() * MAP_W * TILE_SIZE; ey = Math.random() * MAP_H * TILE_SIZE; } while (getWall(ex, ey) || Math.hypot(p.x - ex, p.y - ey) < 300);
    this.x = ex; this.y = ey; this.r = 15; this.maxHp = 7 + level * 1; this.hp = this.maxHp; this.dead = false; this.pulse = Math.random() * Math.PI * 2;
  }
  update() { this.pulse += 0.05; }
  draw() {
    const px = this.x - camX, py = this.y - camY;
    ctx.save(); ctx.translate(px, py);
    ctx.shadowBlur = 10 + Math.sin(this.pulse) * 5; ctx.shadowColor = "#fff000";
    ctx.fillStyle = "rgba(255, 240, 0, 0.2)"; ctx.strokeStyle = "#fff000"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -this.r); ctx.lineTo(this.r, 0); ctx.lineTo(0, this.r); ctx.lineTo(-this.r, 0); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#000"; ctx.fillRect(-15, -this.r - 8, 30, 4);
    ctx.fillStyle = "#fff000"; ctx.fillRect(-15, -this.r - 8, 30 * (Math.max(0, this.hp) / this.maxHp), 4);
    ctx.restore();
  }
  die() { 
    this.dead = true; score += 50; cores.push(new ExpCore(this.x, this.y)); spawnDrop(this.x, this.y); shake = 5; 
    explosions.push(new Explosion(this.x, this.y, this.r * 1.5, "rgba(255, 255, 255, 0.5)"));
    for(let i=0; i<6; i++) particles.push(new Particle(this.x, this.y, "#fff000", 1.5));
  }
}

class ExpCore {
  constructor(x, y) { this.x = x; this.y = y; this.dead = false; }
  update() { const ang = Math.atan2(p.y-this.y, p.x-this.x); this.x += Math.cos(ang) * 12; this.y += Math.sin(ang) * 12; }
  draw() { ctx.shadowBlur = 10; ctx.shadowColor = "yellow"; ctx.fillStyle = '#fff000'; ctx.beginPath(); ctx.arc(this.x-camX, this.y-camY, 4, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
}

class HealthItem {
  constructor(x, y) { this.x = x; this.y = y; this.dead = false; }
  update() {
    const dist = Math.hypot(p.x - this.x, p.y - this.y);
    if (dist < 50) { const ang = Math.atan2(p.y - this.y, p.x - this.x); this.x += Math.cos(ang) * 12; this.y += Math.sin(ang) * 12; }
    if (dist < 20) { p.hp = Math.min(p.maxHp, p.hp + 20); this.dead = true; shake = 5; }
  }
  draw() {
    ctx.shadowBlur = 15; ctx.shadowColor = "#32ff7e"; ctx.fillStyle = '#32ff7e';
    ctx.fillRect(this.x-camX-2, this.y-camY-6, 4, 12); ctx.fillRect(this.x-camX-6, this.y-camY-2, 12, 4); ctx.shadowBlur = 0;
  }
}

class GrenadeItem {
  constructor(x, y) { this.x = x; this.y = y; this.dead = false; }
  update() {
    const dist = Math.hypot(p.x - this.x, p.y - this.y);
    if (dist < 50) { const ang = Math.atan2(p.y - this.y, p.x - this.x); this.x += Math.cos(ang) * 12; this.y += Math.sin(ang) * 12; }
    if (dist < 20) { p.grenades += 2; this.dead = true; shake = 5; }
  }
  draw() {
    ctx.shadowBlur = 15; ctx.shadowColor = "#00f2ff"; ctx.fillStyle = '#00f2ff';
    ctx.fillRect(this.x-camX-5, this.y-camY-5, 10, 10); ctx.shadowBlur = 0;
  }
}

class Particle {
  constructor(x, y, col, speedMultiplier = 1) {
    this.x = x; this.y = y;
    const ang = Math.random() * Math.PI * 2;
    const spd = (Math.random() * 2 + 1) * speedMultiplier; 
    this.vx = Math.cos(ang) * spd;
    this.vy = Math.sin(ang) * spd;
    this.timer = 10 + Math.random() * 5; 
    this.col = col;
  }
  update() {
    this.x += this.vx; this.y += this.vy;
    this.vx *= 0.9; this.vy *= 0.9;
    this.timer--;
  }
  draw() {
    ctx.fillStyle = this.col;
    ctx.fillRect(this.x - camX - 1, this.y - camY - 1, 2, 2); 
  }
}

// ==========================================
// PLAYER & ARRAY INSTANCES INITIALIZATION
// ==========================================
window.isSpectating = false; 
window.matchEnding = false; 

const p = new Player();
if (!window.myKills) window.myKills = {};
const killLogs = [];

// ==========================================
// HELPER FUNCTIONS (完全なる仕様維持)
// ==========================================

function isVsMode() {
  return gameMode === 'vs' || gameMode === 'solo_vs' || gameMode === 'team_vs';
}

function spawnDrop(x, y) {
  const r = Math.random();
  let type = null;
  if (r < 0.15) type = 'health';
  else if (r < 0.25) type = 'grenade';
  
  if (type) {
    if (isVsMode()) {
      socket.emit('spawn_drop', { type: type, x: x, y: y });
    } else {
      if (type === 'health') items.push(new HealthItem(x, y));
      else if (type === 'grenade') items.push(new GrenadeItem(x, y));
    }
  }
}

function updateInputs() {
  const nameVal = document.getElementById('player-name').value.trim();
  myPlayerName = nameVal !== "" ? nameVal : "ANONYMOUS";
  const codeVal = document.getElementById('room-code').value.trim();
  currentRoomCode = codeVal !== "" ? codeVal : "public"; 
}

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

// --- Socket.io Lobby ---
function joinLobby() {
  updateInputs();
  startScreen.style.display = 'none';
  document.getElementById('lobby-screen').style.display = 'flex';
  document.getElementById('lobby-title').innerText = `VS LOBBY [${currentRoomCode}]`;
  document.getElementById('lobby-players').innerHTML = "CONNECTING TO SERVER...";
  inLobby = true;
  
  socket.emit('join_lobby', { roomCode: currentRoomCode, playerName: myPlayerName, myId, selectedTeam: mySelectedTeam });
}

function updateModeUI(mode) {
  const btn = document.getElementById('mode-toggle-btn');
  if (!btn) return;
  if (mode === 'team_vs') {
    btn.innerText = 'TEAM MATCH';
    btn.className = 'team-btn';
  } else {
    btn.innerText = 'BATTLE ROYALE';
    btn.className = 'vs-btn';
  }
}

window.cycleTeam = function(direction) {
  const teams = ['AUTO', 'RED', 'BLUE'];
  let idx = teams.indexOf(mySelectedTeam);
  if (idx === -1) idx = 0;
  idx = (idx + direction + teams.length) % teams.length;
  mySelectedTeam = teams[idx];
  socket.emit('change_team', { team: mySelectedTeam });
};

window.toggleGameMode = function() {
  const newMode = (currentLobbyMode === 'solo_vs') ? 'team_vs' : 'solo_vs';
  socket.emit('toggle_mode', newMode);
};

window.startVsMatchWithMode = function() {
  generateMap();
  socket.emit('start_match', { mapData: map, mode: currentLobbyMode });
};

function leaveLobby() {
  inLobby = false;
  socket.disconnect(); socket.connect();
  document.getElementById('lobby-screen').style.display = 'none';
  startScreen.style.display = 'flex';
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
  sharedNodes = {}; sharedDrops = {};
  Object.keys(others).forEach(id => delete others[id]);

  p.reset();
  startScreen.style.display = 'none'; overScreen.style.display = 'none'; victoryScreen.style.display = 'none'; pauseScreen.style.display = 'none';
  uiLayer.style.display = 'flex'; btnGrenade.style.display = 'flex';
  document.getElementById('minimap-container').style.display = 'block';
  document.getElementById('exp-group').style.visibility = 'visible';
  survivorsContainer.style.display = (gameMode === 'solo_vs' || gameMode === 'team_vs') ? 'block' : 'none';

  let rx, ry, px, py;
  let attempts = 0;
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
    window.pendingLevelUps = 49; isPaused = true; level++; nextExp += 5; openPanel();
  }
  loop();
}

function triggerVictory() {
  isVictory = true; isOver = true;
  if(levelUpTimeout) { clearTimeout(levelUpTimeout); levelUpTimeout = null; }
  isLevelUpInvincible = false;
  if (gameMode === 'solo') submitSoloScore();
  victoryScoreVal.innerText = score; victoryScreen.style.display = 'flex'; uiLayer.style.display = 'none'; btnGrenade.style.display = 'none';
  if(document.getElementById('move-base')) document.getElementById('move-base').style.display = 'none';
  if(document.getElementById('aim-base')) document.getElementById('aim-base').style.display = 'none';
}

function backToTitle() {
  if(levelUpTimeout) { clearTimeout(levelUpTimeout); levelUpTimeout = null; }
  isLevelUpInvincible = false;
  socket.disconnect(); socket.connect();
  gameStarted = false; isPaused = true; isOver = false; isVictory = false; vsMatchActive = false; isSpectating = false; window.isSpectating = false;
  const btnLeave = document.getElementById('btn-leave-spectate'); if (btnLeave) btnLeave.style.display = 'none';
  if(loopId) { cancelAnimationFrame(loopId); loopId = null; }

  overScreen.style.display = 'none'; victoryScreen.style.display = 'none'; pauseScreen.style.display = 'none'; uiLayer.style.display = 'none'; btnGrenade.style.display = 'none'; lvlPanel.style.display = 'none';
  document.getElementById('minimap-container').style.display = 'none'; document.getElementById('lobby-screen').style.display = 'none';
  if(document.getElementById('move-base')) document.getElementById('move-base').style.display = 'none';
  if(document.getElementById('aim-base')) document.getElementById('aim-base').style.display = 'none';
  startScreen.style.display = 'flex';
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, w, h);
}

function togglePause() {
  if (isOver || !gameStarted || lvlPanel.style.display === 'block') return;
  isPaused = !isPaused; pauseScreen.style.display = isPaused ? 'flex' : 'none';
}

function joinMidMatchSpectator() {
  startScreen.style.display = 'none'; document.getElementById('lobby-screen').style.display = 'none';
  socket.emit('join_spectator', { roomCode: currentRoomCode, myId });
}

function startSpectate() {
  window.isSpectating = true; window.matchEnding = false; isOver = false; overScreen.style.display = 'none';
  const viewScale = GAME_SCALE * 0.8;
  camX = p.x - (w / 2) / viewScale; camY = p.y - (h / 2) / viewScale;
  const btnLeave = document.getElementById('btn-leave-spectate'); if (btnLeave) btnLeave.style.display = 'block';
  if (survivorsContainer) { survivorsContainer.style.display = 'block'; survivorsContainer.style.zIndex = '100'; }
  const minimapCont = document.getElementById('minimap-container'); if (minimapCont) { minimapCont.style.display = 'block'; minimapCont.style.zIndex = '100'; }
  if('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    const moveBase = document.getElementById('move-base'); if (moveBase) moveBase.style.display = 'block';
  }
}

// --- Chat functions ---
function escapeHTML(str) { return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)); }
function autoLink(text) { const urlRegex = /(https?:\/\/[^\s]+)/g; return text.replace(urlRegex, url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`); }
function formatTime(t) { if(!t) return ""; const d = new Date(t); return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')} ${String(d.getMinutes()).padStart(2,'0')}`; }

// --- Game loops & Minimap rendering (完全移植) ---
function drawMinimap() {
  const center = 80, scale = 0.12;
  mCtx.clearRect(0,0,160,160);
  mCtx.fillStyle = "rgba(0, 20, 30, 0.9)"; mCtx.beginPath(); mCtx.arc(center, center, 80, 0, Math.PI*2); mCtx.fill();
  mCtx.save(); mCtx.translate(center, center); mCtx.beginPath(); mCtx.arc(0,0,80, 0, Math.PI*2); mCtx.clip();
  mCtx.fillStyle = "rgba(255,255,255,0.15)";
  
  const viewScale = window.isSpectating ? GAME_SCALE*0.8 : GAME_SCALE;
  const cx = window.isSpectating ? camX + (w/2)/viewScale : p.x, cy = window.isSpectating ? camY + (h/2)/viewScale : p.y;

  for(let y=0; y<MAP_H; y++) for(let x=0; x<MAP_W; x++) if(map[y] && map[y][x]) {
    const dX = (x*TILE_SIZE + TILE_SIZE/2 - cx)*scale, dY = (y*TILE_SIZE + TILE_SIZE/2 - cy)*scale;
    if(Math.hypot(dX, dY) < 90) mCtx.fillRect(dX-4, dY-4, 8, 8);
  }
  if (gameMode === 'solo') {
    enemies.forEach(e => { const d = Math.hypot((e.x-cx)*scale, (e.y-cy)*scale); if (d < 80) { mCtx.fillStyle = (e.type==='HEAVY')?'#ff8c00':((e.type==='TICK')?'#006400':'#ff3e3e'); mCtx.beginPath(); mCtx.arc((e.x-cx)*scale, (e.y-cy)*scale, 3, 0, 7); mCtx.fill(); } });
    nodes.forEach(n => { const dx = (n.x-cx)*scale, dy = (n.y-cy)*scale; mCtx.fillStyle = "#fff000"; if(Math.hypot(dx,dy) < 80) mCtx.fillRect(dx-3, dy-3, 6, 6); });
  } else {
    Object.values(sharedNodes).forEach(n => { const dx = (n.x-cx)*scale, dy = (n.y-cy)*scale; mCtx.fillStyle = "#fff000"; if(Math.hypot(dx,dy) < 80) mCtx.fillRect(dx-3, dy-3, 6, 6); });
  }
  Object.values(others).forEach(o => { const dx = (o.x-cx)*scale, dy = (o.y-cy)*scale; mCtx.fillStyle = (gameMode==='team_vs') ? (o.team==='RED'?'#ff3e3e':'#3e82ff') : "#32ff7e"; if(Math.hypot(dx,dy) < 80) mCtx.fillRect(dx-2, dy-2, 4, 4); });
  
  if (isVsMode() && p.safeZoneR !== undefined) {
    const sdx = (p.safeZoneX - cx)*scale, sdy = (p.safeZoneY - cy)*scale, sdr = Math.max(0, p.safeZoneR*scale);
    mCtx.fillStyle = "rgba(255, 0, 0, 0.35)"; mCtx.beginPath(); mCtx.arc(0,0,80,0,Math.PI*2); mCtx.arc(sdx,sdy,sdr,0,Math.PI*2,true); mCtx.fill();
    mCtx.strokeStyle = "#ff0055"; mCtx.lineWidth = 1.5; mCtx.beginPath(); mCtx.arc(sdx,sdy,sdr,0,Math.PI*2); mCtx.stroke();
  }
  mCtx.restore();
  mCtx.fillStyle = (gameMode==='team_vs') ? (p.team==='RED'?'#ff3e3e':'#3e82ff') : "#00f2ff";
  if (!window.isSpectating) { mCtx.beginPath(); mCtx.arc(center,center,4,0,7); mCtx.fill(); }
}

function loop() {
  if (!gameStarted) return;
  if (isVsMode() && p.matchStartTime) {
    const sSec = (Date.now() - p.matchStartTime)/1000, initR = Math.max(MAP_W, MAP_H)*TILE_SIZE, minR = 600;
    p.safeZoneX = (MAP_W*TILE_SIZE)/2; p.safeZoneY = (MAP_H*TILE_SIZE)/2;
    if (sSec < 300) p.safeZoneR = initR; else { const pct = Math.min(1, (sSec-300)/300); p.safeZoneR = initR - (initR - minR)*pct; }
  }
  if (isOver || isPaused) { loopId = requestAnimationFrame(loop); return; }
  shake *= 0.88; ctx.fillStyle = "#050505"; ctx.fillRect(0,0,w,h);
  
  const viewScale = window.isSpectating ? GAME_SCALE*0.8 : GAME_SCALE;
  ctx.save(); ctx.scale(viewScale, viewScale);
  if (shake > 0.5) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);

  const sX = Math.max(0, Math.floor(camX/TILE_SIZE)), sY = Math.max(0, Math.floor(camY/TILE_SIZE)), eX = Math.min(MAP_W, sX+Math.ceil((w/viewScale)/TILE_SIZE)+1), eY = Math.min(MAP_H, sY+Math.ceil((h/viewScale)/TILE_SIZE)+1);
  for(let y=sY; y<eY; y++) for(let x=sX; x<eX; x++) if(map[y] && map[y][x]) { ctx.fillStyle = "#2a2a2a"; ctx.fillRect(x*TILE_SIZE-camX, y*TILE_SIZE-camY, TILE_SIZE, TILE_SIZE); ctx.strokeStyle = "#444"; ctx.lineWidth = 1; ctx.strokeRect(x*TILE_SIZE-camX, y*TILE_SIZE-camY, TILE_SIZE, TILE_SIZE); }

  if (isVsMode() && p.safeZoneR !== undefined) {
    ctx.save(); const sx = p.safeZoneX - camX, sy = p.safeZoneY - camY;
    ctx.fillStyle = "rgba(255, 0, 0, 0.25)"; ctx.beginPath(); ctx.rect(0,0,w,h); ctx.arc(sx,sy,p.safeZoneR,0,Math.PI*2,true); ctx.fill();
    ctx.strokeStyle = "#ff0055"; ctx.lineWidth = 4; ctx.setLineDash([15, 10]); ctx.beginPath(); ctx.arc(sx,sy,p.safeZoneR,0,Math.PI*2); ctx.stroke();
    if (!window.isSpectating && Math.hypot(p.x-p.safeZoneX, p.y-p.safeZoneY) > p.safeZoneR && p.hp > 0) { ctx.fillStyle = `rgba(255,0,0,${0.1 + Math.abs(Math.sin(Date.now()/150))*0.2})`; ctx.fillRect(0,0,w,h); }
    ctx.restore();
  }

  if (!window.isSpectating) { p.update(); p.draw(); }
  else {
    let s = 10; if (keys['KeyW']) camY -= s; if (keys['KeyS']) camY += s; if (keys['KeyA']) camX -= s; if (keys['KeyD']) camX += s;
    if (typeof touchMoveDir !== 'undefined' && (touchMoveDir.x !== 0 || touchMoveDir.y !== 0)) { camX += touchMoveDir.x*s; camY += touchMoveDir.y*s; }
  }

  if (isVsMode()) {
    Object.keys(sharedDrops).forEach(did => {
      const drop = sharedDrops[did], dx = drop.x - camX, dy = drop.y - camY;
      if (drop.type === 'health') { ctx.shadowBlur = 15; ctx.shadowColor = "#32ff7e"; ctx.fillStyle = '#32ff7e'; ctx.fillRect(dx-2, dy-6, 4, 12); ctx.fillRect(dx-6, dy-2, 12, 4); ctx.shadowBlur = 0; }
      else { ctx.shadowBlur = 15; ctx.shadowColor = "#00f2ff"; ctx.fillStyle = '#00f2ff'; ctx.fillRect(dx-5, dy-5, 10, 10); ctx.shadowBlur = 0; }
      if (!window.isSpectating && Math.hypot(p.x - drop.x, p.y - drop.y) < 50 && p.hp > 0 && !isOver) { socket.emit('pickup_drop', { dropId: did }); }
    });

    Object.keys(sharedNodes).forEach(nid => {
      const n = sharedNodes[nid], nx = n.x, ny = n.y;
      ctx.save(); ctx.translate(nx-camX, ny-camY); ctx.fillStyle = "rgba(255,240,0,0.15)";
      ctx.beginPath(); ctx.moveTo(0,-21); ctx.lineTo(21,0); ctx.lineTo(0,21); ctx.lineTo(-21,0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,240,0,0.2)"; ctx.strokeStyle = "#fff000"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0,-15); ctx.lineTo(15,0); ctx.lineTo(0,15); ctx.lineTo(-15,0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#000"; ctx.fillRect(-15, -23, 30, 4); ctx.fillStyle = "#fff000"; ctx.fillRect(-15,-23,30*(Math.max(0, n.hp)/n.maxHp), 4); ctx.restore();

      bullets.forEach(b => {
        if (!b.dead && !b.hitList.includes(nid) && Math.hypot(b.x-nx, b.y-ny) < 15 + b.r + 5) {
          b.hitList.push(nid); b.pierce--; if (b.pierce <= 0) b.dead = true;
          let crit = Math.random() < p.critChance ? p.critMult : 1;
          socket.emit('damage_node', { nodeId: nid, dmg: b.atk * crit });
          if (crit > 1) {
            explosions.push(new Explosion(nx, ny, 15, "rgba(255,0,170,0.4)", "CRIT!"));
            if(!window.isSpectating) p.myCrits.push({ id: Math.random().toString(36).substring(2), x: nx, y: ny, t: Date.now() });
          } else if(!window.isSpectating) { for(let i=0; i<3; i++) particles.push(new Particle(b.x, b.y, b.col)); }
        }
      });
      
      if (!window.isSpectating && p.swinging > 0 && !p.swingHitList.includes(nid) && Math.hypot(nx - p.x, ny - p.y) < p.swordRange + 15) {
        let diff = (Math.atan2(ny - p.y, nx - p.x) - p.swingStartAng) % (Math.PI * 2); if (diff < 0) diff += Math.PI * 2;
        if (diff <= ((12 - p.swinging) / 12) * p.swingArc) {
          p.swingHitList.push(nid);
          let crit = Math.random() < p.critChance ? p.critMult : 1;
          socket.emit('damage_node', { nodeId: nid, dmg: (4 + p.atkBonus) * crit });
          if (crit > 1) {
            explosions.push(new Explosion(nx, ny, 15, "rgba(255, 0, 170, 0.4)", "CRIT!"));
            p.myCrits.push({ id: Math.random().toString(36).substring(2), x: nx, y: ny, t: Date.now() });
          } else {
            for(let i=0; i<4; i++) particles.push(new Particle(nx, ny, "#00f2ff"));
          }
        }
      }
    });

    const pList = Object.keys(others); pList.push(myId); pList.sort();
    let maxN = p.safeZoneR !== undefined ? Math.floor(3 + ((p.safeZoneR-400)/2800)*7) : 10;
    if (pList[0] === myId && Math.random() < 0.02 && Object.keys(sharedNodes).length < Math.max(3, maxN)) {
      let ex, ey, valid = false, att = 0;
      do { ex = Math.random()*MAP_W*TILE_SIZE; ey = Math.random()*MAP_H*TILE_SIZE; valid = !getWall(ex, ey); if(valid && p.safeZoneR!==undefined && Math.hypot(ex-p.safeZoneX, ey-p.safeZoneY) > p.safeZoneR*0.9) valid = false; att++; } while (!valid && att<100);
      if (valid) {
        const id = 'n_' + Math.random().toString(36).substring(2,9);
        socket.emit('spawn_node', { id, x: ex, y: ey, hp: 7+level, maxHp: 7+level });
      }
    }
  }

  Object.keys(others).forEach(id => {
    const o = others[id]; if (o.targetX !== undefined) { o.x += (o.targetX-o.x)*0.3; o.y += (o.targetY-o.y)*0.3; }
    if (o.targetAng !== undefined) { let diff = o.targetAng-o.ang; while(diff<-Math.PI) diff+=Math.PI*2; while(diff>Math.PI) diff-=Math.PI*2; o.ang += diff*0.3; }
    const ox = o.x-camX, oy = o.y-camY;
    let color = (gameMode==='team_vs') ? (o.team==='RED'?'#ff3e3e':'#3e82ff') : "#32ff7e";
    
    ctx.save(); ctx.translate(ox, oy); ctx.rotate(o.ang); ctx.fillStyle = color; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(18,0); ctx.lineTo(6,-7); ctx.lineTo(6,7); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.globalAlpha = 1.0; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(ox, oy, 13, 0, 7); ctx.fill();
    ctx.fillStyle = "#000"; ctx.fillRect(ox-15, oy-25, 30, 4); ctx.fillStyle = color; ctx.fillRect(ox-15, oy-25, 30*(o.hp/o.maxHp), 4);
    ctx.fillStyle = "#fff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.fillText(o.name || "UNKNOWN", ox, oy - 32);

    if (o.bullets) o.bullets.forEach(b => { ctx.fillStyle = b.col; ctx.beginPath(); ctx.arc(b.x-camX, b.y-camY, b.r, 0, 7); ctx.fill(); });
    if (o.swinging > 0) {
      const pct = (12-o.swinging)/12, cur = o.swingStartAng + pct*Math.PI*1.2, tx = ox+Math.cos(cur)*o.swordRange, ty = oy+Math.sin(cur)*o.swordRange;
      const grad = ctx.createRadialGradient(ox,oy,10,ox,oy,o.swordRange); grad.addColorStop(0,'transparent'); grad.addColorStop(1,`rgba(255,255,255,${0.4*(1-pct*0.7)})`);
      ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(ox,oy); ctx.arc(ox,oy,o.swordRange, o.swingStartAng, cur); ctx.closePath(); ctx.fill();
    }
  });

  if (gameMode === 'solo' && enemies.length < 7 + Math.floor(level/1.1)) enemies.push(new Enemy());

  [bullets, enemyBullets, cores, items, enemies, grenades, nodes, explosions, particles].forEach(arr => {
    for(let i=arr.length-1; i>=0; i--) {
      arr[i].update(); arr[i].draw();
      if (arr === cores && !window.isSpectating && Math.hypot(p.x-arr[i].x, p.y-arr[i].y) < 25) {
        arr[i].dead = true; exp++; if(exp >= nextExp) { level++; exp=0; nextExp+=5; isPaused=true; openPanel(); }
      }
      if (arr === enemies && !window.isSpectating && arr[i].type !== 'TICK' && Math.hypot(p.x-arr[i].x, p.y-arr[i].y) < p.r+arr[i].r) {
        if (p.contactCd <= 0) { p.hp -= (3 + level*0.5); p.contactCd = 30; shake = 10; }
      }
      if (arr[i].dead || (arr[i].timer !== undefined && arr[i].timer <= 0 && arr !== grenades)) arr.splice(i, 1);
    }
  });

  ctx.restore();
  drawMinimap();

  if (isVsMode() && window.isSpectating && vsMatchActive) {
    const sIds = Object.keys(others);
    let matchOver = false, winner = "DRAW";
    if (gameMode === 'team_vs') {
      const aliveTeams = new Set(sIds.map(id => others[id].team).filter(t => t));
      if (aliveTeams.size <= 1 && !window.matchEnding) {
        matchOver = true; winner = aliveTeams.size === 1 ? `${[...aliveTeams][0]} TEAM WIN!` : "DRAW (ANNIHILATED)";
      }
    } else {
      if (sIds.length <= 1 && !window.matchEnding) {
        matchOver = true; winner = sIds.length === 1 ? others[sIds[0]].name : "DRAW";
      }
    }
    if (matchOver) {
      window.matchEnding = true;
      let finish = document.getElementById('match-finish-screen');
      if (!finish) {
        finish = document.createElement('div'); finish.id = 'match-finish-screen';
        finish.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:9999;";
        finish.innerHTML = `<h1 style="color:var(--cyan); font-size:48px; text-shadow:0 0 20px var(--cyan); margin-bottom:10px;">MATCH FINISHED</h1><div class="final-score-display" id="match-winner-name">WINNER: <span>${winner}</span></div><button id="btn-spec-back">RETURN TO TITLE</button>`;
        document.body.appendChild(finish);
        document.getElementById('btn-spec-back').onclick = () => { finish.style.display = 'none'; window.matchEnding = false; backToTitle(); };
      } else { document.getElementById('match-winner-name').innerHTML = `WINNER: <span>${winner}</span>`; finish.style.display = 'flex'; }
    }
  }

  if (p.hp <= 0 && !isOver && !window.isSpectating) {
    isOver = true; if(levelUpTimeout) clearTimeout(levelUpTimeout);
    if (gameMode === 'solo') submitSoloScore();
    socket.emit('player_death', { deadPlayerId: myId });
    finalScoreVal.innerText = score; overScreen.style.display = 'flex'; overScreen.style.zIndex = '9999';
    uiLayer.style.display = 'none'; btnGrenade.style.display = 'none';
    const btnSpec = document.getElementById('btn-spectate'); if (btnSpec) btnSpec.style.display = isVsMode() ? 'inline-block' : 'none';
  }

  loopId = requestAnimationFrame(loop);
}

function openPanel() {
  lvlPanel.style.display = 'block'; cardWrap.innerHTML = ''; isLevelUpInvincible = true;
  const choices = [...UPGRADES].sort(()=>0.5-Math.random()).slice(0,3);
  const select = (u, e) => {
    if(levelUpTimeout) clearTimeout(levelUpTimeout); isLevelUpInvincible = false; u.action();
    if(e) e.stopPropagation();
    if (window.pendingLevelUps && window.pendingLevelUps > 0) { window.pendingLevelUps--; level++; nextExp += 5; openPanel(); }
    else { isPaused = false; lvlPanel.style.display = 'none'; }
  };
  choices.forEach(u => {
    const c = document.createElement('div'); c.className = 'card'; c.innerHTML = `<h2>${u.name}</h2><p>${u.desc}</p>`;
    c.onclick = (e) => select(u, e); cardWrap.appendChild(c);
  });
  if(levelUpTimeout) clearTimeout(levelUpTimeout);
  levelUpTimeout = setTimeout(() => { if (lvlPanel.style.display === 'block') select(choices[0], null); }, 10000);
}

// ==========================================
// SOCKET.IO EVENT LISTENERS (定義順依存クラッシュを防止)
// ==========================================

socket.on('lobby_update', (data) => {
  if (!inLobby) return;
  lastLobbyData = data;
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
});

socket.on('mode_update', (mode) => {
  currentLobbyMode = mode;
  updateModeUI(mode);
});

socket.on('state_update', (state) => {
  if (inLobby && state === 'playing') {
    inLobby = false;
    document.getElementById('lobby-screen').style.display = 'none';
    startGame(currentLobbyMode);
  }
});

socket.on('map_update', (serverMap) => {
  if (serverMap) { for (let y = 0; y < MAP_H; y++) map[y] = [...serverMap[y]]; }
});

socket.on('match_started', ({ mode }) => {
  inLobby = false;
  document.getElementById('lobby-screen').style.display = 'none';
  startGame(mode);
});

socket.on('teams_update', (teams) => {
  roomTeams = teams;
  myTeam = teams[myId] || 'RED';
  p.team = myTeam;
});

socket.on('players_update', (serverPlayers) => {
  if (!gameStarted) return;
  let opponentCount = 0;
  Object.keys(serverPlayers).forEach(id => {
    if (id !== myId) {
      if (!others[id]) {
        others[id] = serverPlayers[id];
        others[id].targetX = serverPlayers[id].x; others[id].targetY = serverPlayers[id].y; others[id].targetAng = serverPlayers[id].ang;
      } else {
        const cx = others[id].x, cy = others[id].y, cang = others[id].ang;
        others[id] = serverPlayers[id];
        others[id].targetX = serverPlayers[id].x; others[id].targetY = serverPlayers[id].y; others[id].targetAng = serverPlayers[id].ang;
        others[id].x = cx; others[id].y = cy; others[id].ang = cang;
      }
      if (gameMode === 'team_vs') {
        others[id].team = roomTeams[id];
        if (roomTeams[id] !== myTeam) opponentCount++;
      } else { opponentCount++; }
    }
  });

  if (serverPlayers[myId] && Object.keys(serverPlayers).length > 1) vsMatchActive = true;
  if ((gameMode === 'solo_vs' || gameMode === 'team_vs') && vsMatchActive && opponentCount === 0 && p.hp > 0 && !isOver && !isVictory) {
    triggerVictory();
  }
});

socket.on('player_disconnected', (id) => { delete others[id]; });
socket.on('player_dead', (id) => { delete others[id]; });
socket.on('take_damage', ({ targetId, dmg }) => {
  if (targetId === myId) {
    if (isLevelUpInvincible) return;
    p.hp = Math.max(0, p.hp - dmg); shake = 10;
  }
});

socket.on('global_chat_history', (history) => {
  const m = document.getElementById('start-chat-messages'); if (!m) return; m.innerHTML = ''; history.forEach(d => addChatDOM(m, d));
});
socket.on('global_chat_received', (d) => { const m = document.getElementById('start-chat-messages'); if (m) addChatDOM(m, d); });
socket.on('chat_history', (history) => {
  const m = document.getElementById('chat-messages'); if (!m) return; m.innerHTML = ''; history.forEach(d => addChatDOM(m, d));
});
socket.on('chat_received', (d) => { const m = document.getElementById('chat-messages'); if (m) addChatDOM(m, d); });

socket.on('node_spawned', (node) => { sharedNodes[node.id] = node; });
socket.on('node_updated', ({ nodeId, hp }) => { if (sharedNodes[nodeId]) sharedNodes[nodeId].hp = hp; });
socket.on('node_destroyed', ({ nodeId, x, y }) => {
  delete sharedNodes[nodeId]; score += 50; shake = 5;
  cores.push(new ExpCore(x, y)); explosions.push(new Explosion(x, y, 25, "rgba(255, 255, 255, 0.5)"));
  for(let i=0; i<6; i++) particles.push(new Particle(x, y, "#fff000", 1.5));
});
socket.on('node_list_update', (list) => { sharedNodes = list; });
socket.on('drop_spawned', ({ dropId, dropData }) => { sharedDrops[dropId] = dropData; });
socket.on('drop_picked', ({ dropId, drop }) => {
  delete sharedDrops[dropId];
  if (drop.type === 'health') items.push(new HealthItem(drop.x, drop.y));
  else if (drop.type === 'grenade') items.push(new GrenadeItem(drop.x, drop.y));
});
socket.on('drop_list_update', (list) => { sharedDrops = list; });
socket.on('room_reset_by_admin', () => { alert("Room force reset by Admin."); backToTitle(); });

// ==========================================
// DOM & WINDOW EVENT LISTENERS
// ==========================================

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
  if (typeof p === 'undefined' || !p) return;
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
        mouseX = (p.x - camX) * GAME_SCALE + touchAimDir.x * 200; mouseY = (p.y - camY) * GAME_SCALE + touchAimDir.y * 200;
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

// 管理者ショートカット (cキー + Admin826)
document.addEventListener('keydown', (e) => {
  if (e.key === 'c') {
    const pName = document.getElementById('player-name').value.trim();
    if (pName === "Admin826") {
      e.preventDefault();
      const target = prompt("強制リセットする部屋のコードを入力してください:");
      if (target && target.trim() !== "") {
        socket.emit('admin_reset_room', target.trim());
      }
    }
  }
});

window.onload = () => { ctx.fillStyle = "#050505"; ctx.fillRect(0,0,w,h); };
