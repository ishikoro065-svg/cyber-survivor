/**
 * CYBER SURVIVOR - Game Server
 * Node.js + Socket.io (Render 用)
 * 
 * 担当範囲：
 *   - プレイヤーのリアルタイム位置同期
 *   - ダメージイベント中継
 *   - ノード / ドロップ同期
 *   - 部屋（合言葉）管理
 *   - すべてメモリ上で処理（DBへの書き込みなし）
 * 
 * Firebase に残す範囲：
 *   - solo_scores（ランキング）
 *   - global_chat / rooms/{room}/chat（チャット）
 *   - rooms/{room}/lobby（ロビー管理）
 *   - rooms/{room}/state, mode, teams, map（試合開始トリガー）
 */

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // クライアントが 33ms 間隔で送信するので ping 間隔は余裕を持って設定
  pingInterval: 10000,
  pingTimeout:  5000,
});

// ---- ヘルスチェック（Render の無料プランはスリープするので必要） ----
app.get('/', (_req, res) => res.send('CYBER SURVIVOR server running'));

// ====================================================================
// メモリ上のルーム状態
// rooms[roomCode] = {
//   players : { [id]: { x, y, hp, maxHp, ang, name, bullets, grenades,
//                       swinging, swingStartAng, swordRange, crits, team } },
//   nodes   : { [nid]: { x, y, hp, maxHp } },
//   drops   : { [did]: { type, x, y } },
// }
// ====================================================================
const rooms = {};

function getRoom(code) {
  if (!rooms[code]) {
    rooms[code] = { players: {}, nodes: {}, drops: {} };
  }
  return rooms[code];
}

function cleanEmptyRoom(code) {
  const room = rooms[code];
  if (!room) return;
  if (Object.keys(room.players).length === 0) {
    delete rooms[code];
  }
}

// ====================================================================
// Socket.io イベント
// ====================================================================
io.on('connection', (socket) => {

  let currentRoom = null;
  let myId        = null;

  // ------------------------------------------------------------------
  // クライアントが部屋に参加（試合開始時に呼ばれる）
  // payload: { roomCode, playerId, name, team }
  // ------------------------------------------------------------------
  socket.on('joinRoom', ({ roomCode, playerId, name, team }) => {
    currentRoom = roomCode;
    myId        = playerId;

    socket.join(roomCode);

    const room = getRoom(roomCode);

    // 既存の全プレイヤー状態を新規参加者に送る（スナップショット）
    socket.emit('roomSnapshot', {
      players : room.players,
      nodes   : room.nodes,
      drops   : room.drops,
    });

    // 初期エントリーを登録（位置は最初の playerUpdate まで null）
    room.players[playerId] = {
      x: 0, y: 0, hp: 100, maxHp: 100, ang: 0,
      name: name || 'ANONYMOUS', team: team || '',
      bullets: [], grenades: [], swinging: 0,
      swingStartAng: 0, swordRange: 90, crits: [],
    };

    // 他プレイヤーに新規参加を通知
    socket.to(roomCode).emit('playerJoined', {
      id: playerId,
      data: room.players[playerId],
    });
  });

  // ------------------------------------------------------------------
  // プレイヤー位置・状態の更新（クライアントが ~33ms 毎に送信）
  // payload: { x, y, hp, maxHp, ang, name, bullets, grenades,
  //            swinging, swingStartAng, swordRange, crits, team }
  // ------------------------------------------------------------------
  socket.on('playerUpdate', (data) => {
    if (!currentRoom || !myId) return;
    const room = rooms[currentRoom];
    if (!room) return;

    // 自分のデータを上書き
    room.players[myId] = { ...data, id: myId };

    // 同じ部屋の他全員にブロードキャスト（送信者は除外）
    socket.to(currentRoom).emit('playerUpdated', {
      id   : myId,
      data : room.players[myId],
    });
  });

  // ------------------------------------------------------------------
  // ダメージイベント（発射側が検出して送信）
  // payload: { target: playerId, dmg: number }
  // ------------------------------------------------------------------
  socket.on('damageEvent', ({ target, dmg }) => {
    if (!currentRoom) return;
    // ターゲットのソケットにのみ届ける
    io.to(currentRoom).emit('damaged', { target, dmg });
  });

  // ------------------------------------------------------------------
  // ノード操作
  // ------------------------------------------------------------------

  // ノード追加 (ホストプレイヤーが生成)
  socket.on('nodeAdd', ({ nid, data }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;
    room.nodes[nid] = data;
    socket.to(currentRoom).emit('nodeAdded', { nid, data });
  });

  // ノード HP 更新
  socket.on('nodeUpdate', ({ nid, hp }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room || !room.nodes[nid]) return;
    room.nodes[nid].hp = hp;
    socket.to(currentRoom).emit('nodeUpdated', { nid, hp });
  });

  // ノード削除（HP が 0 以下になった時）
  socket.on('nodeRemove', ({ nid }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;
    delete room.nodes[nid];
    socket.to(currentRoom).emit('nodeRemoved', { nid });
  });

  // ------------------------------------------------------------------
  // ドロップ操作
  // ------------------------------------------------------------------

  // ドロップ追加
  socket.on('dropAdd', ({ did, data }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;
    room.drops[did] = data;
    socket.to(currentRoom).emit('dropAdded', { did, data });
  });

  // ドロップ取得（誰かが拾った）
  socket.on('dropRemove', ({ did }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;
    delete room.drops[did];
    // 送信者以外に削除を通知
    socket.to(currentRoom).emit('dropRemoved', { did });
  });

  // ------------------------------------------------------------------
  // 切断処理
  // ------------------------------------------------------------------
  socket.on('disconnect', () => {
    if (!currentRoom || !myId) return;
    const room = rooms[currentRoom];
    if (!room) return;

    delete room.players[myId];

    // 同室プレイヤーに退出を通知
    io.to(currentRoom).emit('playerLeft', { id: myId });

    cleanEmptyRoom(currentRoom);
  });

  // ------------------------------------------------------------------
  // 手動退出（タイトルに戻る時など）
  // ------------------------------------------------------------------
  socket.on('leaveRoom', () => {
    if (!currentRoom || !myId) return;
    const room = rooms[currentRoom];
    if (room) {
      delete room.players[myId];
      io.to(currentRoom).emit('playerLeft', { id: myId });
      cleanEmptyRoom(currentRoom);
    }
    socket.leave(currentRoom);
    currentRoom = null;
    myId        = null;
  });
});

// ====================================================================
// サーバー起動
// ====================================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CYBER SURVIVOR server listening on port ${PORT}`);
});
