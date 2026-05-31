window.isSpectating = false; 
window.matchEnding = false; 

const p = new Player(), bullets = [], enemyBullets = [], enemies = [], cores = [], items = [], grenades = [], nodes = [], explosions = [], particles = [];

if (!window.myKills) window.myKills = {};
const killLogs = [];

function isVsMode() {
  return gameMode === 'vs' || gameMode === 'solo_vs' || gameMode === 'team_vs';
}

// ドロップアイテムの生成 (Socket.io版)
function spawnDrop(x, y) {
  const r = Math.random();
  let type = null;
  if (r < 0.15) type = 'health';
  else if (r < 0.25) type = 'grenade';
  
  if (type) {
    if (isVsMode()) {
      // サーバーへドロップ生成を通知
      socket.emit('spawn_drop', { type: type, x: x, y: y });
    } else {
      if (type === 'health') items.push(new HealthItem(x, y));
      else if (type === 'grenade') items.push(new GrenadeItem(x, y));
    }
  }
}

// 共有ノードへのダメージ (Socket.io版)
function damageSharedNode(nid, nObj, dmg) {
  if (!isVsMode()) return;
  // サーバーへノードへのダメージを通知（破壊判定はサーバーが行う）
  socket.emit('damage_node', { nodeId: nid, dmg: dmg });
  
  // クライアント側の演出用（破壊音やパーティクルはサーバーからの node_destroyed 受信時に script1 側で処理されるのが理想ですが、
  // 元のロジックに合わせて即時演出が必要な場合はここに残します。
  // ただし、重複を避けるため基本はサーバーからの通知を待ちます）
}

function drawMinimap() {
  const center = 80, scale = 0.12;
  mCtx.clearRect(0, 0, 160, 160);
  mCtx.fillStyle = "rgba(0, 20, 30, 0.9)"; mCtx.beginPath(); mCtx.arc(center, center, 80, 0, Math.PI * 2); mCtx.fill();
  mCtx.save(); mCtx.translate(center, center); mCtx.beginPath(); mCtx.arc(0, 0, 80, 0, Math.PI * 2); mCtx.clip();
  mCtx.fillStyle = "rgba(255, 255, 255, 0.15)";
  
  const viewScale = window.isSpectating ? GAME_SCALE * 0.8 : GAME_SCALE;
  const centerX = window.isSpectating ? camX + (w/2)/viewScale : p.x;
  const centerY = window.isSpectating ? camY + (h/2)/viewScale : p.y;

  for(let y=0; y<MAP_H; y++) for(let x=0; x<MAP_W; x++) if(map[y] && map[y][x]) {
    const dX = (x * TILE_SIZE + TILE_SIZE/2 - centerX) * scale;
    const dY = (y * TILE_SIZE + TILE_SIZE/2 - centerY) * scale;
    if(Math.hypot(dX, dY) < 90) mCtx.fillRect(dX-4, dY-4, 8, 8);
  }

  if (gameMode === 'solo') {
    enemies.forEach(e => { 
      const dx = (e.x - centerX) * scale, dy = (e.y - centerY) * scale; 
      let dotCol = e.type === 'HEAVY' ? "#ff8c00" : (e.type === 'TICK' ? "#006400" : (e.type === 'SCOUT' ? "#bf00ff" : (e.type === 'MEDIC' ? "#32cd32" : "#ff3e3e")));
      mCtx.fillStyle = dotCol;
      let dotSize = e.type === 'HEAVY' ? 4 : (e.type === 'TICK' ? 2 : (e.type === 'SCOUT' ? 2 : (e.type === 'MEDIC' ? 2.5 : 3)));
      if(Math.hypot(dx, dy) < 80) mCtx.beginPath(), mCtx.arc(dx, dy, dotSize, 0, 7), mCtx.fill(); 
    });
    nodes.forEach(n => { const dx = (n.x - centerX) * scale, dy = (n.y - centerY) * scale; mCtx.fillStyle = "#fff000"; if(Math.hypot(dx, dy) < 80) mCtx.fillRect(dx-3, dy-3, 6, 6); });
  } else {
    Object.values(sharedNodes).forEach(n => { const dx = (n.x - centerX) * scale, dy = (n.y - centerY) * scale; mCtx.fillStyle = "#fff000"; if(Math.hypot(dx, dy) < 80) mCtx.fillRect(dx-3, dy-3, 6, 6); });
  }
  
  Object.values(others).forEach(o => { 
    const dx = (o.x - centerX) * scale, dy = (o.y - centerY) * scale; 
    let oCol = "#32ff7e";
    if (gameMode === 'team_vs') {
      oCol = (o.team === 'RED') ? "#ff3e3e" : (o.team === 'BLUE' ? "#3e82ff" : "#00f2ff");
    }
    mCtx.fillStyle = oCol; 
    if(Math.hypot(dx, dy) < 80) mCtx.fillRect(dx-2, dy-2, 4, 4); 
  });
  
  if (isVsMode() && p.safeZoneR !== undefined) {
    const sdx = (p.safeZoneX - centerX) * scale;
    const sdy = (p.safeZoneY - centerY) * scale;
    const sdr = Math.max(0, p.safeZoneR * scale);
    mCtx.fillStyle = "rgba(255, 0, 0, 0.35)";
    mCtx.beginPath(); mCtx.arc(0, 0, 80, 0, Math.PI * 2); mCtx.arc(sdx, sdy, sdr, 0, Math.PI * 2, true); mCtx.fill();
    mCtx.strokeStyle = "#ff0055"; mCtx.lineWidth = 1.5; mCtx.beginPath(); mCtx.arc(sdx, sdy, sdr, 0, Math.PI * 2); mCtx.stroke();
  }
  mCtx.restore(); 
  
  let myIconCol = "#00f2ff"; 
  if (gameMode === 'team_vs') { myIconCol = (p.team === 'RED') ? "#ff3e3e" : (p.team === 'BLUE' ? "#3e82ff" : "#00f2ff"); }
  if (!window.isSpectating) { mCtx.fillStyle = myIconCol; mCtx.beginPath(); mCtx.arc(center, center, 4, 0, 7); mCtx.fill(); } 
  else { mCtx.fillStyle = "rgba(255, 255, 255, 0.5)"; mCtx.beginPath(); mCtx.arc(center, center, 3, 0, 7); mCtx.fill(); }
}

function startSpectate() {
  window.isSpectating = true;
  window.matchEnding = false;
  isOver = false; 
  overScreen.style.display = 'none';
  const viewScale = GAME_SCALE * 0.8;
  camX = p.x - (w / 2) / viewScale; camY = p.y - (h / 2) / viewScale;
  const btnLeave = document.getElementById('btn-leave-spectate');
  if (btnLeave) btnLeave.style.display = 'block';
  if (typeof survivorsContainer !== 'undefined' && survivorsContainer) { survivorsContainer.style.display = 'block'; survivorsContainer.style.zIndex = '100'; }
  const minimapCont = document.getElementById('minimap-container');
  if (minimapCont) { minimapCont.style.display = 'block'; minimapCont.style.zIndex = '100'; }
  if('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    const moveBase = document.getElementById('move-base'); if (moveBase) moveBase.style.display = 'block';
  }
}

function loop() {
  if (!gameStarted) return;
  if (isVsMode() && p.matchStartTime) {
    const elapsedSec = (Date.now() - p.matchStartTime) / 1000;
    const shrinkStart = 300, shrinkEnd = 600, initialR = Math.max(MAP_W, MAP_H) * TILE_SIZE, minR = 600;       
    p.safeZoneX = (MAP_W * TILE_SIZE) / 2; p.safeZoneY = (MAP_H * TILE_SIZE) / 2;
    if (elapsedSec < shrinkStart) { p.safeZoneR = initialR; } 
    else { const progress = Math.min(1, (elapsedSec - shrinkStart) / (shrinkEnd - shrinkStart)); p.safeZoneR = initialR - (initialR - minR) * progress; }
  }

  if (isVsMode()) {
    const aliveIds = Object.keys(others);
    if (aliveIds.length > 0) { window.lastAliveNames = aliveIds.map(id => others[id].name || "UNKNOWN"); }
    if (typeof survivorsVal !== 'undefined' && survivorsVal) { survivorsVal.innerText = aliveIds.length + (p.hp > 0 ? 1 : 0); }
    const teamContainer = document.getElementById('team-status-container');
    const teamList = document.getElementById('team-members-list');
    if (gameMode === 'team_vs' && teamContainer && teamList) {
      teamContainer.style.display = 'block'; 
      let html = '';
      const myAliveStatus = p.hp > 0 ? `<span class="member-alive">ALIVE</span>` : `<span class="member-dead">DEAD</span>`;
      const myNameClass = p.hp > 0 ? "member-name" : "member-name member-dead";
      html += `<li class="member-item"><span class="${myNameClass}">[YOU] ${myPlayerName}</span>${myAliveStatus}</li>`;
      Object.keys(others).forEach(id => {
        const o = others[id];
        if (o.team === p.team) {
          const isAlive = o.hp > 0, status = isAlive ? `<span class="member-alive">ALIVE</span>` : `<span class="member-dead">DEAD</span>`, nameClass = isAlive ? "member-name" : "member-name member-dead";
          html += `<li class="member-item"><span class="${nameClass}">${o.name || "UNKNOWN"}</span>${status}</li>`;
        }
      });
      if (teamList.innerHTML !== html) { teamList.innerHTML = html; }
    } else if (teamContainer) { teamContainer.style.display = 'none'; }
  }

  if (isOver || isPaused) { loopId = requestAnimationFrame(loop); return; }
  shake *= 0.88; ctx.fillStyle = "#050505"; ctx.fillRect(0,0,w,h);
  const viewScale = window.isSpectating ? GAME_SCALE * 0.8 : GAME_SCALE;
  ctx.save(); ctx.scale(viewScale, viewScale);
  if (shake > 0.5) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);
  const sX = Math.floor(camX/TILE_SIZE), sY = Math.floor(camY/TILE_SIZE), eX = sX + Math.ceil((w/viewScale)/TILE_SIZE)+1, eY = sY + Math.ceil((h/viewScale)/TILE_SIZE)+1;
  for(let y=sY; y<eY; y++) for(let x=sX; x<eX; x++) if(y>=0 && y<MAP_H && x>=0 && x<MAP_W && map[y] && map[y][x]) { 
    ctx.fillStyle = "#2a2a2a"; ctx.fillRect(x*TILE_SIZE-camX, y*TILE_SIZE-camY, TILE_SIZE, TILE_SIZE); 
    ctx.strokeStyle = "#444"; ctx.lineWidth = 1; ctx.strokeRect(x*TILE_SIZE-camX, y*TILE_SIZE-camY, TILE_SIZE, TILE_SIZE); 
  }
  
  if (isVsMode() && p.safeZoneR !== undefined) {
    ctx.save();
    const sx = p.safeZoneX - camX, sy = p.safeZoneY - camY;
    ctx.fillStyle = "rgba(255, 0, 0, 0.25)"; ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.arc(sx, sy, p.safeZoneR, 0, Math.PI * 2, true); ctx.fill();
    ctx.strokeStyle = "#ff0055"; ctx.lineWidth = 4; ctx.setLineDash([15, 10]); ctx.beginPath(); ctx.arc(sx, sy, p.safeZoneR, 0, Math.PI * 2); ctx.stroke();
    if (!window.isSpectating) {
      const dist = Math.hypot(p.x - p.safeZoneX, p.y - p.safeZoneY);
      if (dist > p.safeZoneR && p.hp > 0) { ctx.fillStyle = `rgba(255, 0, 0, ${0.1 + Math.abs(Math.sin(Date.now() / 150)) * 0.2})`; ctx.fillRect(0, 0, w, h); }
    }
    ctx.restore();
  }

  if (!window.isSpectating) { p.update(); p.draw(); } 
  else {
    let spd = 10;
    if (keys['KeyW']) camY -= spd; if (keys['KeyS']) camY += spd; if (keys['KeyA']) camX -= spd; if (keys['KeyD']) camX += spd;
    if (typeof touchMoveDir !== 'undefined' && (touchMoveDir.x !== 0 || touchMoveDir.y !== 0)) { camX += touchMoveDir.x * spd; camY += touchMoveDir.y * spd; }
  }
  
  if (isVsMode()) {
    Object.keys(sharedDrops).forEach(did => {
      const drop = sharedDrops[did], dx = drop.x - camX, dy = drop.y - camY;
      if (drop.type === 'health') { ctx.shadowBlur = 15; ctx.shadowColor = "#32ff7e"; ctx.fillStyle = '#32ff7e'; ctx.fillRect(dx-2, dy-6, 4, 12); ctx.fillRect(dx-6, dy-2, 12, 4); ctx.shadowBlur = 0; } 
      else if (drop.type === 'grenade') { ctx.shadowBlur = 15; ctx.shadowColor = "#00f2ff"; ctx.fillStyle = '#00f2ff'; ctx.fillRect(dx-5, dy-5, 10, 10); ctx.shadowBlur = 0; }
      const dist = Math.hypot(p.x - drop.x, p.y - drop.y);
      if (!window.isSpectating && dist < 50 && p.hp > 0 && !isOver) {
        // Firebase(dropsRef.child(did).remove()) を Socket(pickup_drop) に置き換え
        socket.emit('pickup_drop', { dropId: did });
        // クライアント側で即消去して演出
        if (drop.type === 'health') items.push(new HealthItem(drop.x, drop.y));
        else if (drop.type === 'grenade') items.push(new GrenadeItem(drop.x, drop.y));
        delete sharedDrops[did]; 
      }
    });

    Object.keys(sharedNodes).forEach(nid => {
      const n = sharedNodes[nid], nx = n.x, ny = n.y;
      ctx.save(); ctx.translate(nx - camX, ny - camY); 
      ctx.fillStyle = "rgba(255, 240, 0, 0.15)"; ctx.beginPath(); ctx.moveTo(0, -21); ctx.lineTo(21, 0); ctx.lineTo(0, 21); ctx.lineTo(-21, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255, 240, 0, 0.2)"; ctx.strokeStyle = "#fff000"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(15, 0); ctx.lineTo(0, 15); ctx.lineTo(-15, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#000"; ctx.fillRect(-15, -23, 30, 4);
      ctx.fillStyle = "#fff000"; ctx.fillRect(-15, -23, 30 * (Math.max(0, n.hp) / n.maxHp), 4); ctx.restore();
      
      bullets.forEach(b => {
        if (!b.dead && !b.hitList.includes(nid) && Math.hypot(b.x - nx, b.y - ny) < 15 + b.r + 5) {
          b.hitList.push(nid); b.pierce--; if(b.pierce <= 0) b.dead = true; 
          let crit = Math.random() < p.critChance ? p.critMult : 1;
          damageSharedNode(nid, n, b.atk * crit);
        }
      });
      if (!window.isSpectating && p.swinging > 0 && !p.swingHitList.includes(nid) && Math.hypot(nx - p.x, ny - p.y) < p.swordRange + 15) {
        let diff = (Math.atan2(ny - p.y, nx - p.x) - p.swingStartAng) % (Math.PI * 2); if (diff < 0) diff += Math.PI * 2;
        if (diff <= ((12 - p.swinging) / 12) * p.swingArc) { 
          p.swingHitList.push(nid); let crit = Math.random() < p.critChance ? p.critMult : 1;
          damageSharedNode(nid, n, (4 + p.atkBonus) * crit); 
        }
      }
      grenades.forEach(g => {
        if (g.exploded && g.owner === myId && !g.hitListNodes?.includes(nid) && Math.hypot(nx - g.x, ny - g.y) < g.blastR) {
          if(!g.hitListNodes) g.hitListNodes = []; g.hitListNodes.push(nid); 
          damageSharedNode(nid, n, g.dmg); 
        }
      });
    });
    
    const playersList = Object.keys(others); playersList.push(myId); playersList.sort();
    let maxNodes = 10;
    if (p.safeZoneR !== undefined) {
      const maxR = Math.max(MAP_W, MAP_H) * TILE_SIZE, minR = 400; 
      let rRatio = (p.safeZoneR - minR) / (maxR - minR);
      rRatio = Math.max(0, Math.min(1, rRatio));
      maxNodes = Math.floor(3 + rRatio * 7);
    }
    // マスタークライアントのみがノードを生成 (Socket.io経由)
    if (playersList[0] === myId && Math.random() < 0.020 && Object.keys(sharedNodes).length < maxNodes) {
      let ex, ey, isValid = false, attempts = 0;
      do { 
        ex = Math.random() * MAP_W * TILE_SIZE; ey = Math.random() * MAP_H * TILE_SIZE; 
        isValid = !getWall(ex, ey);
        if (isValid && p.safeZoneR !== undefined) { if (Math.hypot(ex - p.safeZoneX, ey - p.safeZoneY) > p.safeZoneR * 0.9) isValid = false; }
        attempts++;
      } while (!isValid && attempts < 100);
      if (isValid) {
        socket.emit('spawn_node', { id: 'n_' + Math.random().toString(36).substring(2, 9), x: ex, y: ey, hp: 7 + level * 1, maxHp: 7 + level * 1 });
      }
    }
  }

  if (!window.seenCrits) window.seenCrits = [];
  if (!window.previousOthers) window.previousOthers = {};
  
  Object.keys(window.previousOthers).forEach(id => {
    if (!others[id]) {
      const po = window.previousOthers[id];
      if (po.hp < po.maxHp * 0.6) {
        explosions.push(new Explosion(po.x, po.y, 60, "rgba(255, 62, 62, 0.7)", "KILL", "#ff3e3e"));
        if (window.myKills[id] && Date.now() - window.myKills[id] < 2000) {
          killLogs.push({ text: `TARGET ELIMINATED : ${po.name}`, timer: 240 });
          for(let i=0; i<4; i++) cores.push(new ExpCore(po.x + (Math.random()-0.5)*60, po.y + (Math.random()-0.5)*60));
          spawnDrop(po.x, po.y); if(!window.isSpectating) shake = 20; delete window.myKills[id]; 
        }
      }
    }
  });
  window.previousOthers = {};

  Object.keys(others).forEach(id => {
    const o = others[id];
    const ox = o.x - camX, oy = o.y - camY;
    if (o.crits) {
      o.crits.forEach(c => {
        if (!window.seenCrits.includes(c.id)) {
          window.seenCrits.push(c.id); if (window.seenCrits.length > 200) window.seenCrits.shift();
          explosions.push(new Explosion(c.x, c.y, 15, "rgba(255, 60, 0, 0.4)", "CRIT!", "#ff3c00"));
        }
      });
    }
    let oCol = "#32ff7e"; if (gameMode === 'team_vs') { oCol = (o.team === 'RED') ? "#ff3e3e" : (o.team === 'BLUE' ? "#3e82ff" : "#00f2ff"); }
    ctx.save(); ctx.translate(ox, oy); ctx.rotate(o.ang);
    ctx.fillStyle = oCol; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(6, -7); ctx.lineTo(6, 7); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.globalAlpha = 1.0; ctx.fillStyle = oCol; ctx.beginPath(); ctx.arc(ox, oy, 13, 0, 7); ctx.fill();
    ctx.fillStyle = "#000"; ctx.fillRect(ox-15, oy-25, 30, 4); ctx.fillStyle = oCol; ctx.fillRect(ox-15, oy-25, 30*(o.hp/o.maxHp), 4);
    ctx.fillStyle = "#fff"; ctx.font = "bold 10px Segoe UI"; ctx.textAlign = "center"; ctx.fillText(o.name || "UNKNOWN", ox, oy - 32);
    
    if (o.swinging > 0) {
      const p_val = (12 - o.swinging) / 12, currentAng = o.swingStartAng + p_val * (Math.PI * 1.2), tipX = ox + Math.cos(currentAng) * o.swordRange, tipY = oy + Math.sin(currentAng) * o.swordRange;
      const grad = ctx.createRadialGradient(ox, oy, 10, ox, oy, o.swordRange); grad.addColorStop(0, 'transparent'); grad.addColorStop(1, `rgba(255, 255, 255, ${0.4 * (1 - p_val * 0.7)})`); 
      ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.arc(ox, oy, o.swordRange, o.swingStartAng, currentAng); ctx.closePath(); ctx.fill();
      ctx.save(); ctx.shadowBlur = 15; ctx.shadowColor = oCol; const bladeGrad = ctx.createLinearGradient(ox, oy, tipX, tipY);
      bladeGrad.addColorStop(0.2, oCol); bladeGrad.addColorStop(0.8, "#fff"); bladeGrad.addColorStop(1, "#fff");
      ctx.strokeStyle = bladeGrad; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(ox + Math.cos(currentAng) * 5, py + Math.sin(currentAng) * 5); ctx.lineTo(tipX, tipY); ctx.stroke(); ctx.restore();
    }
    if (o.bullets) o.bullets.forEach(b => { ctx.fillStyle = b.col; ctx.beginPath(); ctx.arc(b.x - camX, b.y - camY, b.r, 0, 7); ctx.fill(); });
    if (o.grenades) o.grenades.forEach(g => {
      let isAlly = (gameMode === 'team_vs' && o.team === p.team), gCol = isAlly ? "#00f2ff" : "#ff3e3e", gAlphaBase = isAlly ? "0, 242, 255" : "255, 62, 62";
      if (!g.exploded) { ctx.fillStyle = gCol; ctx.beginPath(); ctx.arc(g.x-camX, g.y-camY, 6, 0, 7); ctx.fill(); ctx.strokeStyle = `rgba(${gAlphaBase}, 0.3)`; ctx.beginPath(); ctx.arc(g.x-camX, g.y-camY, g.blastR, 0, 7); ctx.stroke(); } 
      else { ctx.fillStyle = `rgba(${gAlphaBase}, 0.4)`; ctx.beginPath(); ctx.arc(g.x-camX, g.y-camY, g.blastR, 0, 7); ctx.fill(); }
    });
    
    // 他プレイヤーへの当たり判定は script2 の Player.update() または各弾丸の update() で emit しているので、ここでは描画のみに集中
    window.previousOthers[id] = { x: o.x, y: o.y, hp: o.hp, maxHp: o.maxHp, name: o.name || "UNKNOWN" };
  });
  
  if (gameMode === 'solo' && enemies.length < 7 + Math.floor(level/1.1)) enemies.push(new Enemy());
  [bullets, enemyBullets, cores, items, enemies, grenades, nodes, explosions, particles].forEach(arr => {
    for(let i=arr.length-1; i>=0; i--) {
      arr[i].update(); arr[i].draw();
      if(arr === cores && !window.isSpectating && Math.hypot(p.x-arr[i].x, p.y-arr[i].y) < 25) { arr[i].dead = true; exp++; if(exp >= nextExp) { level++; exp=0; nextExp+=5; isPaused=true; openPanel(); } }
      if(arr === enemies && !window.isSpectating && arr[i].type !== 'TICK' && Math.hypot(p.x-arr[i].x, p.y-arr[i].y) < p.r + arr[i].r) { if (p.contactCd <= 0) { p.hp -= (3 + level * 0.5); p.contactCd = 30; shake = 10; } }
      if(arr[i].dead || (arr[i].timer !== undefined && arr[i].timer <= 0 && arr !== grenades)) arr.splice(i, 1);
    }
  });
  ctx.restore(); 
  drawMinimap();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.textAlign = "right"; ctx.textBaseline = "top"; ctx.font = "bold 14px Segoe UI";
  const mRect = mCanvas.getBoundingClientRect(), mapRightX = mRect.right, mapBottomY = mRect.bottom + 20; 

  for (let i = 0; i < killLogs.length; i++) {
    let log = killLogs[i]; log.timer--;
    let alpha = Math.min(1, log.timer / 30), textY = mapBottomY + i * 30, textWidth = ctx.measureText(log.text).width, boxWidth = textWidth + 20;
    ctx.fillStyle = `rgba(0, 20, 30, ${alpha * 0.8})`; ctx.shadowBlur = 10; ctx.shadowColor = `rgba(0, 242, 255, ${alpha * 0.3})`; ctx.strokeStyle = `rgba(0, 242, 255, ${alpha * 0.5})`; ctx.lineWidth = 1;
    ctx.fillRect(mapRightX - boxWidth, textY - 5, boxWidth, 24); ctx.strokeRect(mapRightX - boxWidth, textY - 5, boxWidth, 24);
    ctx.fillStyle = `rgba(255, 62, 62, ${alpha})`; ctx.shadowBlur = 8; ctx.shadowColor = `rgba(255, 62, 62, ${alpha})`; ctx.fillText(log.text, mapRightX - 10, textY);
    if (log.timer <= 0) killLogs.splice(i, 1);
  }

  if (isVsMode() && window.isSpectating && vsMatchActive) {
    const survivorIds = Object.keys(others);
    let matchIsOver = false, winnerName = "DRAW";
    if (gameMode === 'team_vs') {
      const aliveTeams = new Set(survivorIds.map(id => others[id].team).filter(t => t));
      if (aliveTeams.size <= 1 && !window.matchEnding) {
        matchIsOver = true; winnerName = aliveTeams.size === 1 ? `${[...aliveTeams][0]} TEAM WIN!` : "DRAW (ANNIHILATED)";
      }
    } else {
      if (survivorIds.length <= 1 && !window.matchEnding) {
        matchIsOver = true; winnerName = survivorIds.length === 1 ? others[survivorIds[0]].name : (window.lastAliveNames?.[0] || "DRAW");
      }
    }
    if (matchIsOver) {
      window.matchEnding = true;
      let finishScreen = document.getElementById('match-finish-screen');
      if (!finishScreen) {
        finishScreen = document.createElement('div'); finishScreen.id = 'match-finish-screen';
        finishScreen.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:9999;";
        finishScreen.innerHTML = `<h1 style="color:var(--cyan); font-size:48px; letter-spacing:5px; text-shadow:0 0 20px var(--cyan); margin-bottom: 10px;">MATCH FINISHED</h1><div class="final-score-display" id="match-winner-name">WINNER: <span>${winnerName}</span></div><button id="btn-spec-back">RETURN TO TITLE</button>`;
        document.body.appendChild(finishScreen);
        document.getElementById('btn-spec-back').onclick = () => { finishScreen.style.display = 'none'; window.matchEnding = false; backToTitle(); };
      } else { document.getElementById('match-winner-name').innerHTML = `WINNER: <span>${winnerName}</span>`; finishScreen.style.display = 'flex'; }
      const btnLeave = document.getElementById('btn-leave-spectate'); if (btnLeave) btnLeave.style.display = 'none';
      if(document.getElementById('move-base')) document.getElementById('move-base').style.display = 'none';
      if(document.getElementById('aim-base')) document.getElementById('aim-base').style.display = 'none';
    }
    if (!window.matchEnding) {
      ctx.textAlign = "center"; ctx.fillStyle = "rgba(255, 255, 255, 0.5)"; ctx.font = "bold 24px Segoe UI"; ctx.fillText("SPECTATOR MODE", w / 2, 50);
      ctx.fillStyle = "#32ff7e"; ctx.font = "bold 20px Segoe UI"; ctx.fillText(`ALIVE: ${survivorIds.length}`, w / 2, 85);
    }
  }
  ctx.restore();

  if (isVsMode() && p.matchStartTime) {
    const elapsed = (Date.now() - p.matchStartTime) / 1000, shrinkStart = 300, shrinkEnd = 600;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (elapsed >= shrinkStart && elapsed <= shrinkEnd) {
      ctx.fillStyle = "rgba(255, 50, 50, 0.7)"; ctx.fillRect(w/2-120, 15, 240, 35);
      ctx.fillStyle = "#fff"; ctx.font = "bold 20px Segoe UI"; ctx.textAlign = "center"; ctx.fillText("⚠️ エリア縮小中...", w/2, 40);
    }
    ctx.restore();
  }

  if (p.hp <= 0 && !isOver && !window.isSpectating) { 
    isOver = true; if(levelUpTimeout) { clearTimeout(levelUpTimeout); levelUpTimeout = null; } 
    isLevelUpInvincible = false; if (gameMode === 'solo') submitSoloScore();
    // 死亡通知
    socket.emit('player_death', { deadPlayerId: myId });
    finalScoreVal.innerText = score; overScreen.style.display = 'flex'; overScreen.style.zIndex = '9999'; overScreen.style.pointerEvents = 'auto'; 
    uiLayer.style.display = 'none'; btnGrenade.style.display = 'none'; 
    if(document.getElementById('move-base')) document.getElementById('move-base').style.display = 'none';
    if(document.getElementById('aim-base')) document.getElementById('aim-base').style.display = 'none';
    const btnSpectate = document.getElementById('btn-spectate'); if (btnSpectate) btnSpectate.style.display = isVsMode() ? 'inline-block' : 'none';
  }
  loopId = requestAnimationFrame(loop);
}

function openPanel() {
  lvlPanel.style.display = 'block'; cardWrap.innerHTML = ''; isLevelUpInvincible = true;
  const choices = [...UPGRADES].sort(()=>.5-Math.random()).slice(0,3);
  const handleChoice = (u, e) => {
    if(levelUpTimeout) clearTimeout(levelUpTimeout); isLevelUpInvincible = false; u.action(); 
    if (e) e.stopPropagation();
    if (window.pendingLevelUps && window.pendingLevelUps > 0) { window.pendingLevelUps--; level++; nextExp += 5; openPanel(); } 
    else { if (window.pendingLevelUps === 0) { level = 1; exp = 0; nextExp = 5; window.pendingLevelUps = null; } isPaused = false; lvlPanel.style.display = 'none'; }
  };
  choices.forEach(u => {
    const c = document.createElement('div'); c.className='card'; c.innerHTML = `<h2>${u.name}</h2><p>${u.desc}</p>`;
    c.onclick = (e) => handleChoice(u, e); cardWrap.appendChild(c);
  });
  if(levelUpTimeout) clearTimeout(levelUpTimeout);
  levelUpTimeout = setTimeout(() => { 
    if (lvlPanel.style.display === 'block') { handleChoice(choices[Math.floor(Math.random() * choices.length)], null); } 
  }, 10000);
}
window.onload = () => { ctx.fillStyle = "#050505"; ctx.fillRect(0,0,w,h); };
