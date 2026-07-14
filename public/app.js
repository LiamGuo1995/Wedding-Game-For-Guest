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
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}

function getDeviceId() {
  const key = "candy_game_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  if (roll > 0.78) type = "gold";
  if (roll > 0.9) type = "hazard";
  if (roll > 0.965) type = "double";
  const points = { candy: 10, gold: 25, double: 40, hazard: -25 }[type];
  return {
    id: Math.random().toString(36).slice(2),
    type,
    x: rand(24, width - 24),
    y: -30,
    radius: type === "double" ? 21 : 18,
    speed: rand(150, 230) + difficulty * 170,
    drift: rand(-32, 32),
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
    ctx.fillStyle = "#f7f7f7";
    ctx.strokeStyle = "#70423a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-12, -15);
    ctx.lineTo(12, -15);
    ctx.lineTo(7, 10);
    ctx.lineTo(-7, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#7c1e23";
    ctx.fillRect(-8, -11, 16, 7);
  } else if (item.type === "gold") {
    ctx.fillStyle = "#e02030";
    ctx.fillRect(-18, -13, 36, 26);
    ctx.fillStyle = "#f3c766";
    ctx.font = "18px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("囍", 0, 1);
  } else if (item.type === "double") {
    ctx.fillStyle = "#f3c766";
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#b91827";
    ctx.font = "18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("礼", 0, 1);
  } else {
    ctx.fillStyle = "#ff6580";
    ctx.beginPath();
    ctx.roundRect(-18, -12, 36, 24, 8);
    ctx.fill();
    ctx.fillStyle = "#fff1c9";
    ctx.fillRect(-4, -12, 8, 24);
  }
  ctx.restore();
}

function drawBasket() {
  const basket = state.basket;
  ctx.save();
  ctx.translate(basket.x, basket.y);
  ctx.fillStyle = "#8b2d1f";
  ctx.beginPath();
  ctx.roundRect(-basket.width / 2, -basket.height / 2, basket.width, basket.height, 12);
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
    state.spawnTimer = Math.max(250, 760 - difficulty * 430 + rand(-120, 120));
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
        const comboBonus = Math.floor(state.combo / 5) * 5;
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
    resizeCanvas();
  } catch (error) {
    showToast(error.message);
  }
}

init();
