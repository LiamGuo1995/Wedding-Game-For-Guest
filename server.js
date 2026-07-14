import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_PATH = path.join(__dirname, "data", "db.json");
const CONFIG_PATH = path.join(__dirname, "config.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const SECRET = process.env.APP_SECRET || "change-me-before-production";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_TTL_MS = 1000 * 60 * 5;

const defaultConfig = {
  couple: { groom: "新郎", bride: "新娘", date: "2026-10-01" },
  event: {
    title: "接喜糖挑战",
    subtitle: "30 秒接住喜糖、红包和囍字，最高分赢取新人准备的小礼物",
    location: "闽南婚礼喜宴",
    rewardText: "排行榜前三名可领取伴手礼"
  },
  game: { durationSeconds: 30, maxAttemptsPerPlayer: 3, leaderboardLimit: 50 },
  theme: { primary: "#b91827", gold: "#f3c766", background: "#fff7e8" }
};

function ensureDataFile() {
  if (!fs.existsSync(path.dirname(DATA_PATH))) fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({ players: [], attempts: [], sessions: [] }, null, 2));
  }
}

function loadDb() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
}

function saveDb(db) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2));
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return defaultConfig;
  return { ...defaultConfig, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function badRequest(res, message) {
  json(res, 400, { error: message });
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

function createSignedToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function readSignedToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (sign(body) !== sig) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 20000) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 24);
}

function getClientKey(req, body) {
  const cookies = parseCookies(req);
  const existing = cookies.guest_id;
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
  const fingerprint = String(body.deviceId || "");
  if (/^[a-f0-9-]{16,80}$/i.test(fingerprint)) {
    return crypto.createHash("md5").update(fingerprint).digest("hex");
  }
  return crypto.randomBytes(16).toString("hex");
}

function findOrCreatePlayer(db, { name, clientKey, wechatOpenId }) {
  const identity = wechatOpenId ? `wx:${wechatOpenId}` : `device:${clientKey}:name:${name}`;
  let player = db.players.find((item) => item.identity === identity);
  if (!player) {
    player = {
      id: crypto.randomUUID(),
      identity,
      name,
      clientKey,
      wechatOpenId: wechatOpenId || null,
      createdAt: new Date().toISOString()
    };
    db.players.push(player);
  } else if (player.name !== name) {
    player.name = name;
  }
  return player;
}

function completedAttempts(db, playerId) {
  return db.attempts.filter((attempt) => attempt.playerId === playerId && attempt.completedAt).length;
}

function publicLeaderboard(db, limit) {
  const bestByPlayer = new Map();
  for (const attempt of db.attempts.filter((item) => item.completedAt)) {
    const current = bestByPlayer.get(attempt.playerId);
    if (!current || attempt.score > current.score) bestByPlayer.set(attempt.playerId, attempt);
  }
  return [...bestByPlayer.values()]
    .sort((a, b) => b.score - a.score || new Date(a.completedAt) - new Date(b.completedAt))
    .slice(0, limit)
    .map((attempt, index) => {
      const player = db.players.find((item) => item.id === attempt.playerId);
      return {
        rank: index + 1,
        name: player?.name || "来宾",
        score: attempt.score,
        attemptsUsed: completedAttempts(db, attempt.playerId),
        completedAt: attempt.completedAt
      };
    });
}

function serveStatic(req, res) {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const routeFile = pathname === "/" ? "index.html" : pathname === "/admin" ? "admin.html" : pathname.slice(1);
  const resolved = path.resolve(PUBLIC_DIR, routeFile);
  if (!resolved.startsWith(PUBLIC_DIR) || !fs.existsSync(resolved)) return false;
  const ext = path.extname(resolved);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(resolved).pipe(res);
  return true;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const config = loadConfig();

  if (req.method === "GET" && url.pathname === "/api/config") {
    return json(res, 200, config);
  }

  if (req.method === "GET" && url.pathname === "/api/leaderboard") {
    const db = loadDb();
    return json(res, 200, { leaderboard: publicLeaderboard(db, config.game.leaderboardLimit) });
  }

  if (req.method === "POST" && url.pathname === "/api/player") {
    const body = await readBody(req);
    const name = normalizeName(body.name);
    if (name.length < 2) return badRequest(res, "请填写至少两个字的姓名或称呼");
    const db = loadDb();
    const clientKey = getClientKey(req, body);
    const player = findOrCreatePlayer(db, { name, clientKey, wechatOpenId: body.wechatOpenId });
    const used = completedAttempts(db, player.id);
    saveDb(db);
    return json(
      res,
      200,
      {
        playerId: player.id,
        name: player.name,
        attemptsUsed: used,
        attemptsLeft: Math.max(0, config.game.maxAttemptsPerPlayer - used)
      },
      { "set-cookie": `guest_id=${encodeURIComponent(clientKey)}; Path=/; Max-Age=31536000; SameSite=Lax` }
    );
  }

  if (req.method === "POST" && url.pathname === "/api/game/start") {
    const body = await readBody(req);
    const db = loadDb();
    const player = db.players.find((item) => item.id === body.playerId);
    if (!player) return badRequest(res, "玩家不存在，请重新填写姓名");
    const used = completedAttempts(db, player.id);
    if (used >= config.game.maxAttemptsPerPlayer) return json(res, 403, { error: "你今天的 3 次机会已经用完" });
    const session = {
      id: crypto.randomUUID(),
      playerId: player.id,
      startedAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS
    };
    db.sessions.push(session);
    saveDb(db);
    return json(res, 200, { token: createSignedToken(session), durationSeconds: config.game.durationSeconds });
  }

  if (req.method === "POST" && url.pathname === "/api/game/finish") {
    const body = await readBody(req);
    const session = readSignedToken(body.token);
    if (!session) return badRequest(res, "本局凭证无效");
    const db = loadDb();
    const stored = db.sessions.find((item) => item.id === session.id && item.playerId === session.playerId);
    if (!stored) return badRequest(res, "本局已经提交或过期");
    const elapsedSeconds = (Date.now() - stored.startedAt) / 1000;
    if (Date.now() > stored.expiresAt || elapsedSeconds < 10) return badRequest(res, "本局时间异常，请重新开始");
    const used = completedAttempts(db, stored.playerId);
    if (used >= config.game.maxAttemptsPerPlayer) return json(res, 403, { error: "你今天的 3 次机会已经用完" });
    const score = Math.max(0, Math.min(9999, Number.parseInt(body.score, 10) || 0));
    const attempt = {
      id: crypto.randomUUID(),
      playerId: stored.playerId,
      score,
      stats: body.stats || {},
      completedAt: new Date().toISOString()
    };
    db.attempts.push(attempt);
    db.sessions = db.sessions.filter((item) => item.id !== stored.id);
    saveDb(db);
    return json(res, 200, {
      score,
      attemptsUsed: used + 1,
      attemptsLeft: Math.max(0, config.game.maxAttemptsPerPlayer - used - 1),
      leaderboard: publicLeaderboard(db, config.game.leaderboardLimit)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await readBody(req);
    if (body.password !== ADMIN_PASSWORD) return json(res, 401, { error: "管理员密码错误" });
    const token = createSignedToken({ role: "admin", createdAt: Date.now() });
    return json(res, 200, { ok: true }, { "set-cookie": `admin_session=${encodeURIComponent(token)}; Path=/; Max-Age=28800; SameSite=Lax; HttpOnly` });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/leaderboard") {
    const admin = readSignedToken(parseCookies(req).admin_session);
    if (!admin || admin.role !== "admin") return json(res, 401, { error: "请先登录后台" });
    const db = loadDb();
    return json(res, 200, {
      players: db.players.length,
      attempts: db.attempts.filter((item) => item.completedAt).length,
      leaderboard: publicLeaderboard(db, config.game.leaderboardLimit),
      rawAttempts: db.attempts
        .filter((item) => item.completedAt)
        .map((attempt) => ({ ...attempt, player: db.players.find((player) => player.id === attempt.playerId) }))
    });
  }

  if (url.pathname === "/auth/wechat/start" || url.pathname === "/auth/wechat/callback") {
    return json(res, 501, {
      error: "微信 OAuth 需要服务号 appid/appsecret、已备案域名和回调地址。接口位置已预留，生产接入时在这里换取 openid。"
    });
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/") || req.url.startsWith("/auth/")) {
      const handled = await handleApi(req, res);
      if (handled === false) json(res, 404, { error: "Not found" });
      return;
    }
    if (!serveStatic(req, res)) json(res, 404, { error: "Not found" });
  } catch (error) {
    json(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Wedding candy game running at http://${HOST}:${PORT}`);
});
