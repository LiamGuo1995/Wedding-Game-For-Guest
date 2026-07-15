const screens = {
  entry: document.querySelector("#entry"),
  ready: document.querySelector("#ready"),
  game: document.querySelector("#game"),
  result: document.querySelector("#result"),
  leaderboard: document.querySelector("#leaderboard")
};

const state = {
  config: null,
  player: null,
  gameToken: null,
  running: false,
  score: 0,
  combo: 0,
  caught: 0,
  missed: 0,
  hazards: 0,
  items: [],
  basket: { x: 0, y: 0, width: 96, height: 34 },
  lastFrame: 0,
  elapsed: 0,
  spawnTimer: 0,
  pointerActive: false
};

const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");
const toast = document.querySelector("#toast");
const staticStoreKey = "candy_game_static_store";
let staticMode = false;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove("active"));
  screens[name].classList.add("active");
}

async function request(path, options = {}) {
  if (staticMode && path.startsWith("/api/")) return staticRequest(path, options);
  try {
    const response = await fetch(path, {
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : {};
    if (!response.ok) throw new Error(body.error || "请求失败");
    return body;
  } catch (error) {
    if (path.startsWith("/api/")) {
      staticMode = true;
      return staticRequest(path, options);
    }
    throw error;
  }
}

function readStaticStore() {
  const fallback = { players: [], attempts: [] };
  try {
    return JSON.parse(localStorage.getItem(staticStoreKey)) || fallback;
  } catch {
    return fallback;
  }
}

function writeStaticStore(store) {
  localStorage.setItem(staticStoreKey, JSON.stringify(store));
}

function parseBody(options) {
  try {
    return options.body ? JSON.parse(options.body) : {};
  } catch {
    return {};
  }
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function roundedRect(context, x, y, width, height, radius) {
  if (context.roundRect) {
    context.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
}

function staticLeaderboard(limit = 50) {
  const store = readStaticStore();
  const bestByPlayer = new Map();
  for (const attempt of store.attempts) {
    const current = bestByPlayer.get(attempt.playerId);
    if (!current || attempt.score > current.score) bestByPlayer.set(attempt.playerId, attempt);
  }
  return [...bestByPlayer.values()]
    .sort((a, b) => b.score - a.score || new Date(a.completedAt) - new Date(b.completedAt))
    .slice(0, limit)
    .map((attempt, index) => {
      const player = store.players.find((item) => item.id === attempt.playerId);
      return {
        rank: index + 1,
        name: player?.name || "来宾",
        score: attempt.score,
        attemptsUsed: store.attempts.filter((item) => item.playerId === attempt.playerId).length,
        completedAt: attempt.completedAt
      };
    });
}

async function loadStaticConfig() {
  const response = await fetch("./config.static.json");
  return response.json();
}

async function staticRequest(path, options = {}) {
  if (path === "/api/config") return loadStaticConfig();
  const body = parseBody(options);
  const config = state.config || (await loadStaticConfig());
  const store = readStaticStore();

  if (path === "/api/player") {
    const name = String(body.name || "").trim().slice(0, 24);
    if (name.length < 2) throw new Error("请填写至少两个字的姓名或称呼");
    const identity = `${body.deviceId || getDeviceId()}:${name}`;
    let player = store.players.find((item) => item.identity === identity);
    if (!player) {
      player = { id: makeId(), identity, name, createdAt: new Date().toISOString() };
      store.players.push(player);
      writeStaticStore(store);
    }
    const attemptsUsed = store.attempts.filter((item) => item.playerId === player.id).length;
    return {
      playerId: player.id,
      name,
      attemptsUsed,
      attemptsLeft: Math.max(0, config.game.maxAttemptsPerPlayer - attemptsUsed)
    };
  }

  if (path === "/api/game/start") {
    const player = store.players.find((item) => item.id === body.playerId);
    if (!player) throw new Error("玩家不存在，请重新填写姓名");
    const attemptsUsed = store.attempts.filter((item) => item.playerId === player.id).length;
    if (attemptsUsed >= config.game.maxAttemptsPerPlayer) throw new Error("你的 3 次机会已经用完");
    return { token: `static-${Date.now()}-${player.id}`, durationSeconds: config.game.durationSeconds };
  }

  if (path === "/api/game/finish") {
    const playerId = String(body.token || "").split("-").slice(2).join("-");
    const player = store.players.find((item) => item.id === playerId);
    if (!player) throw new Error("本局凭证无效");
    const attemptsUsed = store.attempts.filter((item) => item.playerId === player.id).length;
    if (attemptsUsed >= config.game.maxAttemptsPerPlayer) throw new Error("你的 3 次机会已经用完");
    const score = Math.max(0, Math.min(9999, Number.parseInt(body.score, 10) || 0));
    store.attempts.push({
      id: makeId(),
      playerId: player.id,
      score,
      stats: body.stats || {},
      completedAt: new Date().toISOString()
    });
    writeStaticStore(store);
    return {
      score,
      attemptsUsed: attemptsUsed + 1,
      attemptsLeft: Math.max(0, config.game.maxAttemptsPerPlayer - attemptsUsed - 1),
      leaderboard: staticLeaderboard(config.game.leaderboardLimit)
    };
  }

  if (path === "/api/leaderboard") {
    return { leaderboard: staticLeaderboard(config.game.leaderboardLimit) };
  }

  throw new Error("当前静态演示模式不支持这个接口");
}

function getDeviceId() {
  const key = "candy_game_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = makeId();
    localStorage.setItem(key, id);
  }
  return id;
}

function applyConfig(config) {
  state.config = config;
  document.title = config.event.title;
  document.documentElement.style.setProperty("--primary", config.theme.primary);
  document.documentElement.style.setProperty("--gold", config.theme.gold);
  document.documentElement.style.setProperty("--paper", config.theme.background);
  document.querySelector("#gameTitle").textContent = config.event.title;
  document.querySelector("#gameSubtitle").textContent = config.event.subtitle;
  document.querySelector("#groomName").textContent = config.couple.groom;
  document.querySelector("#brideName").textContent = config.couple.bride;
  document.querySelector("#weddingDate").textContent = `${config.couple.date} · ${config.event.location}`;
  document.querySelector("#rewardText").textContent = config.event.rewardText;
}

function updateAttemptText() {
  if (!state.player) return;
  document.querySelector("#playerGreeting").textContent = `${state.player.name}，准备好了吗`;
  document.querySelector("#attemptsText").textContent = `剩余 ${state.player.attemptsLeft} 次`;
}

function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  state.basket.y = rect.height - 72;
  if (!state.basket.x) state.basket.x = rect.width / 2;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function makeItem(width) {
  const elapsed = state.elapsed / 1000;
  const difficulty = Math.min(1, elapsed / state.config.game.durationSeconds);
  const roll = Math.random();
  let type = "candy";
  if (roll > 0.62) type = "redPacket";
  if (roll > 0.82) type = "hazard";
  if (roll > 0.93) type = "ingot";
  const points = { candy: 1, redPacket: 2, ingot: 5, hazard: -3 }[type];
  return {
    id: Math.random().toString(36).slice(2),
    type,
    x: rand(24, width - 24),
    y: -30,
    radius: type === "ingot" ? 20 : 18,
    speed: rand(230, 340) + difficulty * 320,
    drift: rand(-70, 70) * (0.45 + difficulty),
    points,
    spin: rand(0, Math.PI * 2)
  };
}

function drawBackground(width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#fff8e4");
  gradient.addColorStop(1, "#ffd9af");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(185, 24, 39, 0.08)";
  for (let i = 0; i < 7; i += 1) {
    const x = ((i * 83 + state.elapsed * 0.012) % (width + 80)) - 40;
    const y = 42 + i * 72;
    ctx.font = `${34 + (i % 3) * 10}px serif`;
    ctx.fillText("囍", x, y);
  }
}

function drawItem(item) {
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(item.spin);
  if (item.type === "hazard") {
    ctx.fillStyle = "rgba(210, 22, 36, 0.14)";
    ctx.strokeStyle = "#d21624";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 27, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-19, -19);
    ctx.lineTo(19, 19);
    ctx.stroke();
    ctx.fillStyle = "#f7f7f7";
    ctx.strokeStyle = "#3d2521";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-11, -13);
    ctx.lineTo(11, -13);
    ctx.lineTo(7, 9);
    ctx.lineTo(-7, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#7c1e23";
    ctx.fillRect(-7, -9, 14, 6);
    ctx.fillStyle = "#d21624";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("-3", 0, 23);
  } else if (item.type === "redPacket") {
    ctx.fillStyle = "#e02030";
    ctx.fillRect(-18, -13, 36, 26);
    ctx.fillStyle = "#f3c766";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("+2", 0, 1);
  } else if (item.type === "ingot") {
    ctx.fillStyle = "#f3c766";
    ctx.beginPath();
    ctx.ellipse(0, 3, 21, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd978";
    ctx.beginPath();
    ctx.ellipse(0, -3, 13, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#b91827";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("+5", 0, 2);
  } else {
    ctx.fillStyle = "#f3c766";
    ctx.beginPath();
    ctx.moveTo(-27, -4);
    ctx.lineTo(-17, -13);
    ctx.lineTo(-14, -6);
    ctx.lineTo(-14, 6);
    ctx.lineTo(-17, 13);
    ctx.lineTo(-27, 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(27, -4);
    ctx.lineTo(17, -13);
    ctx.lineTo(14, -6);
    ctx.lineTo(14, 6);
    ctx.lineTo(17, 13);
    ctx.lineTo(27, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#e93645";
    ctx.beginPath();
    roundedRect(ctx, -17, -14, 34, 28, 7);
    ctx.fill();
    ctx.strokeStyle = "#f3c766";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#fff1c9";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("喜", 0, -1);
    ctx.fillStyle = "#8b2d1f";
    ctx.font = "bold 10px sans-serif";
    ctx.fillText("+1", 0, 11);
  }
  ctx.restore();
}

function drawBasket() {
  const basket = state.basket;
  ctx.save();
  ctx.translate(basket.x, basket.y);
  ctx.fillStyle = "#8b2d1f";
  ctx.beginPath();
  roundedRect(ctx, -basket.width / 2, -basket.height / 2, basket.width, basket.height, 12);
  ctx.fill();
  ctx.strokeStyle = "#f3c766";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, -basket.height / 2 + 2, basket.width * 0.36, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = "#f3c766";
  ctx.font = "20px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("喜篮", 0, 2);
  ctx.restore();
}

function draw() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  drawBackground(width, height);
  state.items.forEach(drawItem);
  drawBasket();
}

function updateHud() {
  const duration = state.config.game.durationSeconds;
  document.querySelector("#scoreText").textContent = state.score;
  document.querySelector("#comboText").textContent = state.combo;
  document.querySelector("#timeText").textContent = Math.max(0, Math.ceil(duration - state.elapsed / 1000));
}

function collide(item) {
  const basket = state.basket;
  const left = basket.x - basket.width / 2;
  const right = basket.x + basket.width / 2;
  const top = basket.y - basket.height / 2;
  const bottom = basket.y + basket.height / 2;
  return item.x > left && item.x < right && item.y + item.radius > top && item.y - item.radius < bottom;
}

function update(timestamp) {
  if (!state.running) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const delta = Math.min(40, timestamp - state.lastFrame || 16);
  state.lastFrame = timestamp;
  state.elapsed += delta;
  state.spawnTimer -= delta;

  const duration = state.config.game.durationSeconds * 1000;
  const difficulty = Math.min(1, state.elapsed / duration);
  if (state.spawnTimer <= 0) {
    state.items.push(makeItem(width));
    if (difficulty > 0.42 && Math.random() < difficulty * 0.42) state.items.push(makeItem(width));
    state.spawnTimer = Math.max(150, 520 - difficulty * 310 + rand(-90, 80));
  }

  for (const item of state.items) {
    item.y += (item.speed * delta) / 1000;
    item.x += (item.drift * delta) / 1000;
    item.spin += delta * 0.004;
  }

  const remaining = [];
  for (const item of state.items) {
    if (collide(item)) {
      if (item.type === "hazard") {
        state.score = Math.max(0, state.score + item.points);
        state.combo = 0;
        state.hazards += 1;
      } else {
        state.combo += 1;
        state.caught += 1;
        const comboBonus = Math.floor(state.combo / 8);
        state.score += item.points + comboBonus;
      }
    } else if (item.y - item.radius > height) {
      if (item.type !== "hazard") {
        state.combo = 0;
        state.missed += 1;
      }
    } else {
      remaining.push(item);
    }
  }
  state.items = remaining;

  updateHud();
  draw();

  if (state.elapsed >= duration) {
    finishGame();
  } else {
    requestAnimationFrame(update);
  }
}

async function finishGame() {
  if (!state.running) return;
  state.running = false;
  try {
    const result = await request("/api/game/finish", {
      method: "POST",
      body: JSON.stringify({
        token: state.gameToken,
        score: state.score,
        stats: { caught: state.caught, missed: state.missed, hazards: state.hazards }
      })
    });
    state.player.attemptsUsed = result.attemptsUsed;
    state.player.attemptsLeft = result.attemptsLeft;
    document.querySelector("#finalScore").textContent = result.score;
    document.querySelector("#resultMeta").textContent =
      result.attemptsLeft > 0 ? `还有 ${result.attemptsLeft} 次机会` : "3 次机会已用完，已记录你的最高分";
    document.querySelector("#retryButton").style.display = result.attemptsLeft > 0 ? "block" : "none";
    showScreen("result");
  } catch (error) {
    showToast(error.message);
    showScreen("ready");
  }
}

async function startGame() {
  if (!state.player || state.player.attemptsLeft <= 0) {
    showToast("你的 3 次机会已经用完");
    return;
  }
  try {
    const result = await request("/api/game/start", {
      method: "POST",
      body: JSON.stringify({ playerId: state.player.playerId })
    });
    state.gameToken = result.token;
    state.running = true;
    state.score = 0;
    state.combo = 0;
    state.caught = 0;
    state.missed = 0;
    state.hazards = 0;
    state.items = [];
    state.elapsed = 0;
    state.spawnTimer = 200;
    showScreen("game");
    resizeCanvas();
    state.basket.x = canvas.clientWidth / 2;
    state.lastFrame = performance.now();
    requestAnimationFrame(update);
  } catch (error) {
    showToast(error.message);
  }
}

function renderLeaderboard(items) {
  const list = document.querySelector("#leaderboardList");
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = "<li><span></span><div>还没有成绩</div><strong class=\"score\">0</strong></li>";
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="rank">${item.rank}</span>
      <div>
        <strong>${item.name}</strong>
        <div class="meta">已玩 ${item.attemptsUsed} 次</div>
      </div>
      <span class="score">${item.score}</span>
    `;
    list.appendChild(li);
  }
}

async function showLeaderboard() {
  try {
    const result = await request("/api/leaderboard");
    renderLeaderboard(result.leaderboard);
    showScreen("leaderboard");
  } catch (error) {
    showToast(error.message);
  }
}

document.querySelector("#playerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.querySelector("#playerName").value.trim();
  try {
    state.player = await request("/api/player", {
      method: "POST",
      body: JSON.stringify({ name, deviceId: getDeviceId() })
    });
    updateAttemptText();
    showScreen("ready");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#startButton").addEventListener("click", startGame);
document.querySelector("#retryButton").addEventListener("click", () => {
  updateAttemptText();
  showScreen("ready");
});
document.querySelector("#showBoardButton").addEventListener("click", showLeaderboard);
document.querySelector("#resultBoardButton").addEventListener("click", showLeaderboard);
document.querySelector("#backButton").addEventListener("click", () => showScreen(state.player ? "ready" : "entry"));

function pointerToCanvasX(event) {
  const rect = canvas.getBoundingClientRect();
  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  return Math.max(state.basket.width / 2, Math.min(rect.width - state.basket.width / 2, clientX - rect.left));
}

canvas.addEventListener("pointerdown", (event) => {
  state.pointerActive = true;
  state.basket.x = pointerToCanvasX(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.pointerActive) return;
  event.preventDefault();
  state.basket.x = pointerToCanvasX(event);
});

canvas.addEventListener("pointerup", () => {
  state.pointerActive = false;
});

canvas.addEventListener("pointercancel", () => {
  state.pointerActive = false;
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", () => window.setTimeout(resizeCanvas, 250));

async function init() {
  try {
    applyConfig(await request("/api/config"));
    if (staticMode) showToast("当前是静态试玩模式，排行榜只保存在本机");
    resizeCanvas();
  } catch (error) {
    showToast(error.message);
  }
}

init();
