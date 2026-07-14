const toast = document.querySelector("#toast");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2200);
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
