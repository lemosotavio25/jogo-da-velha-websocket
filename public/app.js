const copyLinkButton = document.querySelector("#copy-link");
const resetGameButton = document.querySelector("#reset-game");
const connectionDot = document.querySelector("#connection-dot");
const connectionLabel = document.querySelector("#connection-label");
const shareLink = document.querySelector("#share-link");
const roleLabel = document.querySelector("#role-label");
const roleHint = document.querySelector("#role-hint");
const identityCard = document.querySelector("#identity-card");
const statusCard = document.querySelector("#status-card");
const statusIcon = document.querySelector("#status-icon");
const gameStatus = document.querySelector("#game-status");
const spectatorCount = document.querySelector("#spectator-count");
const playerXPill = document.querySelector("#player-x");
const playerOPill = document.querySelector("#player-o");
const cells = [...document.querySelectorAll("[data-cell]")];

let lastNotice = "";
let gameState = null;
let reconnectTimer = null;
let socket = null;

shareLink.textContent = window.location.href;
socket = connect();

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.addEventListener("open", () => {
    updateConnection(true);
    lastNotice = "";
    renderGame();
  });

  ws.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);

    if (payload.type === "game_state") {
      gameState = payload.game;
      lastNotice = payload.notice ?? "";
      renderGame();
      return;
    }

    if (payload.type === "error") {
      lastNotice = payload.message;
      renderGame();
    }
  });

  ws.addEventListener("close", () => {
    updateConnection(false);
    lastNotice = "Conexao perdida. Tentando reconectar...";
    renderGame();

    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      socket = connect();
    }, 1200);
  });

  return ws;
}

function send(payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    lastNotice = "A conexao ainda nao ficou pronta.";
    renderGame();
    return;
  }

  socket.send(JSON.stringify(payload));
}

function updateConnection(isOnline) {
  connectionDot.classList.toggle("online", isOnline);
  connectionLabel.textContent = isOnline ? "Conectado" : "Desconectado";
}

function getRoleLabel(role) {
  if (role === "X") {
    return "Voce e o X";
  }

  if (role === "O") {
    return "Voce e o O";
  }

  return "Voce e espectador";
}

function getRoleHint(game) {
  if (game.you.role === "X") {
    return "Seu simbolo e o X azul. Voce comeca a partida.";
  }

  if (game.you.role === "O") {
    return "Seu simbolo e o O laranja. Voce joga depois do X.";
  }

  if (game.status === "waiting") {
    return "Voce entrou como espectador por enquanto.";
  }

  return "Voce esta assistindo essa partida.";
}

function getPlayerPillText(symbol, game) {
  if (game.players[symbol] === "open") {
    return `${symbol}: livre`;
  }

  if (game.you.role === symbol) {
    return `${symbol}: voce`;
  }

  return `${symbol}: outra pessoa`;
}

function getStatusVisual(game) {
  if (lastNotice === "Conexao perdida. Tentando reconectar...") {
    return {
      icon: "!",
      tone: "status-offline",
    };
  }

  if (game.status === "waiting") {
    if (game.players.X === "open" || game.players.O === "open") {
      return {
        icon: "...",
        tone: "status-waiting",
      };
    }
  }

  if (game.winner === "draw") {
    return {
      icon: "=",
      tone: "status-draw",
    };
  }

  if (game.winner === "X" || game.winner === "O") {
    return {
      icon: game.winner,
      tone: game.winner === "X" ? "status-x" : "status-o",
    };
  }

  if (game.you.role === game.turn) {
    return {
      icon: game.turn,
      tone: game.turn === "X" ? "status-your-turn-x" : "status-your-turn-o",
    };
  }

  if (game.turn === "X" || game.turn === "O") {
    return {
      icon: game.turn,
      tone: game.turn === "X" ? "status-x" : "status-o",
    };
  }

  return {
    icon: "?",
    tone: "status-neutral",
  };
}

function buildStatusMessage(game) {
  if (lastNotice) {
    return lastNotice;
  }

  if (game.status === "waiting") {
    if (game.players.X === "open" && game.players.O === "open") {
      return "Esperando dois jogadores entrarem.";
    }

    if (game.players.X === "open") {
      return "Esperando alguem ocupar o X.";
    }

    if (game.players.O === "open") {
      return "Esperando alguem ocupar o O.";
    }
  }

  if (game.winner === "draw") {
    return "Deu velha. Clique em Nova rodada para jogar de novo.";
  }

  if (game.winner === "X" || game.winner === "O") {
    return `Jogador ${game.winner} venceu a partida.`;
  }

  if (game.you.role === game.turn) {
    return `Sua vez de jogar com ${game.turn}.`;
  }

  if (game.you.role === "spectator") {
    return `Partida em andamento. Vez de ${game.turn}.`;
  }

  return `Aguardando a jogada de ${game.turn}.`;
}

function canPlayCell(game, index) {
  return (
    game.status === "playing" &&
    !game.winner &&
    game.you.role === game.turn &&
    !game.board[index]
  );
}

function renderGame() {
  shareLink.textContent = window.location.href;

  if (!gameState) {
    roleLabel.textContent = "Aguardando";
    roleHint.textContent = "O primeiro cliente vira X, o segundo vira O.";
    identityCard.className = "identity-card";
    statusCard.className = "info-card status-card status-waiting";
    statusIcon.textContent = "...";
    gameStatus.textContent = lastNotice || "Conectando no jogo...";
    spectatorCount.textContent = "0";
    playerXPill.textContent = "X: livre";
    playerOPill.textContent = "O: livre";
    playerXPill.className = "pill";
    playerOPill.className = "pill";
    resetGameButton.disabled = true;

    for (const cell of cells) {
      cell.textContent = "";
      cell.disabled = true;
      cell.className = "cell";
    }

    return;
  }

  roleLabel.textContent = getRoleLabel(gameState.you.role);
  roleHint.textContent = getRoleHint(gameState);
  identityCard.className = "identity-card";
  const statusVisual = getStatusVisual(gameState);
  statusCard.className = `info-card status-card ${statusVisual.tone}`;
  statusIcon.textContent = statusVisual.icon;
  gameStatus.textContent = buildStatusMessage(gameState);
  spectatorCount.textContent = String(gameState.spectatorCount);
  resetGameButton.disabled = !["X", "O"].includes(gameState.you.role);

  playerXPill.textContent = getPlayerPillText("X", gameState);
  playerOPill.textContent = getPlayerPillText("O", gameState);
  playerXPill.className =
    gameState.players.X === "connected" ? "pill active-x" : "pill";
  playerOPill.className =
    gameState.players.O === "connected" ? "pill active-o" : "pill";

  if (gameState.you.role === "X") {
    identityCard.classList.add("identity-x");
    playerXPill.classList.add("is-self");
  }

  if (gameState.you.role === "O") {
    identityCard.classList.add("identity-o");
    playerOPill.classList.add("is-self");
  }

  if (gameState.you.role === "spectator") {
    identityCard.classList.add("identity-spectator");
  }

  for (const cell of cells) {
    const index = Number(cell.dataset.cell);
    const value = gameState.board[index];
    cell.textContent = value ?? "";
    cell.disabled = !canPlayCell(gameState, index);
    cell.className = "cell";

    if (value === "X") {
      cell.classList.add("mark-x");
    }

    if (value === "O") {
      cell.classList.add("mark-o");
    }

    if (gameState.winningLine.includes(index)) {
      cell.classList.add("winner");
    }
  }
}

copyLinkButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    lastNotice = "Link copiado.";
    renderGame();
  } catch {
    lastNotice = "Nao deu para copiar automaticamente.";
    renderGame();
  }
});

resetGameButton.addEventListener("click", () => {
  lastNotice = "";
  send({ type: "reset" });
});

for (const cell of cells) {
  cell.addEventListener("click", () => {
    if (!gameState) {
      return;
    }

    send({
      type: "move",
      index: Number(cell.dataset.cell),
    });
  });
}

renderGame();
