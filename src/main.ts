/**
 * RektRadar SDK demo - everything here is the published npm package
 * `@mik3fly-lab/rektradar-sdk`, running client-side on the FREE tier (no API key).
 *
 *   - rr.stats()                -> platform-wide counters (real-time)
 *   - rr.token(addr)            -> real-time risk verdict (score + flags)
 *   - rr.rugs({ since })        -> recent rug pulls (delayed ~10 min on free)
 *   - rr.trends({ period })     -> scam pools / analyses bucketed over time
 *   - connectStream({ events }) -> live WebSocket feed of deploys / rugs
 *
 * No key is passed, so the client runs as anonymous-free: targeted lookups stay
 * real-time, the activity flow is delayed. Drop an `apiKey` into `new RektRadar`
 * / `connectStream` to go real-time.
 */
import "./style.css";
import { RektRadar, connectStream, type StreamEvent } from "@mik3fly-lab/rektradar-sdk";

// ── Live API quota badge ─────────────────────────────────────────────────────
// SDK calls go through the browser's fetch; wrap it once (before `rr` is built)
// so we can read the X-RateLimit-* headers the API exposes via CORS and show the
// real free-tier quota usage live - without spending an extra request. Bound to
// globalThis to avoid the "Illegal invocation" trap on an unbound fetch.
let quotaTimer: ReturnType<typeof setInterval> | undefined;
function renderQuota(limit: number, remaining: number, resetAtSec: number): void {
  const box = document.getElementById("quota");
  const fill = document.getElementById("quota-fill");
  const val = document.getElementById("quota-val");
  if (!box || !fill || !val) return;
  box.hidden = false;
  const used = Math.max(0, limit - remaining);
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  fill.style.width = `${pct}%`;
  fill.className = `quota-fill${remaining <= 0 ? " full" : remaining <= limit * 0.2 ? " low" : ""}`;
  const tick = (): void => {
    const secs = Math.max(0, resetAtSec - Math.floor(Date.now() / 1000));
    val.textContent = `${used}/${limit} used - resets in ${secs}s`;
    if (secs <= 0 && quotaTimer) { clearInterval(quotaTimer); quotaTimer = undefined; }
  };
  tick();
  if (quotaTimer) clearInterval(quotaTimer);
  quotaTimer = setInterval(tick, 1000);
}

// ── Free-tier 429 upsell ─────────────────────────────────────────────────────
// When the API rate-limits the anonymous free tier (HTTP 429), reveal the inline
// CTA: a free API key lifts the limit from 10/min to 40/min + 10k/mo (email only,
// no card). This is the demo's highest-intent moment - the visitor IS the
// anonymous hitter we want to convert into a known email.
function showRateLimitCta(): void {
  const box = document.getElementById("upsell");
  if (box) box.hidden = false;
}

const _fetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (...args: Parameters<typeof fetch>): Promise<Response> => {
  const res = await _fetch(...args);
  if (res.status === 429) showRateLimitCta();
  try {
    const limit = res.headers.get("X-RateLimit-Limit");
    const remaining = res.headers.get("X-RateLimit-Remaining");
    const reset = res.headers.get("X-RateLimit-Reset");
    if (limit && remaining && reset) {
      renderQuota(Number(limit), Number(remaining), Number(reset));
    }
  } catch { /* best-effort: header read never breaks the call */ }
  return res;
}) as typeof fetch;

document.getElementById("upsell-x")?.addEventListener("click", () => {
  const box = document.getElementById("upsell");
  if (box) box.hidden = true;
});

const rr = new RektRadar(); // free / anonymous; uses the browser's fetch + WebSocket

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const short = (a: string): string => (a && a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a);
const fmtNum = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
    : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`
      : String(Math.round(n));

// Pull the event's REAL on-chain/analysis time out of its data (not arrival time),
// so the ~10 min free-tier delay is visible.
const TIME_FIELDS = ["analyzedAt", "analyzed_at", "detectedAt", "ruggedAt", "rugged_at", "scoredAt", "ts", "timestamp", "blockTime", "time"];
function eventMs(d: Record<string, unknown>): number | null {
  for (const k of TIME_FIELDS) {
    const v = d[k];
    if (typeof v === "string") {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) return t;
    }
    if (typeof v === "number" && Number.isFinite(v)) return v > 1e12 ? v : v * 1000; // sec -> ms
  }
  return null;
}
const ago = (ms: number): string => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 90 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

// ── 0. Platform stats (rr.stats) ─────────────────────────────────────────────

async function loadStats(): Promise<void> {
  const box = $("stats-grid");
  try {
    const s = await rr.stats();
    const cells: Array<[string, number]> = [
      ["tokens scanned", Number(s.tokensScanned) || 0],
      ["scams detected", Number(s.scamsDetected) || 0],
      ["pools monitored", Number(s.poolsMonitored) || 0],
      ["deployers mapped", Number(s.deployersMapped) || 0],
    ];
    box.innerHTML = cells
      .map(([label, v]) => `<div class="stat"><span class="stat-v">${esc(fmtNum(v))}</span><span class="stat-l">${esc(label)}</span></div>`)
      .join("");
  } catch (err) {
    box.innerHTML = `<div class="muted">could not load stats: ${esc((err as Error).message)}</div>`;
  }
}

// ── 1. Token checker (rr.token) ──────────────────────────────────────────────

function riskClass(score: number): string {
  if (score >= 70) return "danger";
  if (score >= 40) return "warn";
  return "ok";
}

async function checkToken(address: string): Promise<void> {
  const out = $("verdict");
  const btn = $<HTMLButtonElement>("check-btn");
  out.hidden = false;
  out.className = "verdict";
  out.innerHTML = `<div class="muted">scanning ${esc(short(address))}...</div>`;
  btn.disabled = true;
  try {
    const v = await rr.token(address.trim());
    const score = typeof v.score === "number" ? v.score : 0;
    const flags = Array.isArray(v.flags) ? v.flags : [];
    const name = (v.name as string) || (v.symbol as string) || "Unknown token";
    out.className = `verdict ${riskClass(score)}`;
    out.innerHTML = `
      <div class="v-head">
        <span class="v-score">${score}<small>/100</small></span>
        <div class="v-meta">
          <div class="v-name">${esc(name)}${v.symbol ? ` <span class="v-sym">$${esc(v.symbol)}</span>` : ""}</div>
          <a class="v-addr" href="https://app.rektradar.io/scam/${esc(v.symbol || "")}" target="_blank" rel="noopener">${esc(short(v.address || address))}</a>
        </div>
        <span class="v-verdict">${score >= 70 ? "HIGH RISK" : score >= 40 ? "CAUTION" : "LOOKS OK"}</span>
      </div>
      ${flags.length ? `<div class="flags">${flags.map((f) => `<span class="flag">${esc(f)}</span>`).join("")}</div>` : `<div class="muted">no risk flags raised</div>`}`;
  } catch (err) {
    out.className = "verdict err";
    out.innerHTML = `<div class="muted">could not scan: ${esc((err as Error).message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

$<HTMLFormElement>("check-form").addEventListener("submit", (e) => {
  e.preventDefault();
  void checkToken($<HTMLInputElement>("addr").value);
});
document.querySelectorAll<HTMLButtonElement>(".ex").forEach((b) =>
  b.addEventListener("click", () => {
    const a = b.dataset.addr || "";
    $<HTMLInputElement>("addr").value = a;
    void checkToken(a);
  }),
);

// ── Tiny chart helpers (no chart lib - matches the mono theme) ────────────────

type Bar = { label: string; value: number; sub?: string; href?: string; title?: string };

/** Horizontal labeled bars - for ranked lists (rugs by ETH). */
function renderHBars(box: HTMLElement, bars: Bar[], color: string): void {
  if (!bars.length) { box.innerHTML = `<div class="muted">no data in the window yet.</div>`; return; }
  const max = Math.max(...bars.map((b) => b.value), 1);
  box.innerHTML = bars
    .map((b) => {
      const pct = Math.max(2, Math.round((b.value / max) * 100));
      const inner =
        `<span class="hb-label">${esc(b.label)}</span>` +
        `<span class="hb-track"><span class="hb-fill" style="width:${pct}%;background:${color}"></span></span>` +
        `<span class="hb-val">${esc(b.sub ?? String(b.value))}</span>`;
      return b.href
        ? `<a class="hb" href="${esc(b.href)}" target="_blank" rel="noopener">${inner}</a>`
        : `<div class="hb">${inner}</div>`;
    })
    .join("");
}

/** Vertical columns - for time-series (per day / per hour). */
function renderColumns(box: HTMLElement, bars: Bar[], color: string): void {
  if (!bars.length) { box.innerHTML = `<div class="muted">no data in the window yet.</div>`; return; }
  const max = Math.max(...bars.map((b) => b.value), 1);
  box.innerHTML = `<div class="cols">${bars
    .map((b) => {
      const pct = Math.max(3, Math.round((b.value / max) * 100));
      return `<div class="col" title="${esc(b.title ?? `${b.label}: ${b.value}`)}">` +
        `<span class="col-v">${b.value}</span>` +
        `<span class="col-bar" style="height:${pct}%;background:${color}"></span>` +
        `<span class="col-x">${esc(b.label)}</span></div>`;
    })
    .join("")}</div>`;
}

const fmtDay = (d: string): string => (d.length >= 10 ? d.slice(5, 10) : d); // 2026-06-16 -> 06-16
const fmtHour = (d: string): string => { const m = /(\d{2}):\d{2}$/.exec(d); return m ? `${m[1]}h` : d; }; // ... 14:00 -> 14h

// ── 2. Biggest rugs by ETH drained (rr.rugs) ─────────────────────────────────

async function loadTopRugs(): Promise<void> {
  const box = $("rugs-chart");
  try {
    const res = await rr.rugs({ since: "30d" });
    const delay = res.dataDelaySeconds ?? 0;
    $("rugs-delay").textContent = delay > 0 ? `delayed ${Math.round(delay / 60)}m (free)` : "real-time";
    const rugs = (Array.isArray(res.rugs) ? res.rugs : [])
      .map((r) => ({
        sym: (r.symbol as string) || (r.name as string) || "",
        addr: (r.pool as string) || (r.token as string) || "",
        profit: Number(r.profit) || 0,
      }))
      .filter((r) => r.profit > 0)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 8);
    renderHBars(
      box,
      rugs.map((r) => ({
        label: r.sym ? `$${r.sym}` : short(r.addr),
        value: r.profit,
        sub: `${r.profit.toFixed(1)} ETH`,
        href: r.sym ? `https://app.rektradar.io/scam/${encodeURIComponent(r.sym)}` : undefined,
      })),
      "var(--red)",
    );
  } catch (err) {
    box.innerHTML = `<div class="muted">could not load rugs: ${esc((err as Error).message)}</div>`;
  }
}

// ── 3. New scams per day (rr.trends, daily) ──────────────────────────────────

async function loadDaily(): Promise<void> {
  const box = $("daily-chart");
  try {
    const res = await rr.trends({ period: "7d", granularity: "daily" });
    const bars = (res.trends || []).map((t) => ({
      label: fmtDay(String(t.date)),
      value: Number(t.tokensDetected) || 0,
      title: `${t.date}: ${Number(t.tokensDetected) || 0} new scam pools`,
    }));
    renderColumns(box, bars, "var(--orange)");
  } catch (err) {
    box.innerHTML = `<div class="muted">could not load trends: ${esc((err as Error).message)}</div>`;
  }
}

// ── 4. Live pulse, last 6h (rr.trends, hourly) ───────────────────────────────

async function loadHourly(): Promise<void> {
  const box = $("hourly-chart");
  try {
    const res = await rr.trends({ period: "6h", granularity: "hourly" });
    $("hourly-delay").textContent = res.dataDelaySeconds > 0 ? "free: live hour withheld" : "6h";
    const bars = (res.trends || []).map((t) => ({
      label: fmtHour(String(t.date)),
      value: Number(t.tokensDetected) || 0,
      title: `${t.date}: ${Number(t.tokensDetected) || 0} new scam pools`,
    }));
    renderColumns(box, bars, "var(--red)");
  } catch (err) {
    box.innerHTML = `<div class="muted">could not load pulse: ${esc((err as Error).message)}</div>`;
  }
}

// ── 5. Live feed (connectStream) ─────────────────────────────────────────────

const ICONS: Record<string, string> = {
  new_token: "+",
  token_scored: "#",
  score_update: "~",
  imminent_rug: "!",
  rug: "x",
  connected: "*",
};

function pushEvent(ev: StreamEvent): void {
  const feed = $("feed");
  const muted = feed.querySelector(".muted");
  if (muted) muted.remove();
  const d = (ev.data || {}) as Record<string, unknown>;
  const label =
    (d.symbol as string) ||
    (d.name as string) ||
    short((d.token as string) || (d.address as string) || "");
  const extra =
    ev.type === "imminent_rug"
      ? `<span class="ev-x">${esc((d.functionLabel as string) || (d.kind as string) || "privileged call")}</span>`
      : ev.type === "token_scored" && typeof d.score === "number"
        ? `<span class="ev-x">${d.score}/100</span>`
        : "";
  // Show the event's REAL time + how long ago - on free it lands ~10 min late.
  const ms = eventMs(d);
  const when = ms
    ? `${new Date(ms).toLocaleTimeString()} <span class="ev-age">(${ago(ms)})</span>`
    : new Date().toLocaleTimeString();
  const row = document.createElement("div");
  row.className = `ev ev-${esc(ev.type)}`;
  row.innerHTML = `<span class="ev-ico">${ICONS[ev.type] || "."}</span><span class="ev-type">${esc(ev.type)}</span><span class="ev-label">${esc(label)}</span>${extra}<span class="ev-t">${when}</span>`;
  feed.prepend(row);
  while (feed.children.length > 40) feed.lastChild?.remove();
}

function setWs(state: string, ok: boolean): void {
  $("ws-state").textContent = state;
  $("ws-dot").className = `dot ${ok ? "on" : "off"}`;
}

connectStream({
  events: ["new_token", "imminent_rug", "rug", "token_scored"],
  onOpen: () => setWs("live (free: ~10 min delayed)", true),
  onMessage: (ev) => {
    if (ev.type === "connected") return;
    pushEvent(ev);
  },
  onError: () => setWs("error - retrying", false),
  onClose: () => setWs("disconnected", false),
});

// ── boot ─────────────────────────────────────────────────────────────────────

void loadStats();
void checkToken($<HTMLInputElement>("addr").value);
void loadTopRugs();
void loadDaily();
void loadHourly();
