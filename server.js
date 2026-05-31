const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 静的ファイルの配信設定（publicフォルダ以下にHTMLなどを配置する）
app.use(express.static(path.join(__dirname, 'public')));

// サーバー上で管理するアクティブな部屋のデータ
const rooms = {};

// グローバルチャット履歴（最大50件）
const globalChatHistory = [];

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 接続直後に既存のグローバルチャット履歴をクライアントへ送信
  socket.emit('global_chat_history', globalChatHistory);

  // --- グローバルチャット ---
  socket.on('send_global_chat', (data) => {
    const msg = {
      name: data.name,
      text: data.text,
      timestamp: Date.now()
    };
    globalChatHistory.push(msg);
    if (globalChatHistory.length > 50) globalChatHistory.shift();
    io.emit('global_chat_received', msg);
  });

  // --- ロビーへの参加 ---
  socket.on('join_lobby', ({ roomCode, playerName, myId, selectedTeam }) => {
    const code = roomCode.trim() || 'public';
    socket.join(code);

    // ソケットのセッションデータに情報を格納
    socket.data.roomCode = code;
    socket.data.myId = myId;
    socket.data.playerName = playerName;

    if (!rooms[code]) {
      rooms[code] = {
        state: 'waiting', // waiting | playing
        mode: 'solo_vs',  // solo_vs | team_vs
        map: null,
        lobby: {},
        players: {},
        teams: {},
        nodes: {},
        drops: {},
        chat: []
      };
    }

    rooms[code].lobby[myId] = { name: playerName, team: selectedTeam, socketId: socket.id };

    // 参加者全員にロビー情報を同期
    io.to(code).emit('lobby_update', rooms[code].lobby);
    io.to(code).emit('mode_update', rooms[code].mode);
    io.to(code).emit('state_update', rooms[code].state);
    
    // 既存のチャット履歴を新しい参加者に送信
    socket.emit('chat_history', rooms[code].chat);

    // 既にマップが生成されている場合は同期
    if (rooms[code].map) {
      socket.emit('map_update', rooms[code].map);
    }
  });

  // チーム変更
  socket.on('change_team', ({ team }) => {
    const { roomCode, myId } = socket.data;
    if (roomCode && rooms[roomCode] && rooms[roomCode].lobby[myId]) {
      rooms[roomCode].lobby[myId].team = team;
      io.to(roomCode).emit('lobby_update', rooms[roomCode].lobby);
    }
  });

  // ゲームモード（バトロワ/チーム戦）の変更
  socket.on('toggle_mode', (newMode) => {
    const { roomCode } = socket.data;
    if (roomCode && rooms[roomCode]) {
      rooms[roomCode].mode = newMode;
      io.to(roomCode).emit('mode_update', newMode);
    }
  });

  // ゲーム開始
  socket.on('start_match', ({ mapData, mode }) => {
    const { roomCode } = socket.data;
    if (roomCode && rooms[roomCode]) {
      rooms[roomCode].state = 'playing';
      rooms[roomCode].mode = mode;
      rooms[roomCode].map = mapData;
      rooms[roomCode].players = {};
      rooms[roomCode].nodes = {};
      rooms[roomCode].drops = {};

      // チーム戦の場合、各プレイヤーの最終チームを確定する
      if (mode === 'team_vs') {
        const lobbyPlayers = rooms[roomCode].lobby;
        const pIds = Object.keys(lobbyPlayers);
        const teams = {};

        let redCount = 0;
        let blueCount = 0;
        const autoPlayers = [];

        pIds.forEach(id => {
          const pref = lobbyPlayers[id].team || 'AUTO';
          if (pref === 'RED') {
            teams[id] = 'RED';
            redCount++;
          } else if (pref === 'BLUE') {
            teams[id] = 'BLUE';
            blueCount++;
          } else {
            autoPlayers.push(id);
          }
        });

        // AUTO設定のプレイヤーを振り分ける
        autoPlayers.forEach(id => {
          if (redCount <= blueCount) {
            teams[id] = 'RED';
            redCount++;
          } else {
            teams[id] = 'BLUE';
            blueCount++;
          }
        });
        rooms[roomCode].teams = teams;
        io.to(roomCode).emit('teams_update', teams);
      }

      io.to(roomCode).emit('match_started', { mode });
      io.to(roomCode).emit('state_update', 'playing');
      io.to(roomCode).emit('map_update', mapData);
    }
  });

  // --- ゲーム中のリアルタイム同期 ---
  
  // プレイヤーデータの同期
  socket.on('sync_player', (playerData) => {
    const { roomCode, myId } = socket.data;
    if (roomCode && rooms[roomCode] && rooms[roomCode].state === 'playing') {
      rooms[roomCode].players[myId] = playerData;
      // 他のプレイヤーに位置・状態データを送信
      socket.to(roomCode).emit('players_update', rooms[roomCode].players);
    }
  });

  // ダメージイベントの同期
  socket.on('damage_event', ({ targetId, dmg }) => {
    const { roomCode } = socket.data;
    if (roomCode && rooms[roomCode]) {
      io.to(roomCode).emit('take_damage', { targetId, dmg });
    }
  });

  // プレイヤー死亡時
  socket.on('player_death', ({ deadPlayerId }) => {
    const { roomCode } = socket.data;
    if (roomCode && rooms[roomCode]) {
      if (rooms[roomCode].players[deadPlayerId]) {
        delete rooms[roomCode].players[deadPlayerId];
      }
      io.to(roomCode).emit('player_dead', deadPlayerId);
    }
  });

  // 共有データノード（黄色いクリスタル）の同期
  socket.on('spawn_node', (nodeData) => {
    const { roomCode } = socket.data;
    if (roomCode && rooms[roomCode]) {
      rooms[roomCode].nodes[nodeData.id] = nodeData;
      io.to(roomCode).emit('node_spawned', nodeData);
    }
  });

  socket.on('damage_node', ({ nodeId, dmg }) => {
    const { roomCode } = socket.data;
    if (roomCode && rooms[roomCode] && rooms[roomCode].nodes[nodeId]) {
      const node = rooms[roomCode].nodes[nodeId];
      node.hp -= dmg;
      if (node.hp <= 0) {
        delete rooms[roomCode].nodes[nodeId];
        io.to(roomCode).emit('node_destroyed', { nodeId, x: node.x, y: node.y });
      } else {
        io.to(roomCode).emit('node_updated', { nodeId, hp: node.hp });
      }
    }
  });

  // ドロップアイテム（回復・グレネード）の同期
  socket.on('spawn_drop', (dropData) => {
    const { roomCode } = socket.data;
    if (roomCode && rooms[roomCode]) {
      const dropId = 'd_' + Math.random().toString(36).substring(2, 9);
      rooms[roomCode].drops[dropId] = dropData;
      io.to(roomCode).emit('drop_spawned', { dropId, dropData });
    }
  });

  socket.on('pickup_drop', ({ dropId }) => {
    const { roomCode } = socket.data;
    if (roomCode && rooms[roomCode] && rooms[roomCode].drops[dropId]) {
      const drop = rooms[roomCode].drops[dropId];
      delete rooms[roomCode].drops[dropId];
      io.to(roomCode).emit('drop_picked', { dropId, drop });
    }
  });

  // 部屋内個別チャット
  socket.on('send_chat', (text) => {
    const { roomCode, playerName } = socket.data;
    if (roomCode && rooms[roomCode]) {
      const chatMsg = {
        name: playerName,
        text: text,
        timestamp: Date.now()
      };
      rooms[roomCode].chat.push(chatMsg);
      if (rooms[roomCode].chat.length > 50) rooms[roomCode].chat.shift();
      io.to(roomCode).emit('chat_received', chatMsg);
    }
  });

  // 観戦モードの参加
  socket.on('join_spectator', ({ roomCode, myId }) => {
    const code = roomCode.trim() || 'public';
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.myId = myId;
    socket.data.playerName = "SPECTATOR";

    if (rooms[code]) {
      socket.emit('state_update', rooms[code].state);
      socket.emit('mode_update', rooms[code].mode);
      socket.emit('map_update', rooms[code].map);
      socket.emit('teams_update', rooms[code].teams || {});
      socket.emit('players_update', rooms[code].players || {});
      socket.emit('node_list_update', rooms[code].nodes || {});
      socket.emit('drop_list_update', rooms[code].drops || {});
    }
  });

  // --- 切断時の処理 ---
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const { roomCode, myId } = socket.data;

    if (roomCode && rooms[roomCode]) {
      // ロビーから削除
      if (rooms[roomCode].lobby[myId]) {
        delete rooms[roomCode].lobby[myId];
        io.to(roomCode).emit('lobby_update', rooms[roomCode].lobby);
      }

      // プレイ中リストから削除
      if (rooms[roomCode].players[myId]) {
        delete rooms[roomCode].players[myId];
        io.to(roomCode).emit('player_disconnected', myId);
      }

      // 部屋に誰もいなくなったらメモリを解放
      const lobbyCount = Object.keys(rooms[roomCode].lobby).length;
      const playerCount = Object.keys(rooms[roomCode].players).length;
      if (lobbyCount === 0 && playerCount === 0) {
        delete rooms[roomCode];
        console.log(`Room [${roomCode}] removed (empty)`);
      }
    }
  });

  // 管理者リセット機能
  socket.on('admin_reset_room', (targetRoomCode) => {
    if (rooms[targetRoomCode]) {
      delete rooms[targetRoomCode];
      io.to(targetRoomCode).emit('room_reset_by_admin');
      console.log(`Room [${targetRoomCode}] forced reset by admin`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
