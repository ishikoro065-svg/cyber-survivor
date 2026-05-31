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
    
    // 味方プレイヤーの情報を記憶する辞書
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
        if (this.weaponIdx === 1) currentMoveSpeed *= 0.7; // スナイパー
        else if (this.weaponIdx === 3) currentMoveSpeed *= 0.75; // ショットガン
        else if (this.weaponIdx === 0) currentMoveSpeed *= 0.85; // ハンドガン
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

    // 安全エリア（ストーム）のダメージ処理
    if ((gameMode === 'solo_vs' || gameMode === 'team_vs') && this.hp > 0) {
      if (Math.hypot(this.x - this.safeZoneX, this.y - this.safeZoneY) > this.safeZoneR) {
        this.hp -= 0.5; 
      }
    }

    // 自分のデータをSocketで同期 (Firebaseのsetを置き換え)
    if (!isPaused && !isOver && (gameMode === 'solo_vs' || gameMode === 'team_vs')) {
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
    
    if (typeof hpBar !== 'undefined') {
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
    
    if (gameMode === 'solo_vs' || gameMode === 'team_vs') {
      const aliveCount = Object.keys(others).length + (this.hp > 0 ? 1 : 0);
      if (typeof survivorsVal !== 'undefined') survivorsVal.innerText = aliveCount;
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
        html += `<li class="member-item"><span class="${nameClass}">${mate.name || "UNKNOWN"}</span>${status}</li>`;
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
      bladeGrad.addColorStop(0.2, `rgba(${myRgb}, 0.5)`); bladeGrad.addColorStop(0.8, "#fff"); bladeGrad.addColorStop(1, "#fff");
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
      } else if ((gameMode === 'solo_vs' || gameMode === 'team_vs')) {
        Object.keys(others).forEach(id => {
          const o = others[id];
          if (gameMode === 'team_vs' && o.team === this.team) return;
          if (!this.swingHitList.includes(id) && Math.hypot(o.x - this.x, o.y - this.y) < this.swordRange + 13) {
            let diff = (Math.atan2(o.y - this.y, o.x - this.x) - this.swingStartAng) % (Math.PI * 2); if (diff < 0) diff += Math.PI * 2;
            if (diff <= p_val * this.swingArc) { 
              this.swingHitList.push(id); 
              let crit = Math.random() < this.critChance ? this.critMult : 1;
              let dmg = (4 + this.atkBonus) * crit;
              if (o.hp <= dmg) { if (!window.myKills) window.myKills = {}; window.myKills[id] = Date.now(); }
              
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
    
    if (this.contactCd > 0 && Math.floor(Date.now() / 50) % 2 === 0) { ctx.globalAlpha = 0.5; }
    ctx.shadowBlur = 10; ctx.shadowColor = myCol; ctx.fillStyle = myCol; ctx.beginPath(); ctx.arc(px, py, this.r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    ctx.globalAlpha = 1.0;
  }
}

class Bullet {
  constructor(x, y, ang, atk, spd, col, r, pierce, isSniper = false) {
    this.x = x; this.y = y; this.vx = Math.cos(ang)*spd; this.vy = Math.sin(ang)*spd;
    this.atk = atk; this.col = col; this.r = r; this.pierce = pierce; this.dead = false; this.hitList = [];
    this.isSniper = isSniper; 
    this.history = []; this.maxHistory = isSniper ? 10 : 4; 
  }
  update() {
    this.history.push({x: this.x, y: this.y});
    if (this.history.length > this.maxHistory) this.history.shift();
    this.x += this.vx; this.y += this.vy;
    if (getWall(this.x, this.y)) {
      this.dead = true;
      for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, this.col, 0.5));
    }
    if (gameMode === 'solo') {
      enemies.forEach(e => {
        if (!this.hitList.includes(e) && Math.hypot(this.x-e.x, this.y-e.y) < e.r + this.r + 5) {
          let blocked = false;
          if (e.type === 'HEAVY' && !this.isSniper) {
            const impactAng = Math.atan2(this.y - e.y, this.x - e.x);
            let diff = (impactAng - e.facingAngle) % (Math.PI * 2);
            if (diff < -Math.PI) diff += Math.PI * 2; if (diff > Math.PI) diff -= Math.PI * 2;
            if (Math.abs(diff) <= 0.8) blocked = true;
          }
          if (blocked) {
            this.dead = true; for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, "#aaa")); 
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
    } else if ((gameMode === 'solo_vs' || gameMode === 'team_vs')) {
      Object.keys(others).forEach(id => {
        const o = others[id];
        if (gameMode === 'team_vs' && o.team === p.team) return;
        if (!this.hitList.includes(id) && Math.hypot(this.x - o.x, this.y - o.y) < this.r + 13) {
          let crit = Math.random() < p.critChance ? p.critMult : 1;
          let dmg = this.atk * crit;
          if (o.hp <= dmg) { if (!window.myKills) window.myKills = {}; window.myKills[id] = Date.now(); }
          
          socket.emit('damage_event', { targetId: id, dmg: dmg });

          this.hitList.push(id); this.pierce--;
          if (this.pierce <= 0) this.dead = true;
          if (crit > 1) {
            explosions.push(new Explosion(o.x, o.y, 15, "rgba(255, 0, 170, 0.4)", "CRIT!"));
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
    this.x = x; this.y = y; this.r = r; this.col = col; this.timer = 35; this.maxTimer = 35;
    this.text = text; this.textCol = textCol || (text === "CRIT!" ? "#ff00aa" : "#2d7d46");
    this.isTakumi = (text === "匠");
  }
  update() { this.timer--; }
  draw() {
    const progress = (this.maxTimer - this.timer) / this.maxTimer; 
    ctx.save(); ctx.globalAlpha = Math.max(0, 1.0 - progress); ctx.fillStyle = this.col;
    ctx.beginPath(); ctx.arc(this.x - camX, this.y - camY, this.r * (0.9 + progress * 0.15), 0, 7); ctx.fill();
    if (this.text) {
      ctx.save(); ctx.translate(this.x - camX, this.y - camY);
      const easeOutScale = 1.0 - Math.pow(1.0 - progress, 3);
      let baseFontSize = this.isTakumi ? 64 : 16;
      let scale = 1.0 + easeOutScale * (this.isTakumi ? 1.2 : 0.5); 
      ctx.scale(scale, scale); ctx.fillStyle = this.textCol; ctx.font = `900 ${baseFontSize}px Segoe UI`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowBlur = this.isTakumi ? 20 : 8; ctx.shadowColor = this.isTakumi ? "rgba(50, 255, 126, 0.8)" : "rgba(0,0,0,0.6)";
      ctx.fillText(this.text, 0, 0); ctx.restore();
    }
    ctx.restore();
  }
}

class Grenade {
  constructor(x, y, ang, owner = 'solo', dmg = 35, range = 280) {
    this.x = x; this.y = y; const dist = 250;
    this.tx = x + Math.cos(ang) * dist; this.ty = y + Math.sin(ang) * dist;
    this.timer = 150; this.dead = false; this.exploded = false; 
    this.blastR = range; this.owner = owner; this.dmg = dmg;
  }
  update() {
    this.x += (this.tx - this.x) * 0.1; this.y += (this.ty - this.y) * 0.1;
    this.timer--; if (this.timer <= 0 && !this.exploded) this.explode();
  }
  explode() {
    this.exploded = true; shake = 35;
    explosions.push(new Explosion(this.x, this.y, this.blastR, "rgba(0, 242, 255, 0.4)"));
    if (gameMode === 'solo') {
      enemies.forEach(e => {
        const d = Math.hypot(e.x - this.x, e.y - this.y);
        if (d < this.blastR) {
          e.hp -= this.dmg; const ang = Math.atan2(e.y - this.y, e.x - this.x);
          e.x += Math.cos(ang) * (e.type === 'HEAVY' ? 20 : 60); e.y += Math.sin(ang) * (e.type === 'HEAVY' ? 20 : 60);
          if (e.hp <= 0 && !e.dead) e.die();
        }
      });
      nodes.forEach(n => {
        if (Math.hypot(n.x - this.x, n.y - this.y) < this.blastR) {
          n.hp -= this.dmg; if (n.hp <= 0 && !n.dead) n.die();
        }
      });
    } else if ((gameMode === 'solo_vs' || gameMode === 'team_vs')) {
      Object.keys(others).forEach(id => {
        const o = others[id];
        if (gameMode === 'team_vs' && o.team === p.team) return;
        if (Math.hypot(o.x - this.x, o.y - this.y) < this.blastR) {
          if (this.owner === myId) { if (o.hp <= this.dmg) { if (!window.myKills) window.myKills = {}; window.myKills[id] = Date.now(); } }
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
      this.dead = true; for(let i=0; i<3; i++) particles.push(new Particle(this.x, this.y, "#ff3e3e", 0.5)); 
    }
    if (Math.hypot(this.x - p.x, this.y - p.y) < p.r + this.r) { 
      p.hp -= this.dmg; shake = 10; this.dead = true; for(let i=0; i<5; i++) particles.push(new Particle(this.x, this.y, "#ff3e3e")); 
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
      const path = []; let curr = current;
      while (curr.parent) { path.push({ x: curr.x * TILE_SIZE + TILE_SIZE / 2, y: curr.y * TILE_SIZE + TILE_SIZE / 2 }); curr = curr.parent; }
      return path.reverse();
    }
    closed.add(key);
    const dirs = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
    for (let d of dirs) {
      const nX = current.x + d[0], nY = current.y + d[1]; const nKey = `${nX},${nY}`;
      if (nX < 0 || nY < 0 || nX >= MAP_W || nY >= MAP_H) continue;
      if (map[nY] && map[nY][nX]) continue; if (closed.has(nKey)) continue;
      if (d[0] !== 0 && d[1] !== 0 && (map[current.y][nX] || map[nY][current.x])) continue;
      const gCost = current.g + (d[0] === 0 || d[1] === 0 ? 1 : Math.SQRT2);
      const existing = open.find(n => n.x === nX && n.y === nY);
      if (!existing) { open.push({ x: nX, y: nY, g: gCost, h: Math.abs(nX - gX) + Math.abs(nY - gY), parent: current }); } 
      else if (gCost < existing.g) { existing.g = gCost; existing.parent = current; }
    }
  }
  return [];
}

class Enemy {
  constructor() {
    const rand = Math.random();
    if (rand < 0.10) { this.type = 'HEAVY'; this.r = 22; this.maxHp = 5 + level * 2.5; this.speed = 0.8 + level * 0.05; } 
    else if (rand < 0.25) { this.type = 'TICK'; this.r = 8; this.maxHp = 1.2 + level * 0.2; this.speed = 4.0 + level * 0.1; this.blastDmg = 38 + level * 2.0; this.blastR = 130; this.exploding = 0; } 
    else if (rand < 0.35) { this.type = 'MEDIC'; this.r = 14; this.maxHp = 3.2 + level * 2.0; this.speed = 1.2 + level * 0.1; this.healCd = 120; } 
    else if (rand < 0.60) { this.type = 'SCOUT'; this.r = 9; this.maxHp = 1.5 + level * 0.8; this.speed = 3.5 + level * 0.1; } 
    else { this.type = 'NORMAL'; this.r = 16; this.maxHp = 3 + level * 1.8; this.speed = 1.5 + level * 0.1; }
    let ex, ey, attempts = 0;
    do { ex = Math.random() * MAP_W * TILE_SIZE; ey = Math.random() * MAP_H * TILE_SIZE; attempts++; } 
    while ((isCollide(ex, ey, this.r) || Math.hypot(p.x - ex, p.y - ey) < 600) && attempts < 100);
    this.x = ex; this.y = ey; this.hp = this.maxHp; this.dead = false; this.shootCd = Math.random() * 100; this.angleOffset = Math.random() * Math.PI * 2;
    this.facingAngle = 0; this.path = []; this.pathTimer = Math.floor(Math.random() * 30);
  }
  die() {
    if (this.dead) return;
    if (this.type === 'TICK') { this.explode(false); } else {
      this.dead = true; score += (this.type === 'SCOUT' ? 200 : (this.type === 'HEAVY' ? 300 : (this.type === 'MEDIC' ? 250 : 100)));
      cores.push(new ExpCore(this.x, this.y)); spawnDrop(this.x, this.y); explosions.push(new Explosion(this.x, this.y, this.r * 1.8, "rgba(255, 255, 255, 0.4)")); 
      let pCol = this.type === 'HEAVY' ? '#ff8c00' : (this.type === 'SCOUT' ? '#bf00ff' : (this.type === 'MEDIC' ? '#32cd32' : '#ff3e3e'));
      for(let i=0; i<6; i++) particles.push(new Particle(this.x, this.y, pCol, 1.5)); 
    }
  }
  explode(isSelfDestruct = true) {
    this.dead = true; shake = 20;
    if (isSelfDestruct) { explosions.push(new Explosion(this.x, this.y, this.blastR, "rgba(50, 205, 50, 0.6)", "匠")); } 
    else { explosions.push(new Explosion(this.x, this.y, this.blastR, "rgba(0, 242, 255, 0.4)")); }
    if (isSelfDestruct && Math.hypot(p.x - this.x, p.y - this.y) < this.blastR) { p.hp -= this.blastDmg; shake = 30; }
    enemies.forEach(e => { if (e !== this && !e.dead && Math.hypot(e.x - this.x, e.y - this.y) < this.blastR) { e.hp -= 20; if (e.hp <= 0 && !e.dead) e.die(); } });
    if (!isSelfDestruct) { score += 150; cores.push(new ExpCore(this.x, this.y)); spawnDrop(this.x, this.y); }
  }
  update() {
    if (this.dead) return;
    const distToPlayer = Math.hypot(p.x - this.x, p.y - this.y), angToPlayer = Math.atan2(p.y - this.y, p.x - this.x);
    this.facingAngle = angToPlayer; this.pathTimer--;
    if (this.pathTimer <= 0) { this.path = getPath(this.x, this.y, p.x, p.y); this.pathTimer = 30 + Math.floor(Math.random() * 15); }
    let vx = 0, vy = 0;
    if (this.type === 'MEDIC') {
      let targetFriend = null, minDist = 9999;
      enemies.forEach(e => { if (e !== this && !e.dead && e.hp < e.maxHp) { let d = Math.hypot(e.x - this.x, e.y - this.y); if (d < minDist) { minDist = d; targetFriend = e; } } });
      if (!targetFriend) { minDist = 9999; enemies.forEach(e => { if (e !== this && !e.dead) { let d = Math.hypot(e.x - this.x, e.y - this.y); if (d < minDist) { minDist = d; targetFriend = e; } } }); }
      if (targetFriend) { if (minDist > 30) { const ang = Math.atan2(targetFriend.y - this.y, targetFriend.x - this.x); vx = Math.cos(ang) * this.speed; vy = Math.sin(ang) * this.speed; this.facingAngle = ang; } } 
      else { vx = -Math.cos(angToPlayer) * this.speed; vy = -Math.sin(angToPlayer) * this.speed; }
    } else {
      let moveTargetX = p.x, moveTargetY = p.y;
      if (this.path && this.path.length > 0) {
        let nextNode = this.path[0];
        if (Math.hypot(nextNode.x - this.x, nextNode.y - this.y) < this.r + TILE_SIZE / 2) { this.path.shift(); if (this.path.length > 0) nextNode = this.path[0]; }
        if (nextNode) { moveTargetX = nextNode.x; moveTargetY = nextNode.y; }
      }
      const targetAng = Math.atan2(moveTargetY - this.y, moveTargetX - this.x);
      if (this.type === 'TICK') {
        if (this.exploding > 0) { this.exploding--; if (this.exploding <= 0) this.explode(true); return; } 
        else if (distToPlayer < 40) { this.exploding = 40; return; } 
        else { vx = Math.cos(targetAng) * this.speed; vy = Math.sin(targetAng) * this.speed; }
      } else if (this.type === 'SCOUT') {
        this.angleOffset += 0.05; const targetX = p.x + Math.cos(this.angleOffset) * 200, targetY = p.y + Math.sin(this.angleOffset) * 200;
        const moveAng = Math.atan2(targetY - this.y, targetX - this.x); vx = Math.cos(moveAng) * this.speed; vy = Math.sin(moveAng) * this.speed; this.facingAngle = moveAng;
      } else if (this.type === 'HEAVY') {
        const optimalDist = 350; if (distToPlayer > optimalDist + 30) { vx = Math.cos(targetAng) * this.speed; vy = Math.sin(targetAng) * this.speed; }
        else if (distToPlayer < optimalDist - 30) { vx = -Math.cos(angToPlayer) * this.speed; vy = -Math.sin(angToPlayer) * this.speed; }
      } else { if (distToPlayer > 120) { vx = Math.cos(targetAng) * this.speed; vy = Math.sin(targetAng) * this.speed; } }
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
        enemies.forEach(e => { if (!e.dead && e.hp < e.maxHp && Math.hypot(e.x - this.x, e.y - this.y) < healR) { e.hp = Math.min(e.maxHp, e.hp + (e.maxHp * 0.4)); healed = true; for(let i=0; i<3; i++) particles.push(new Particle(e.x, e.y, "#32cd32")); } });
        if (healed) { explosions.push(new Explosion(this.x, this.y, healR, "rgba(50, 205, 50, 0.2)")); this.healCd = 120 + Math.random() * 60; } 
        else { this.healCd = 30; }
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
      ctx.save(); ctx.translate(this.x - camX, this.y - camY); ctx.fillStyle = "#fff"; ctx.fillRect(-2, -6, 4, 12); ctx.fillRect(-6, -2, 12, 4); ctx.restore();
    }
    const barW = this.r * 1.5; ctx.fillStyle = "#000"; ctx.fillRect(this.x-camX-barW/2, this.y-camY-this.r-9, barW, 4);
    ctx.fillStyle = col; ctx.fillRect(this.x-camX-barW/2, this.y-camY-this.r-9, barW*(this.hp/this.maxHp), 4);
  }
}

class DataNode {
  constructor() {
    let ex, ey; do { ex = Math.random() * MAP_W * TILE_SIZE; ey = Math.random() * MAP_H * TILE_SIZE; } while (getWall(ex, ey) || Math.hypot(p.x - ex, p.y - ey) < 300);
    this.x = ex; this.y = ey; this.r = 15; this.maxHp = 7 + level * 1; this.hp = this.maxHp; this.dead = false; this.pulse = Math.random() * Math.PI * 2;
  }
  update() { this.pulse += 0.05; }
  draw() {
    const px = this.x - camX, py = this.y - camY;
    ctx.save(); ctx.translate(px, py); ctx.shadowBlur = 10 + Math.sin(this.pulse) * 5; ctx.shadowColor = "#fff000";
    ctx.fillStyle = "rgba(255, 240, 0, 0.2)"; ctx.strokeStyle = "#fff000"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -this.r); ctx.lineTo(this.r, 0); ctx.lineTo(0, this.r); ctx.lineTo(-this.r, 0); ctx.closePath();
    ctx.fill(); ctx.stroke(); ctx.fillStyle = "#000"; ctx.fillRect(-15, -this.r - 8, 30, 4);
    ctx.fillStyle = "#fff000"; ctx.fillRect(-15, -this.r - 8, 30 * (Math.max(0, this.hp) / this.maxHp), 4); ctx.restore();
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
    this.x = x; this.y = y; const ang = Math.random() * Math.PI * 2; const spd = (Math.random() * 2 + 1) * speedMultiplier; 
    this.vx = Math.cos(ang) * spd; this.vy = Math.sin(ang) * spd; this.timer = 10 + Math.random() * 5; this.col = col;
  }
  update() { this.x += this.vx; this.y += this.vy; this.vx *= 0.9; this.vy *= 0.9; this.timer--; }
  draw() { ctx.fillStyle = this.col; ctx.fillRect(this.x - camX - 1, this.y - camY - 1, 2, 2); }
}
