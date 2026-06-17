/**
 * RektRadar SDK demo - everything here is the published npm package
 * `@mik3fly-lab/rektradar-sdk`, running client-side on the FREE tier (no API key).
 *
 *   - rr.token(addr)            -> real-time risk verdict (score + flags)
 *   - rr.rugs({ since })        -> recent rug pulls (delayed ~10 min on free)
 *   - connectStream({ events }) -> live WebSocket feed of deploys / rugs
 *
 * No key is passed, so the client runs as anonymous-free: targeted lookups stay
 * real-time, the activity flow is delayed. Drop an `apiKey` into `new RektRadar`
 * / `connectStream` to go real-time.
 */
import "./style.css";
import { RektRadar, connectStream, type StreamEvent } from "@mik3fly-lab/rektradar-sdk";

const rr = new RektRadar(); // free / anonymous; uses the browser's fetch + WebSocket

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const short = (a: string): string => (a && a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a);

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

// ── 2. Recent rugs (rr.rugs) ─────────────────────────────────────────────────

async function loadRugs(): Promise<void> {
  const box = $("rugs");
  try {
    const res = await rr.rugs({ since: "7d" });
    const delay = res.dataDelaySeconds ?? 0;
    $("rugs-delay").textContent = delay > 0 ? `delayed ${Math.round(delay / 60)}m (free)` : "real-time";
    const rugs = Array.isArray(res.rugs) ? res.rugs.slice(0, 8) : [];
    if (!rugs.length) {
      box.innerHTML = `<div class="muted">no rugs in the window (or still computing - try again shortly).</div>`;
      return;
    }
    box.innerHTML = rugs
      .map((r) => {
        const sym = (r.symbol as string) || (r.name as string) || "";
        const addr = (r.address as string) || (r.pool as string) || "";
        const eth = (r.ethProfit ?? r.profitEth ?? r.ethDrained) as number | undefined;
        return `<a class="rug" href="https://app.rektradar.io/scam/${esc(sym)}" target="_blank" rel="noopener">
          <span class="rug-sym">${sym ? "$" + esc(sym) : esc(short(addr))}</span>
          ${typeof eth === "number" ? `<span class="rug-eth">-${eth.toFixed(1)} ETH</span>` : ""}
        </a>`;
      })
      .join("");
  } catch (err) {
    box.innerHTML = `<div class="muted">could not load rugs: ${esc((err as Error).message)}</div>`;
  }
}

// ── 3. Live feed (connectStream) ─────────────────────────────────────────────

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
  const row = document.createElement("div");
  row.className = `ev ev-${esc(ev.type)}`;
  row.innerHTML = `<span class="ev-ico">${ICONS[ev.type] || "."}</span><span class="ev-type">${esc(ev.type)}</span><span class="ev-label">${esc(label)}</span>${extra}<span class="ev-t">${new Date().toLocaleTimeString()}</span>`;
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

void checkToken($<HTMLInputElement>("addr").value);
void loadRugs();
