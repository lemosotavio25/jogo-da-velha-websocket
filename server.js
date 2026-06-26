const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const PUBLIC_DIR = path.join(__dirname, "public");
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const WINNING_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const game = createGame();

function createEmptyBoard() {
  return Array(9).fill(null);
}

function createGame() {
  return {
    board: createEmptyBoard(),
    turn: "X",
    players: { X: null, O: null },
    clients: new Set(),
    winner: null,
    winningLine: [],
  };
}

function resetGameState() {
  game.board = createEmptyBoard();
  game.turn = "X";
  game.winner = null;
  game.winningLine = [];
}

function evaluateBoard(board) {
  for (const [a, b, c] of WINNING_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return {
        winner: board[a],
        winningLine: [a, b, c],
      };
    }
  }

  if (board.every(Boolean)) {
    return {
      winner: "draw",
      winningLine: [],
    };
  }

  return {
    winner: null,
    winningLine: [],
  };
}

function getGameStatus() {
  if (!game.players.X || !game.players.O) {
    return "waiting";
  }

  if (game.winner) {
    return "finished";
  }

  return "playing";
}

function countSpectators() {
  let spectators = 0;

  for (const client of game.clients) {
    if (client.role === "spectator") {
      spectators += 1;
    }
  }

  return spectators;
}

function buildGameState(client) {
  return {
    board: game.board,
    turn: game.turn,
    status: getGameStatus(),
    winner: game.winner,
    winningLine: game.winningLine,
    players: {
      X: game.players.X ? "connected" : "open",
      O: game.players.O ? "connected" : "open",
    },
    spectatorCount: countSpectators(),
    you: {
      id: client.id,
      role: client.role,
    },
  };
}

function createFrame(opcode, payload = Buffer.alloc(0)) {
  const length = payload.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, length]), payload]);
  }

  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function send(client, payload) {
  if (client.closed || client.socket.destroyed) {
    return;
  }

  const message = Buffer.from(JSON.stringify(payload));
  client.socket.write(createFrame(0x1, message));
}

function sendError(client, message) {
  send(client, { type: "error", message });
}

function broadcast(notice) {
  for (const client of game.clients) {
    send(client, {
      type: "game_state",
      game: buildGameState(client),
      notice,
    });
  }
}

function attachClient(client) {
  game.clients.add(client);

  if (!game.players.X) {
    game.players.X = client.id;
    client.role = "X";
  } else if (!game.players.O) {
    game.players.O = client.id;
    client.role = "O";
  } else {
    client.role = "spectator";
  }

  broadcast();
}

function detachClient(client) {
  game.clients.delete(client);

  let playerLeft = false;

  if (game.players.X === client.id) {
    game.players.X = null;
    playerLeft = true;
  }

  if (game.players.O === client.id) {
    game.players.O = null;
    playerLeft = true;
  }

  if (playerLeft) {
    resetGameState();
  }

  if (game.clients.size === 0) {
    resetGameState();
    return;
  }

  broadcast(playerLeft ? "Um jogador saiu. A partida foi reiniciada." : undefined);
}

function handleMove(client, index) {
  if (!Number.isInteger(index) || index < 0 || index > 8) {
    sendError(client, "Movimento invalido.");
    return;
  }

  if (client.role !== "X" && client.role !== "O") {
    sendError(client, "Espectadores nao podem jogar.");
    return;
  }

  if (getGameStatus() !== "playing") {
    sendError(client, "Ainda estamos esperando dois jogadores.");
    return;
  }

  if (game.winner) {
    sendError(client, "A partida ja terminou. Reinicie para jogar de novo.");
    return;
  }

  if (game.players[game.turn] !== client.id) {
    sendError(client, "Ainda nao e a sua vez.");
    return;
  }

  if (game.board[index]) {
    sendError(client, "Essa casa ja foi usada.");
    return;
  }

  game.board[index] = client.role;

  const result = evaluateBoard(game.board);
  game.winner = result.winner;
  game.winningLine = result.winningLine;

  if (!game.winner) {
    game.turn = game.turn === "X" ? "O" : "X";
  }

  broadcast();
}

function handleReset(client) {
  if (client.role !== "X" && client.role !== "O") {
    sendError(client, "So jogadores podem reiniciar a partida.");
    return;
  }

  resetGameState();
  broadcast("Nova rodada iniciada.");
}

function closeClient(client, code = 1000, reason = "") {
  if (client.closed) {
    return;
  }

  client.closed = true;

  try {
    const reasonBuffer = Buffer.from(reason);
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    client.socket.end(createFrame(0x8, payload));
  } catch {
    client.socket.destroy();
  }
}

function handleDisconnect(client) {
  if (client.disconnected) {
    return;
  }

  client.disconnected = true;
  detachClient(client);
}

function handleClientMessage(client, rawMessage) {
  let message;

  try {
    message = JSON.parse(rawMessage);
  } catch {
    sendError(client, "Mensagem invalida.");
    return;
  }

  if (message.type === "move") {
    handleMove(client, Number(message.index));
    return;
  }

  if (message.type === "reset") {
    handleReset(client);
    return;
  }

  sendError(client, "Tipo de mensagem nao suportado.");
}

function handleSocketData(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);

  while (client.buffer.length >= 2) {
    const firstByte = client.buffer[0];
    const secondByte = client.buffer[1];
    const fin = (firstByte & 0x80) !== 0;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;

    let offset = 2;
    let payloadLength = secondByte & 0x7f;

    if (payloadLength === 126) {
      if (client.buffer.length < 4) {
        return;
      }

      payloadLength = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (client.buffer.length < 10) {
        return;
      }

      const length = client.buffer.readBigUInt64BE(2);

      if (length > BigInt(65536)) {
        closeClient(client, 1009, "Payload muito grande.");
        return;
      }

      payloadLength = Number(length);
      offset = 10;
    }

    if (!masked) {
      closeClient(client, 1002, "Cliente sem mascara.");
      return;
    }

    const frameLength = offset + 4 + payloadLength;
    if (client.buffer.length < frameLength) {
      return;
    }

    const mask = client.buffer.subarray(offset, offset + 4);
    const payload = Buffer.alloc(payloadLength);
    const payloadStart = offset + 4;

    for (let index = 0; index < payloadLength; index += 1) {
      payload[index] = client.buffer[payloadStart + index] ^ mask[index % 4];
    }

    client.buffer = client.buffer.subarray(frameLength);

    if (!fin) {
      closeClient(client, 1003, "Frames fragmentados nao suportados.");
      return;
    }

    if (opcode === 0x8) {
      closeClient(client);
      return;
    }

    if (opcode === 0x9) {
      client.socket.write(createFrame(0xA, payload));
      continue;
    }

    if (opcode === 0x1) {
      handleClientMessage(client, payload.toString("utf8"));
    }
  }
}

function serveStaticFile(req, res) {
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  const requestUrl = new URL(req.url, "http://localhost");
  const requestedPath =
    requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const safePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(safePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const extension = path.extname(safePath).toLowerCase();
    const contentType =
      MIME_TYPES[extension] ?? "application/octet-stream";

    fs.readFile(safePath, (readError, file) => {
      if (readError) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("Internal Server Error");
        return;
      }

      res.writeHead(200, { "content-type": contentType });
      res.end(file);
    });
  });
}

function getServerUrls(port) {
  const urls = new Set([`http://localhost:${port}`]);
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) {
      continue;
    }

    for (const address of addresses) {
      if (!address || address.internal || address.family !== "IPv4") {
        continue;
      }

      urls.add(`http://${address.address}:${port}`);
    }
  }

  return [...urls];
}

const server = http.createServer(serveStaticFile);

server.on("upgrade", (req, socket) => {
  const requestUrl = new URL(req.url, "http://localhost");

  if (requestUrl.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];

  if (!key || req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}${WS_GUID}`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  socket.setNoDelay(true);

  const client = {
    id: crypto.randomUUID(),
    socket,
    buffer: Buffer.alloc(0),
    role: "spectator",
    closed: false,
    disconnected: false,
  };

  socket.on("data", (chunk) => handleSocketData(client, chunk));
  socket.on("close", () => handleDisconnect(client));
  socket.on("end", () => handleDisconnect(client));
  socket.on("error", () => handleDisconnect(client));

  attachClient(client);
});

server.listen(PORT, () => {
  console.log("");
  console.log("Jogo da velha no ar:");

  for (const url of getServerUrls(PORT)) {
    console.log(`- ${url}`);
  }

  console.log("");
});
