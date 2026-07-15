const toast = document.querySelector("#toast");
const staticStoreKey = "candy_game_static_store";
let staticMode = false;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2200);
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
  try {
    return JSON.parse(localStorage.getItem(staticStoreKey)) || { players: [], attempts: [] };
  } catch {
    return { players: [], attempts: [] };
  }
}

function staticRequest(path, options = {}) {
  if (path === "/api/admin/login") return { ok: true };
  if (path !== "/api/admin/leaderboard") throw new Error("当前静态演示模式不支持这个接口");
  const store = readStaticStore();
  const bestByPlayer = new Map();
  for (const attempt of store.attempts) {
    const current = bestByPlayer.get(attempt.playerId);
    if (!current || attempt.score > current.score) bestByPlayer.set(attempt.playerId, attempt);
  }
  const leaderboard = [...bestByPlayer.values()]
    .sort((a, b) => b.score - a.score || new Date(a.completedAt) - new Date(b.completedAt))
    .slice(0, 50)
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
  return { players: store.players.length, attempts: store.attempts.length, leaderboard, rawAttempts: store.attempts };
}

function renderLeaderboard(items) {
  const list = document.querySelector("#adminLeaderboard");
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
        <div class="meta">已玩 ${item.attemptsUsed} 次 · ${new Date(item.completedAt).toLocaleString("zh-CN")}</div>
      </div>
      <span class="score">${item.score}</span>
    `;
    list.appendChild(li);
  }
}

async function loadDashboard() {
  const result = await request("/api/admin/leaderboard");
  document.querySelector("#playerCount").textContent = result.players;
  document.querySelector("#attemptCount").textContent = result.attempts;
  renderLeaderboard(result.leaderboard);
  document.querySelector("#loginPanel").classList.add("hidden");
  document.querySelector("#dashboard").classList.remove("hidden");
  if (staticMode) showToast("当前是静态试玩模式，只显示本机成绩");
}

document.querySelector("#adminLogin").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await request("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: document.querySelector("#password").value })
    });
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#refreshButton").addEventListener("click", () => {
  loadDashboard().catch((error) => showToast(error.message));
});

loadDashboard().catch(() => {});
