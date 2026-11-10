const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 10000;

// ==========================================
// In-Memory Room & Player Store
// ==========================================
const rooms = new Map(); // roomId -> RoomObject
const clients = new Map(); // ws -> { id, name, roomId }

let clientCounter = 1;

function generateId() {
  return 'P_' + (clientCounter++) + '_' + Math.random().toString(36).substring(2, 7);
}

function generateRoomId() {
  return 'ROOM-' + Math.floor(1000 + Math.random() * 9000);
}

function getSanitizedRoomList() {
  const list = [];
  for (const [id, r] of rooms.entries()) {
    list.push({
      id: r.id,
      name: r.name,
      hasPassword: r.hasPassword,
      rounds: r.rounds,
      hostName: r.hostName,
      guestName: r.guestName,
      status: r.status,
      subMode: r.subMode || 'Modern',
      playerCount: (r.hostWs ? 1 : 0) + (r.guestWs ? 1 : 0)
    });
  }
  return list;
}

function broadcastRoomList() {
  const msg = JSON.stringify({
    type: 'ROOM_LIST_UPDATED',
    rooms: getSanitizedRoomList()
  });
  for (const [clientWs] of clients.entries()) {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(msg);
    }
  }
}

// ==========================================
// HTTP Server (For Render Health Checks)
// ==========================================
const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'Quadrate Game Real-Time Multiplayer Server',
      activeRooms: rooms.size,
      connectedClients: clients.size,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// ==========================================
// WebSocket Server
// ==========================================
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const clientId = generateId();
  clients.set(ws, {
    id: clientId,
    name: 'Player ' + clientId.substring(2, 6),
    roomId: null
  });

  // Send initial connection acknowledgement and room list
  ws.send(JSON.stringify({
    type: 'CONNECTED',
    clientId: clientId,
    rooms: getSanitizedRoomList()
  }));

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      handleClientMessage(ws, data);
    } catch (err) {
      console.error('Failed to parse WS message:', err);
    }
  });

  ws.on('close', () => {
    handleClientDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error('Client WS error:', err);
    handleClientDisconnect(ws);
  });
});

function handleClientMessage(ws, data) {
  const client = clients.get(ws);
  if (!client) return;

  switch (data.type) {
    case 'PING': {
      ws.send(JSON.stringify({ type: 'PONG', time: Date.now() }));
      break;
    }

    case 'SET_PLAYER_NAME': {
      if (data.name && typeof data.name === 'string') {
        client.name = data.name.trim().substring(0, 20);
      }
      break;
    }

    case 'LIST_ROOMS': {
      ws.send(JSON.stringify({
        type: 'ROOM_LIST',
        rooms: getSanitizedRoomList()
      }));
      break;
    }

    case 'CREATE_ROOM': {
      const roomId = generateRoomId();
      const roomName = (data.name && data.name.trim()) ? data.name.trim().substring(0, 25) : ('ห้องประลอง #' + roomId.split('-')[1]);
      const password = (data.password && data.password.trim()) ? data.password.trim().substring(0, 20) : '';
      const rounds = (data.rounds === 1 || data.rounds === 3) ? data.rounds : 2; // Best of 1, 3, 5
      const subMode = ['Modern', 'Classic', 'Sprint', 'Ultra', 'BlockBlast'].includes(data.subMode) ? data.subMode : 'Modern';

      const room = {
        id: roomId,
        name: roomName,
        password: password,
        hasPassword: password.length > 0,
        rounds: rounds,
        subMode: subMode,
        targetWins: rounds, // 1 for BO1, 2 for BO3, 3 for BO5
        hostId: client.id,
        hostName: client.name,
        hostWs: ws,
        guestId: null,
        guestName: null,
        guestWs: null,
        p1Wins: 0,
        p2Wins: 0,
        status: 'WAITING',
        currentSeed: Math.floor(Math.random() * 1000000)
      };

      rooms.set(roomId, room);
      client.roomId = roomId;

      ws.send(JSON.stringify({
        type: 'ROOM_CREATED',
        room: {
          id: room.id,
          name: room.name,
          hasPassword: room.hasPassword,
          rounds: room.rounds,
          subMode: room.subMode,
          hostName: room.hostName,
          guestName: null,
          isHost: true
        }
      }));

      broadcastRoomList();
      break;
    }

    case 'JOIN_ROOM': {
      const room = rooms.get(data.roomId);
      if (!room) {
        ws.send(JSON.stringify({ type: 'JOIN_ERROR', error: 'ไม่พบห้องที่ระบุ หรือห้องถูกปิดแล้ว' }));
        return;
      }
      if (room.guestWs && room.guestWs.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'JOIN_ERROR', error: 'ห้องนี้มีผู้เล่นเต็มแล้ว' }));
        return;
      }
      if (room.hasPassword) {
        if (!data.password || data.password !== room.password) {
          ws.send(JSON.stringify({ type: 'JOIN_ERROR', error: 'WRONG_PASSWORD', message: 'รหัสผ่านไม่ถูกต้อง' }));
          return;
        }
      }

      room.guestId = client.id;
      room.guestName = client.name;
      room.guestWs = ws;
      client.roomId = room.id;

      // Notify guest
      ws.send(JSON.stringify({
        type: 'JOIN_SUCCESS',
        room: {
          id: room.id,
          name: room.name,
          hasPassword: room.hasPassword,
          rounds: room.rounds,
          subMode: room.subMode,
          hostName: room.hostName,
          guestName: room.guestName,
          isHost: false
        }
      }));

      // Notify host
      if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
        room.hostWs.send(JSON.stringify({
          type: 'GUEST_JOINED',
          guestName: room.guestName,
          guestId: room.guestId
        }));
      }

      broadcastRoomList();
      break;
    }

    case 'START_MATCH': {
      const room = rooms.get(client.roomId);
      if (!room || room.hostId !== client.id) return;
      if (!room.guestWs || room.guestWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'ยังไม่มีผู้เล่นฝ่ายตรงข้าม' }));
        return;
      }

      room.status = 'PLAYING';
      room.p1Wins = 0;
      room.p2Wins = 0;
      room.currentSeed = Math.floor(Math.random() * 1000000);

      const startMsg = JSON.stringify({
        type: 'MATCH_STARTED',
        roomId: room.id,
        rounds: room.rounds,
        targetWins: room.targetWins,
        subMode: room.subMode,
        seed: room.currentSeed,
        hostName: room.hostName,
        guestName: room.guestName
      });

      room.hostWs.send(startMsg);
      room.guestWs.send(startMsg);
      broadcastRoomList();
      break;
    }

    case 'START_NEXT_ROUND': {
      const room = rooms.get(client.roomId);
      if (!room || room.hostId !== client.id) return;
      room.currentSeed = Math.floor(Math.random() * 1000000);
      const nextRoundMsg = JSON.stringify({
        type: 'ROUND_STARTED',
        seed: room.currentSeed,
        p1Wins: room.p1Wins,
        p2Wins: room.p2Wins
      });
      if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) room.hostWs.send(nextRoundMsg);
      if (room.guestWs && room.guestWs.readyState === WebSocket.OPEN) room.guestWs.send(nextRoundMsg);
      break;
    }

    case 'PLAYER_UPDATE': {
      // Real-time score, lines, board preview relay to opponent
      const room = rooms.get(client.roomId);
      if (!room) return;
      const isHost = (client.id === room.hostId);
      const opponentWs = isHost ? room.guestWs : room.hostWs;

      if (opponentWs && opponentWs.readyState === WebSocket.OPEN) {
        opponentWs.send(JSON.stringify({
          type: 'OPPONENT_UPDATE',
          score: data.score || 0,
          lines: data.lines || 0,
          combo: data.combo || 0,
          boardSummary: data.boardSummary || null // e.g. column heights or mini grid
        }));
      }
      break;
    }

    case 'SEND_GARBAGE': {
      // Forward attack lines to opponent
      const room = rooms.get(client.roomId);
      if (!room) return;
      const isHost = (client.id === room.hostId);
      const opponentWs = isHost ? room.guestWs : room.hostWs;

      if (opponentWs && opponentWs.readyState === WebSocket.OPEN) {
        opponentWs.send(JSON.stringify({
          type: 'RECEIVE_GARBAGE',
          lines: Math.min(12, Math.max(1, data.lines || 1)),
          fromPlayer: client.name
        }));
      }
      break;
    }

    case 'PLAYER_TOP_OUT': {
      const room = rooms.get(client.roomId);
      if (!room || room.status !== 'PLAYING') return;

      const isHost = (client.id === room.hostId);
      // Opponent gets the win for this round
      if (isHost) {
        room.p2Wins++;
      } else {
        room.p1Wins++;
      }

      const isMatchOver = (room.p1Wins >= room.targetWins || room.p2Wins >= room.targetWins);
      const winnerName = (room.p1Wins > room.p2Wins) ? room.hostName : room.guestName;
      const winnerId = (room.p1Wins > room.p2Wins) ? room.hostId : room.guestId;

      if (isMatchOver) {
        room.status = 'MATCH_OVER';
      } else {
        room.status = 'ROUND_OVER';
      }

      const roundResultMsg = JSON.stringify({
        type: isMatchOver ? 'MATCH_OVER' : 'ROUND_OVER',
        winnerName: winnerName,
        winnerId: winnerId,
        p1Wins: room.p1Wins,
        p2Wins: room.p2Wins,
        targetWins: room.targetWins,
        isMatchOver: isMatchOver
      });

      if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) room.hostWs.send(roundResultMsg);
      if (room.guestWs && room.guestWs.readyState === WebSocket.OPEN) room.guestWs.send(roundResultMsg);
      broadcastRoomList();
      break;
    }

    case 'LEAVE_ROOM': {
      handleClientLeaveRoom(ws);
      break;
    }
  }
}

function handleClientLeaveRoom(ws) {
  const client = clients.get(ws);
  if (!client || !client.roomId) return;

  const room = rooms.get(client.roomId);
  client.roomId = null;

  if (room) {
    const isHost = (client.id === room.hostId);
    if (isHost) {
      // Host left -> close room and inform guest
      if (room.guestWs && room.guestWs.readyState === WebSocket.OPEN) {
        room.guestWs.send(JSON.stringify({
          type: 'ROOM_CLOSED',
          message: 'เจ้าของห้องออกจากห้องแล้ว'
        }));
        const guestClient = clients.get(room.guestWs);
        if (guestClient) guestClient.roomId = null;
      }
      rooms.delete(room.id);
    } else {
      // Guest left -> reset guest slot and inform host
      room.guestId = null;
      room.guestName = null;
      room.guestWs = null;
      room.status = 'WAITING';
      if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
        room.hostWs.send(JSON.stringify({
          type: 'GUEST_LEFT',
          message: 'ผู้เล่นออกจากห้องแล้ว'
        }));
      }
    }
    broadcastRoomList();
  }
}

function handleClientDisconnect(ws) {
  handleClientLeaveRoom(ws);
  clients.delete(ws);
  broadcastRoomList();
}

// Heartbeat interval to keep connections active across cloud proxies (like Render)
setInterval(() => {
  for (const [ws] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'PING' }));
    }
  }
}, 25000);

// ==========================================
// Start Server
// ==========================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🎮 Quadrate Game Real-Time Multiplayer Server`);
  console.log(`🚀 Running on port ${PORT}`);
  console.log(`🌐 Ready for Render.com deployment (HTTP + WebSockets)`);
  console.log(`====================================================`);
});
