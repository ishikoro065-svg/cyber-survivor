// --- Firebase Config & Socket.io ---
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
} catch(e) { console.log("Firebase Connection skipped."); }

// --- Socket.io クラッシュ防止用安全接続処理 ---
let socket = null;
if (typeof io !== 'undefined') {
  try {
    socket = io();
  } catch(e) {
    console.warn("Socket.io connection failed, falling back to dummy socket.", e);
  }
}

if (!socket) {
  console.warn("io is not defined or socket.io connection failed. Solo mode remains active.");
  // 通信エラー時でも全体が停止しないよう、モック（ダミー）関数に置換
  socket = {
    on: function(event, callback) {
      console.log(`[Dummy Socket] registered listener for: ${event}`);
    },
    emit: function(event, data) {
      console.log(`[Dummy Socket] emitted: ${event}`, data);
    },
    disconnect: function() {},
    connect: function() {}
  };
}

let inLobby = false;       
let currentRoomCode = "public"; 
let isSpectating = false; 

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
// CLASSES DEFINITION
// ==========================================

class Player {
  constructor() { this.reset(); }
  reset() {
    this.x = 0; this.y = 0; this.r = 13; this.hp = 100; this.maxHp = 100;
    this.speed = 4.0; this.weaponIdx = 0; this.cd = 0; this.atkBonus = 0; this.sniperAtkBonus = 0; this.rapidMod = 0;
    this.sniperPierce = 3; this.swordRange = 90; this.swinging = 0; this.swingStartAng = 0;
    this.swingArc = Math.PI * 1.2; this.swingHitList = []; this.grenades = 3; this.grenadeCd = 0; this.contactCd = 0;
    this.shotgunPelletsBase = 2; this.shotgunSpreadRatio = 1.0; this.critChance = 0.05; this.critMult = 2.0;
    this.myCrits = []; this.regen = 0; this.matchStartTime = Date.now(); this.safeZoneR = 9999; this.safeZoneX = 0; this.safeZoneY = 0;
    this.lastSyncTime = 0; this.team = ''; this.knownTeammates = {};
  }
  throwGrenade() {
    if (this.grenades > 0 && this.grenadeCd <= 0) {
      const px = (this.x - camX) * GAME_SCALE, py = (this.y - camY) * GAME_SCALE;
      const ang = Math.atan2(mouseY - py, mouseX - px);
      const dmg = 35 + (this.atkBonus || 0) * 15;
      const range = 280 + (this.grenadeRangeBonus || 0);
      grenades.push(new Grenade(this.x, this.y, ang, myId, dmg, range));
      this.grenades--; this.grenadeCd = 150;
    }
  }
  update() {
    if (this.regen > 0 && this.hp < this.maxHp && this.hp > 0) this.hp = Math.min(this.maxHp, this.hp + this.regen);
    let speed = this.speed;
    if (this.weaponIdx === 2) { if (this.swinging > 0 || this.cd > 0) speed *= 0.7; }
    else if (this.swinging > 0) speed *= 0.7; else if (this.cd > 0) {
      if (this.weaponIdx === 1) speed *= 0.7; else if (this.weaponIdx === 3) speed *= 0.75; else if (this.weaponIdx === 0) speed *= 0.85;
    }
    let mx = 0, my = 0;
    if (keys['KeyW'] || keys['ArrowUp']) my -= 1; if (keys['KeyS'] || keys['ArrowDown']) my += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1; if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
    if (typeof touchMoveDir !== 'undefined' && (touchMoveDir.x !== 0 || touchMoveDir.y !== 0)) { mx = touchMoveDir.x; my = touchMoveDir.y; }
    if (mx !== 0 || my !== 0) {
      const mag = Math.hypot(mx, my);
      const vx = (mx / mag) * speed, vy = (my / mag) * speed;
      if (!isCollide(this.x + vx, this.y, this.r)) this.x += vx; if (!isCollide(this.x, this.y + vy, this.r)) this.y += vy;
    }
    camX += (this.x - (w / 2) / GAME_SCALE - camX) * 0.12; camY += (this.y - (h / 2) / GAME_SCALE - camY) * 0.12;
    const px = (this.x - camX) * GAME_SCALE, py = (this.y - camY) * GAME_SCALE;
    const ang = Math.atan2(mouseY - py, mouseX - px);

    if (isMouseDown && this.cd <= 0) {
      if (this.weaponIdx === 0) { bullets.push(new Bullet(this.x, this.y, ang + (Math.random()-0.5)*0.1, 1.2+this.atkBonus*0.5, 16, "#fff000", 3, 1)); this.cd = Math.max(3, 9 - this.rapidMod*0.5); shake = 2; }
      else if (this.weaponIdx === 1) { bullets.push(new Bullet(this.x, this.y, ang, 15+this.atkBonus*1.5+this.sniperAtkBonus, 38, "#ffffff", 2, this.sniperPierce, true)); this.cd = Math.max(10, 54 - this.rapidMod*2.0); shake = 15; }
      else if (this.weaponIdx === 2) { this.swinging = 12; this.swingStartAng = ang - this.swingArc / 2; this.cd = Math.max(10, 30 - this.rapidMod); shake = 8; this.swingHitList = []; }
      else if (this.weaponIdx === 3) { for(let i=-this.shotgunPelletsBase; i<=this.shotgunPelletsBase; i++) bullets.push(new Bullet(this.x, this.y, ang + i*0.05*this.shotgunSpreadRatio + (Math.random()-0.5)*0.15*this.shotgunSpreadRatio, 2.0+this.atkBonus*0.5, 18, "#ffaa00", 2.5, 1)); this.cd = Math.max(10, 43 - this.rapidMod*1.5); shake = 10; }
    }
    this.myCrits = this.myCrits.filter(c => Date.now() - c.t < 1000);

    if (isVsMode() && this.hp > 0) {
      if (Math.hypot(this.x - this.safeZoneX, this.y - this.safeZoneY) > this.safeZoneR) this.hp -= 0.5;
    }
    if (gameStarted && isVsMode() && !isPaused && !isOver) {
      const now = Date.now();
      if (now - this.lastSyncTime >= 33) {
        socket.emit('sync_player', {
          x: this.x, y: this.y, hp: this.hp, maxHp: this.maxHp, ang, name: myPlayerName,
          bullets: bullets.map(b => ({x: b.x, y: b.y, r: b.r, col: b.col})),
          grenades: grenades.filter(g => g.owner === myId).map(g => ({x: g.x, y: g.y, blastR: g.blastR, exploded: g.exploded})),
          swinging: this.swinging, swingStartAng: this.swingStartAng, swordRange: this.swordRange, crits: this.myCrits, team: this.team
        });
        this.lastSyncTime = now;
      }
    }
    if (this.cd > 0) this.cd--; if (this.grenadeCd > 0) this.grenadeCd--; if (this.swinging > 0) this.swinging--; if (this.contactCd > 0) this.contactCd--;

    document.querySelectorAll('.w-slot').forEach((s, i) => s.className = (i === this.weaponIdx) ? 'w-slot active' : 'w-slot');
    if (hpBar) {
      hpBar.style.width = (this.hp/this.maxHp)*100 + "%"; hpTxt.innerText = `${Math.ceil(this.hp)} / ${this.maxHp}`;
      expBar.style.width = (exp/nextExp)*100 + "%"; expTxt.innerText = `${Math.floor((exp/nextExp)*100)}%`;
      lvNum.innerText = level; scoreVal.innerText = score; grenadeVal.innerText = this.grenades;
    }
    const btn = document.getElementById('btn-grenade');
    if (btn) {
      if (this.grenadeCd > 0) {
        const pct = 100 - (this.grenadeCd / 150)*100;
        btn.style.background = `conic-gradient(rgba(0,242,255,0.4) ${pct}%, rgba(0,0,0,0.85) ${pct}%)`; btn.style.pointerEvents = 'none'; btn.style.opacity = '0.8';
      } else { btn.style.background = `rgba(0,242,255,0.1)`; btn.style.pointerEvents = 'auto'; btn.style.opacity = '1.0'; }
    }
    if (isVsMode()) {
      const alive = Object.keys(others).length + (this.hp > 0 ? 1 : 0); if (survivorsVal) survivorsVal.innerText = alive;
    }
  }
  draw() {
    const px = this.x - camX, py = this.y - camY;
    const ang = Math.atan2(mouseY - py*GAME_SCALE, mouseX - px*GAME_SCALE);
    let col = "#00f2ff", rgb = "0, 242, 255";
    if (gameMode === 'team_vs') {
      if (this.team === 'RED') { col = "#ff3e3e"; rgb = "255, 62, 62"; }
      else if (this.team === 'BLUE') { col = "#3e82ff"; rgb = "62, 130, 255"; }
    }
    ctx.save(); ctx.setLineDash([5, 15]); ctx.strokeStyle = `rgba(${rgb}, 0.2)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang)*1200, py + Math.sin(ang)*1200); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang); ctx.fillStyle = `rgba(${rgb}, 0.9)`; ctx.shadowBlur = 15; ctx.shadowColor = col; ctx.beginPath(); ctx.moveTo(this.r+18, 0); ctx.lineTo(this.r+6, -7); ctx.lineTo(this.r+6, 7); ctx.closePath(); ctx.fill(); ctx.restore();

    if (this.swinging > 0) {
      const pct = (12 - this.swinging) / 12, curAng = this.swingStartAng + pct*this.swingArc, tx = px + Math.cos(curAng)*this.swordRange, ty = py + Math.sin(curAng)*this.swordRange;
      const grad = ctx.createRadialGradient(px, py, 10, px, py, this.swordRange); grad.addColorStop(0, 'transparent'); grad.addColorStop(1, `rgba(${rgb}, ${0.4*(1-pct*0.7)})`);
      ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, this.swordRange, this.swingStartAng, curAng); ctx.closePath(); ctx.fill();
      ctx.save(); ctx.shadowBlur = 15; ctx.shadowColor = col;
      const bGrad = ctx.createLinearGradient(px, py, tx, ty); bGrad.addColorStop(0.2, `rgba(${rgb}, 0.5)`); bGrad.addColorStop(0.8, "#fff"); bGrad.addColorStop(1, "#fff");
      ctx.strokeStyle = bGrad; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(px + Math.cos(curAng)*5, py + Math.sin(curAng)*5); ctx.lineTo(tx, ty); ctx.stroke(); ctx.restore();

      if (gameMode === 'solo') {
        enemies.forEach(e => {
          if (!this.swingHitList.includes(e) && Math.hypot(e.x-this.x, e.y-this.y) < this.swordRange + e.r) {
            let d = (Math.atan2(e.y-this.y, e.x-this.x) - this.swingStartAng) % (Math.PI*2); if (d < 0) d += Math.PI*2;
            if (d <= pct*this.swingArc) {
              let pctValue = Math.random() < this.critChance ? this.critMult : 1; e.hp -= (4 + this.atkBonus)*pctValue; this.swingHitList.push(e);
              if (pctValue > 1) explosions.push(new Explosion(e.x, e.y, 15, "rgba(255,0,170,0.4)", "CRIT!")); else { for(let i=0; i<4; i++) particles.push(new Particle(e.x, e.y, col)); }
              if (e.hp <= 0 && !e.dead) e.die();
            }
          }
        });
        nodes.forEach(n => {
          if (!this.swingHitList.includes(n) && Math.hypot(n.x-this.x, n.y-this.y) < this.swordRange + n.r) {
            let d = (Math.atan2(n.y-this.y, n.x-this.x) - this.swingStartAng) % (Math.PI*2); if (d < 0) d += Math.PI*2;
            if (d <= pct*this.swingArc) {
              let pctValue = Math.random() < this.critChance ? this.critMult : 1; n.hp -= (4 + this.atkBonus)*pctValue; this.swingHitList.push(n);
              if (pctValue > 1) explosions.push(new Explosion(n.x, n.y, 15, "rgba(255,0,170,0.4)", "CRIT!")); else { for(let i=0; i<4; i++) particles.push(new Particle(n.x, n.y, col)); }
              if (n.hp <= 0 && !n.dead) n.die();
            }
          }
        });
      } else {
        Object.keys(others).forEach(id => {
          const o = others[id]; if (gameMode === 'team_vs' && o.team === this.team) return;
          if (!this.swingHitList.includes(id) && Math.hypot(o.x - this.x, o.y - this.y) < this.swordRange + 13) {
            let d = (Math.atan2(o.y - this.y, o.x - this.x) - this.swingStartAng) % (Math.PI*2); if (d < 0) d += Math.PI*2;
            if (d <= pct*this.swingArc) {
              this.swingHitList.push(id);
              let pctValue = Math.random() < this.critChance ? this.critMult : 1, dmg = (4 + this.atkBonus)*pctValue;
              if (o.hp <= dmg) { if(!window.myKills) window.myKills={}; window.myKills[id] = Date.now(); }
              socket.emit('damage_event', { targetId: id, dmg });
              if (pctValue > 1) {
                explosions.push(new Explosion(o.x, o.y, 15, "rgba(255,0,170,0.4)", "CRIT!"));
                this.myCrits.push({ id: Math.random().toString(36).substring(2), x: o.x, y: o.y, t: Date.now() });
              } else { for(let i=0; i<4; i++) particles.push(new Particle(o.x, o.y, col)); }
            }
          }
        });
      }
    }
    if (this.contactCd > 0 && Math.floor(Date.now() / 50) % 2 === 0) ctx.globalAlpha = 0.5;
    ctx.shadowBlur = 10; ctx.shadowColor = col; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, this.r, 0, 7); ctx.fill(); ctx.shadowBlur = 0; ctx.globalAlpha = 1.0;
  }
}

class Bullet {
  constructor(x, y, ang, atk, spd, col, r, pierce, isSniper = false) {
    this.x = x; this.y = y; this.vx = Math.cos(ang)*spd; this.vy = Math.sin(ang)*spd;
    this.atk = atk; this.col = col; this.r = r; this.pierce = pierce; this.dead = false; this.hitList = [];
    this.isSniper = isSniper; this.history = []; this.maxHistory = isSniper ? 10 : 4;
  }
  update() {
    this.history.push({x: this.x, y: this.y}); if (this.history.length > this.maxHistory) this.history.shift();
    this.x += this.vx; this.y += this.vy;
    if (getWall(this.x, this.y)) { this.dead = true; for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, this.col, 0.5)); }
    if (gameMode === 'solo') {
      enemies.forEach(e => {
        if (!this.hitList.includes(e) && Math.hypot(this.x-e.x, this.y-e.y) < e.r + this.r + 5) {
          let blk = false;
          if (e.type === 'HEAVY' && !this.isSniper) {
            let diff = (Math.atan2(this.y - e.y, this.x - e.x) - e.facingAngle) % (Math.PI*2);
            if (diff < -Math.PI) diff += Math.PI*2; if (diff > Math.PI) diff -= Math.PI*2;
            if (Math.abs(diff) <= 0.8) blk = true;
          }
          if (blk) { this.dead = true; for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, "#aaa")); }
          else {
            let crit = Math.random() < p.critChance ? p.critMult : 1; e.hp -= this.atk*crit; this.hitList.push(e); this.pierce--;
            if (this.pierce <= 0) this.dead = true;
            if (crit > 1) explosions.push(new Explosion(e.x, e.y, 15, "rgba(255,0,170,0.4)", "CRIT!")); else { for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, this.col)); }
            if (e.hp <= 0 && !e.dead) e.die();
          }
        }
      });
      nodes.forEach(n => {
        if (!this.hitList.includes(n) && Math.hypot(this.x-n.x, this.y-n.y) < n.r + this.r + 5) {
          let crit = Math.random() < p.critChance ? p.critMult : 1; n.hp -= this.atk*crit; this.hitList.push(n); this.pierce--;
          if (this.pierce <= 0) this.dead = true;
          if (crit > 1) explosions.push(new Explosion(n.x, n.y, 15, "rgba(255,0,170,0.4)", "CRIT!")); else { for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, this.col)); }
          if (n.hp <= 0 && !n.dead) n.die();
        }
      });
    } else {
      Object.keys(others).forEach(id => {
        const o = others[id]; if (gameMode === 'team_vs' && o.team === p.team) return;
        if (!this.hitList.includes(id) && Math.hypot(this.x - o.x, this.y - o.y) < this.r + 13) {
          let crit = Math.random() < p.critChance ? p.critMult : 1, dmg = this.atk*crit;
          if (o.hp <= dmg) { if(!window.myKills) window.myKills={}; window.myKills[id] = Date.now(); }
          socket.emit('damage_event', { targetId: id, dmg });
          this.hitList.push(id); this.pierce--; if (this.pierce <= 0) this.dead = true;
          if (crit > 1) {
            explosions.push(new Explosion(o.x, o.y, 15, "rgba(255,0,170,0.4)", "CRIT!"));
            p.myCrits.push({ id: Math.random().toString(36).substring(2), x: o.x, y: o.y, t: Date.now() });
          } else { for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, this.col)); }
        }
      });
    }
  }
  draw() {
    if (this.history.length > 1) {
      ctx.save(); ctx.lineCap = "round";
      for (let i = 1; i < this.history.length; i++) {
        ctx.beginPath(); ctx.moveTo(this.history[i-1].x - camX, this.history[i-1].y - camY); ctx.lineTo(this.history[i].x - camX, this.history[i].y - camY);
        const alpha = (i / this.history.length); ctx.globalAlpha = alpha * (this.isSniper ? 0.8 : 0.4);
        ctx.strokeStyle = this.col; ctx.lineWidth = this.r * (this.isSniper ? 1.5 : 0.8); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1.0; ctx.fillStyle = this.col; ctx.beginPath(); ctx.arc(this.x-camX, this.y-camY, this.r, 0, 7); ctx.fill();
  }
}

class Explosion {
  constructor(x, y, r, col, text = "", textCol = null) {
    this.x = x; this.y = y; this.r = r; this.col = col; this.timer = 35; this.maxTimer = 35; this.text = text;
    this.textCol = textCol || (text === "CRIT!" ? "#ff00aa" : "#2d7d46"); this.isTakumi = (text === "匠");
  }
  update() { this.timer--; }
  draw() {
    const pct = (this.maxTimer - this.timer) / this.maxTimer;
    ctx.save(); ctx.globalAlpha = Math.max(0, 1.0 - pct); ctx.fillStyle = this.col;
    ctx.beginPath(); ctx.arc(this.x - camX, this.y - camY, this.r * (0.9 + pct*0.15), 0, 7); ctx.fill();
    if (this.text) {
      ctx.save(); ctx.translate(this.x - camX, this.y - camY);
      const ease = 1.0 - Math.pow(1.0 - pct, 3);
      let size = this.isTakumi ? 64 : 16; let scale = 1.0 + ease * (this.isTakumi ? 1.2 : 0.5);
      ctx.scale(scale, scale); ctx.fillStyle = this.textCol; ctx.font = `900 ${size}px 'Segoe UI', sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowBlur = this.isTakumi ? 20 : 8; ctx.shadowColor = this.isTakumi ? "rgba(50,255,126,0.8)" : "rgba(0,0,0,0.6)";
      ctx.fillText(this.text, 0, 0); ctx.restore();
    }
    ctx.restore();
  }
}

class Grenade {
  constructor(x, y, ang, owner = 'solo', dmg = 35, range = 280) {
    this.x = x; this.y = y; const dist = 250; this.tx = x + Math.cos(ang)*dist; this.ty = y + Math.sin(ang)*dist;
    this.timer = 150; this.dead = false; this.exploded = false; this.blastR = range; this.owner = owner; this.dmg = dmg;
  }
  update() {
    this.x += (this.tx - this.x)*0.1; this.y += (this.ty - this.y)*0.1; this.timer--;
    if (this.timer <= 0 && !this.exploded) this.explode();
  }
  explode() {
    this.exploded = true; shake = 35;
    explosions.push(new Explosion(this.x, this.y, this.blastR, "rgba(0, 242, 255, 0.4)"));
    if (gameMode === 'solo') {
      enemies.forEach(e => {
        if (Math.hypot(e.x - this.x, e.y - this.y) < this.blastR) {
          e.hp -= this.dmg; const a = Math.atan2(e.y - this.y, e.x - this.x);
          e.x += Math.cos(a)*(e.type==='HEAVY'?20:60); e.y += Math.sin(a)*(e.type==='HEAVY'?20:60);
          if (e.hp <= 0 && !e.dead) e.die();
        }
      });
      nodes.forEach(n => { if (Math.hypot(n.x - this.x, n.y - this.y) < this.blastR) { n.hp -= this.dmg; if (n.hp <= 0 && !n.dead) n.die(); } });
    } else {
      Object.keys(others).forEach(id => {
        const o = others[id]; if (gameMode === 'team_vs' && o.team === p.team) return;
        if (Math.hypot(o.x - this.x, o.y - this.y) < this.blastR) {
          if (this.owner === myId && o.hp <= this.dmg) { if(!window.myKills) window.myKills={}; window.myKills[id] = Date.now(); }
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
    this.x = x; this.y = y; this.vx = Math.cos(ang)*spd; this.vy = Math.sin(ang)*spd;
    this.ang = ang; this.r = (type==='HEAVY') ? 6 : ((type==='SCOUT') ? 3 : 4); this.dead = false; this.dmg = dmg; this.type = type;
  }
  update() {
    this.x += this.vx; this.y += this.vy;
    if (getWall(this.x, this.y)) { this.dead = true; for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, "#ff3e3e", 0.5)); }
    if (Math.hypot(this.x - p.x, this.y - p.y) < p.r + this.r) { p.hp -= this.dmg; shake = 10; this.dead = true; for(let i=0; i<5; i++) particles.push(new Particle(this.x, this.y, "#ff3e3e")); }
  }
  draw() {
    ctx.save(); ctx.translate(this.x - camX, this.y - camY);
    if (this.type === 'SCOUT') {
      ctx.rotate(this.ang); ctx.shadowBlur = 10; ctx.shadowColor = "#bf00ff"; ctx.fillStyle = "#fff"; ctx.fillRect(-6, -1, 12, 2);
    } else if (this.type === 'HEAVY') {
      ctx.fillStyle = '#ff8c00'; ctx.shadowBlur = 12; ctx.shadowColor = "orange"; ctx.beginPath(); ctx.arc(0, 0, this.r, 0, 7); ctx.fill();
    } else { ctx.fillStyle = '#ff3e3e'; ctx.shadowBlur = 8; ctx.shadowColor = "red"; ctx.beginPath(); ctx.arc(0, 0, this.r, 0, 7); ctx.fill(); }
    ctx.restore();
  }
}

class Enemy {
  constructor() {
    const rand = Math.random();
    if (rand < 0.10) { this.type = 'HEAVY'; this.r = 22; this.maxHp = 5 + level*2.5; this.speed = 0.8 + level*0.05; }
    else if (rand < 0.25) { this.type = 'TICK'; this.r = 8; this.maxHp = 1.2 + level*0.2; this.speed = 4.0 + level*0.1; this.blastDmg = 38 + level*2.0; this.blastR = 130; this.exploding = 0; }
    else if (rand < 0.35) { this.type = 'MEDIC'; this.r = 14; this.maxHp = 3.2 + level*2.0; this.speed = 1.2 + level*0.1; this.healCd = 120; }
    else if (rand < 0.60) { this.type = 'SCOUT'; this.r = 9; this.maxHp = 1.5 + level*0.8; this.speed = 3.5 + level*0.1; }
    else { this.type = 'NORMAL'; this.r = 16; this.maxHp = 3 + level*1.8; this.speed = 1.5 + level*0.1; }
    let ex, ey, attempts = 0;
    do { ex = Math.random()*MAP_W*TILE_SIZE; ey = Math.random()*MAP_H*TILE_SIZE; attempts++; } while ((isCollide(ex, ey, this.r) || Math.hypot(p.x - ex, p.y - ey) < 600) && attempts < 100);
    this.x = ex; this.y = ey; this.hp = this.maxHp; this.dead = false; this.shootCd = Math.random()*100; this.angleOffset = Math.random()*Math.PI*2; this.facingAngle = 0; this.path = []; this.pathTimer = Math.floor(Math.random()*30);
  }
  die() {
    if (this.dead) return;
    if (this.type === 'TICK') this.explode(false);
    else {
      this.dead = true; score += (this.type==='SCOUT'?200:(this.type==='HEAVY'?300:(this.type==='MEDIC'?250:100)));
      cores.push(new ExpCore(this.x, this.y)); spawnDrop(this.x, this.y); explosions.push(new Explosion(this.x, this.y, this.r*1.8, "rgba(255,255,255,0.4)"));
      let c = this.type==='HEAVY'?'#ff8c00':(this.type==='SCOUT'?'#bf00ff':(this.type==='MEDIC'?'#32cd32':'#ff3e3e'));
      for(let i=0; i<6; i++) particles.push(new Particle(this.x, this.y, c, 1.5));
    }
  }
  explode(self = true) {
    this.dead = true; shake = 20;
    explosions.push(new Explosion(this.x, this.y, this.blastR, self ? "rgba(50,205,50,0.6)" : "rgba(0,242,255,0.4)", self ? "匠" : ""));
    if (self && Math.hypot(p.x - this.x, p.y - this.y) < this.blastR) { p.hp -= this.blastDmg; shake = 30; }
    enemies.forEach(e => { if (e !== this && !e.dead && Math.hypot(e.x - this.x, e.y - this.y) < this.blastR) { e.hp -= 20; if (e.hp <= 0) e.die(); } });
    if (!self) { score += 150; cores.push(new ExpCore(this.x, this.y)); spawnDrop(this.x, this.y); }
  }
  update() {
    if (this.dead) return;
    const dist = Math.hypot(p.x - this.x, p.y - this.y), ang = Math.atan2(p.y - this.y, p.x - this.x);
    this.facingAngle = ang; this.pathTimer--;
    if (this.pathTimer <= 0) { this.path = getPath(this.x, this.y, p.x, p.y); this.pathTimer = 30 + Math.floor(Math.random()*15); }
    let vx = 0, vy = 0;
    if (this.type === 'MEDIC') {
      let target = null, minDist = 9999;
      enemies.forEach(e => { if (e !== this && !e.dead && e.hp < e.maxHp) { let d = Math.hypot(e.x-this.x, e.y-this.y); if (d < minDist) { minDist = d; target = e; } } });
      if (!target) { enemies.forEach(e => { if (e !== this && !e.dead) { let d = Math.hypot(e.x-this.x, e.y-this.y); if (d < minDist) { minDist = d; target = e; } } }); }
      if (target) { if (minDist > 30) { const a = Math.atan2(target.y-this.y, target.x-this.x); vx = Math.cos(a)*this.speed; vy = Math.sin(a)*this.speed; this.facingAngle = a; } }
      else { vx = -Math.cos(ang)*this.speed; vy = -Math.sin(ang)*this.speed; }
    } else {
      let tx = p.x, ty = p.y;
      if (this.path && this.path.length > 0) {
        let n = this.path[0]; if (Math.hypot(n.x-this.x, n.y-this.y) < this.r + TILE_SIZE/2) { this.path.shift(); if (this.path.length > 0) n = this.path[0]; }
        if (n) { tx = n.x; ty = n.y; }
      }
      const ta = Math.atan2(ty - this.y, tx - this.x);
      if (this.type === 'TICK') {
        if (this.exploding > 0) { this.exploding--; if (this.exploding <= 0) this.explode(true); return; }
        else if (dist < 40) { this.exploding = 40; return; }
        else { vx = Math.cos(ta)*this.speed; vy = Math.sin(ta)*this.speed; }
      } else if (this.type === 'SCOUT') {
        this.angleOffset += 0.05; const ox = p.x + Math.cos(this.angleOffset)*200, oy = p.y + Math.sin(this.angleOffset)*200;
        const ma = Math.atan2(oy-this.y, ox-this.x); vx = Math.cos(ma)*this.speed; vy = Math.sin(ma)*this.speed; this.facingAngle = ma;
      } else if (this.type === 'HEAVY') {
        if (dist > 380) { vx = Math.cos(ta)*this.speed; vy = Math.sin(ta)*this.speed; }
        else if (dist < 320) { vx = -Math.cos(ang)*this.speed; vy = -Math.sin(ang)*this.speed; }
      } else { if (dist > 120) { vx = Math.cos(ta)*this.speed; vy = Math.sin(ta)*this.speed; } }
    }
    if (vx !== 0 || vy !== 0) {
      let stuck = isCollide(this.x, this.y, this.r);
      if (!isCollide(this.x + vx, this.y, this.r) || stuck) this.x += vx; if (!isCollide(this.x, this.y + vy, this.r) || stuck) this.y += vy;
    }
    if (this.type === 'MEDIC') {
      this.healCd--;
      if (this.healCd <= 0) {
        let healed = false;
        enemies.forEach(e => { if (!e.dead && e.hp < e.maxHp && Math.hypot(e.x-this.x, e.y-this.y) < 250) { e.hp = Math.min(e.maxHp, e.hp + e.maxHp*0.4); healed = true; for(let i=0; i<3; i++) particles.push(new Particle(e.x, e.y, "#32cd32")); } });
        if (healed) { explosions.push(new Explosion(this.x, this.y, 250, "rgba(50,205,50,0.2)")); this.healCd = 120 + Math.random()*60; } else this.healCd = 30;
      }
    } else if (this.type !== 'TICK') {
      const range = (this.type === 'HEAVY') ? 900 : 650;
      if (dist < range) {
        this.shootCd--;
        if (this.shootCd <= 0) {
          const d = (this.type==='HEAVY') ? 15 + level*1.5 : ((this.type==='SCOUT')? 4 + level*0.5 : 10 + level*1.0);
          const s = (this.type==='HEAVY') ? 8.5 + level*0.2 : 4.5 + level*0.2;
          enemyBullets.push(new EnemyBullet(this.x, this.y, ang, s, d, this.type));
          this.shootCd = ((this.type==='HEAVY')?150:((this.type==='SCOUT')?20:80)) + Math.random()*60;
        }
      }
    }
  }
  draw() {
    let col = (this.type==='HEAVY')?'#ff8c00':((this.type==='SCOUT')?'#bf00ff':((this.type==='MEDIC')?'#32cd32':'#ff3e3e'));
    if (this.type === 'TICK') col = (this.exploding > 0 && Math.floor(Date.now()/60)%2===0) ? "#fff" : "#006400";
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(this.x - camX, this.y - camY, this.r, 0, 7); ctx.fill();
    if (this.type === 'HEAVY') {
      ctx.save(); ctx.translate(this.x-camX, this.y-camY); ctx.rotate(this.facingAngle); ctx.strokeStyle = "rgba(255,140,0,0.8)"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(0,0,this.r+6, -0.8, 0.8); ctx.stroke(); ctx.restore();
    } else if (this.type === 'MEDIC') {
      ctx.save(); ctx.translate(this.x-camX, this.y-camY); ctx.fillStyle = "#fff"; ctx.fillRect(-2,-6,4,12); ctx.fillRect(-6,-2,12,4); ctx.restore();
    }
    const w = this.r*1.5; ctx.fillStyle = "#000"; ctx.fillRect(this.x-camX-w/2, this.y-camY-this.r-9, w, 4);
    ctx.fillStyle = col; ctx.fillRect(this.x-camX-w/2, this.y-camY-this.r-9, w*(this.hp/this.maxHp), 4);
  }
}

class DataNode {
  constructor() {
    let ex, ey; do { ex = Math.random()*MAP_W*TILE_SIZE; ey = Math.random()*MAP_H*TILE_SIZE; } while (getWall(ex, ey) || Math.hypot(p.x - ex, p.y - ey) < 300);
    this.x = ex; this.y = ey; this.r = 15; this.maxHp = 7 + level; this.hp = this.maxHp; this.dead = false; this.pulse = Math.random()*Math.PI*2;
  }
  update() { this.pulse += 0.05; }
  draw() {
    const px = this.x-camX, py = this.y-camY;
    ctx.save(); ctx.translate(px, py); ctx.shadowBlur = 10 + Math.sin(this.pulse)*5; ctx.shadowColor = "#fff000";
    ctx.fillStyle = "rgba(255,240,0,0.2)"; ctx.strokeStyle = "#fff000"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0,-this.r); ctx.lineTo(this.r,0); ctx.lineTo(0,this.r); ctx.lineTo(-this.r,0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#000"; ctx.fillRect(-15, -this.r-8, 30, 4); ctx.fillStyle = "#fff000"; ctx.fillRect(-15, -this.r-8, 30*(Math.max(0, this.hp)/this.maxHp), 4); ctx.restore();
  }
  die() {
    this.dead = true; score += 50; cores.push(new ExpCore(this.x, this.y)); spawnDrop(this.x, this.y); shake = 5;
    explosions.push(new Explosion(this.x, this.y, this.r*1.5, "rgba(255,255,255,0.5)"));
    for(let i=0; i<6; i++) particles.push(new Particle(this.x, this.y, "#fff000", 1.5));
  }
}

class ExpCore { constructor(x,y){this.x=x;this.y=y;this.dead=false;} update(){const a=Math.atan2(p.y-this.y,p.x-this.x);this.x+=Math.cos(a)*12;this.y+=Math.sin(a)*12;} draw(){ctx.shadowBlur=10;ctx.shadowColor="yellow";ctx.fillStyle='#fff000';ctx.beginPath();ctx.arc(this.x-camX,this.y-camY,4,0,7);ctx.fill();ctx.shadowBlur=0;} }
class HealthItem { constructor(x,y){this.x=x;this.y=y;this.dead=false;} update(){const d=Math.hypot(p.x-this.x,p.y-this.y);if(d<50){const a=Math.atan2(p.y-this.y,p.x-this.x);this.x+=Math.cos(a)*12;this.y+=Math.sin(a)*12;}if(d<20){p.hp=Math.min(p.maxHp,p.hp+20);this.dead=true;shake=5;}} draw(){ctx.shadowBlur=15;ctx.shadowColor="#32ff7e";ctx.fillStyle='#32ff7e';ctx.fillRect(this.x-camX-2,this.y-camY-6,4,12);ctx.fillRect(this.x-camX-6,this.y-camY-2,12,4);ctx.shadowBlur=0;} }
class GrenadeItem { constructor(x,y){this.x=x;this.y=y;this.dead=false;} update(){const d=Math.hypot(p.x-this.x,p.y-this.y);if(d<50){const a=Math.atan2(p.y-this.y,p.x-this.x);this.x+=Math.cos(a)*12;this.y+=Math.sin(a)*12;}if(d<20){p.grenades+=2;this.dead=true;shake=5;}} draw(){ctx.shadowBlur=15;ctx.shadowColor="#00f2ff";ctx.fillStyle='#00f2ff';ctx.fillRect(this.x-camX-5,this.y-camY-5,10,10);ctx.shadowBlur=0;} }
class Particle { constructor(x,y,col,mul=1){this.x=x;this.y=y;const a=Math.random()*Math.PI*2,s=(Math.random()*2+1)*mul;this.vx=Math.cos(a)*s;this.vy=Math.sin(a)*s;this.timer=10+Math.random()*5;this.col=col;} update(){this.x+=this.vx;this.y+=this.vy;this.vx*=0.9;this.vy*=0.9;this.timer--;} draw(){ctx.fillStyle=this.col;ctx.fillRect(this.x-camX-1,this.y-camY-1,2,2);} }

// ==========================================
// PLAYER INSTANCE INITIALIZATION
// ==========================================
const p = new Player();

// ==========================================
// HELPER FUNCTIONS
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
      socket.emit('spawn_drop', { type, x, y });
    } else {
      if (type === 'health') items.push(new HealthItem(x, y));
      else if (type === 'grenade') items.push(new GrenadeItem(x, y));
    }
  }
}

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

function getPath(startX, startY, goalX, goalY) {
  const sX = Math.floor(startX / TILE_SIZE), sY = Math.floor(startY / TILE_SIZE);
  const gX = Math.floor(goalX / TILE_SIZE), gY = Math.floor(goalY / TILE_SIZE);

  if (sX === gX && sY === gY) return [];

  const open = [{ x: sX, y: sY, g: 0, h: Math.abs(sX - gX) + Math.abs(sY - gY), parent: null }];
  const closed = new Set();

  while (open.length > 0) {
    open.sort((a, b) => (a.g + a.h) - (b.g + b.h));
    const current = open.shift();
    const key = `${current.x},${current.y}`;

    if (current.x === gX && current.y === gY) {
      const path = [];
      let curr = current;
      while (curr.parent) {
        path.push({ x: curr.x * TILE_SIZE + TILE_SIZE / 2, y: curr.y * TILE_SIZE + TILE_SIZE / 2 });
        curr = curr.parent;
      }
      return path.reverse();
    }

    closed.add(key);
    const dirs = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
    for (let d of dirs) {
      const nX = current.x + d[0], nY = current.y + d[1];
      const nKey = `${nX},${nY}`;

      if (nX < 0 || nY < 0 || nX >= MAP_W || nY >= MAP_H) continue;
      if (map[nY] && map[nY][nX]) continue;
      if (closed.has(nKey)) continue;

      if (d[0] !== 0 && d[1] !== 0 && (map[current.y][nX] || map[nY][current.x])) continue;

      const gCost = current.g + (d[0] === 0 || d[1] === 0 ? 1 : Math.SQRT2);
      const existing = open.find(n => n.x === nX && n.y === nY);

      if (!existing) {
        open.push({ x: nX, y: nY, g: gCost, h: Math.abs(nX - gX) + Math.abs(nY - gY), parent: current });
      } else if (gCost < existing.g) {
        existing.g = gCost; existing.parent = current;
      }
    }
  }
  return [];
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
function formatTime(t) { if(!t) return ""; const d = new Date(t); return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }

function addChatDOM(el, d) {
  const msg = document.createElement('div'); msg.className = 'chat-msg';
  const cName = document.getElementById('player-name').value.trim() || myPlayerName || "ANONYMOUS";
  const color = (d.name === cName) ? "var(--lime)" : "var(--cyan)";
  msg.innerHTML = `<span class="chat-time">${formatTime(d.timestamp)}</span><span class="chat-name" style="color:${color};">[${escapeHTML(d.name)}]</span> <span class="chat-text">${autoLink(escapeHTML(d.text))}</span>`;
  el.appendChild(msg); el.scrollTop = el.scrollHeight;
}

function sendGlobalChatMessage() {
  const input = document.getElementById('start-chat-input'); if (!input) return;
  const t = input.value.trim(); const name = document.getElementById('player-name').value.trim() || myPlayerName || "ANONYMOUS";
  if (t) { socket.emit('send_global_chat', { name, text: t }); input.value = ''; }
}

function sendChatMessage() {
  const input = document.getElementById('chat-input'); if (!input) return;
  const t = input.value.trim(); if (t) { socket.emit('send_chat', t); input.value = ''; }
}

// --- Game loops & Minimap rendering ---
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
// SOCKET.IO EVENT LISTENERS (定義順に依存しないよう最下部で設定)
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

window.addEventListener('DOMContentLoaded', () => {
  const btnSendChat = document.getElementById('btn-send-chat'), chatInput = document.getElementById('chat-input');
  if (btnSendChat) btnSendChat.addEventListener('click', sendChatMessage);
  if (chatInput) chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChatMessage(); });
  const btnStartSendChat = document.getElementById('btn-start-send-chat'), startChatInput = document.getElementById('start-chat-input');
  if (btnStartSendChat) btnStartSendChat.addEventListener('click', sendGlobalChatMessage);
  if (startChatInput) startChatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendGlobalChatMessage(); });
  document.getElementById('start-chat-tab').classList.add('visible');
  document.getElementById('lobby-chat-tab').classList.add('visible');
});

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

window.onload = () => { ctx.fillStyle = "#050505"; ctx.fillRect(0,0,w,h); };
