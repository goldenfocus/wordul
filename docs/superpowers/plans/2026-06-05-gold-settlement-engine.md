# Gold Settlement Engine (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ◆ wallet honest — races stop ticking fake point-scale gold into the wallet; every race ends in a server-confirmed settlement receipt rendered by the Supernova settlement screen.

**Architecture:** A pure `settle()` contract in `src/economy.ts` (shared server/tests). The Room DO builds a `SettlementReceipt` per human player at race finish, mints it to the USER ledger **with parts**, attaches the receipt to the player only after the ledger write confirms (the daily's honesty rule), and re-broadcasts. The client migrates races onto the existing daily round-score adapter (wallet frozen mid-game) and renders the receipt via a new `public/settle.js` renderer registry (default renderer: Supernova, ported from `https://wordul.com/designs/settlement-supernova`).

**Tech Stack:** Cloudflare Workers Durable Objects (TS), vanilla ES-module client JS, vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-gold-settlement-engine-design.md`

**Worktree:** `.claude/worktrees/settlement-spec` (already created). All commands run from that directory.

---

### Task 1: `settle()` + `settleParts()` — the pure contract

**Files:**
- Modify: `src/economy.ts` (append after `goldFromPoints`, ~line 157)
- Test: `test/economy.test.ts` (append at end)

- [ ] **Step 1: Write the failing tests**

Append to `test/economy.test.ts` (extend the existing import from `../src/economy.ts` with `settle, settleParts`):

```ts
describe("settle", () => {
  it("mints points/100 at mult 1, no extras", () => {
    const r = settle({ buyIn: 0, points: 2150, mult: 1, spends: 0, bonus: 0 });
    expect(r.minted).toBe(22); // round(21.5) banker-free: Math.round
    expect(r.earned).toBe(22);
    expect(r.payout).toBe(22);
    expect(r.net).toBe(22);
  });
  it("multiplies the minted gold (the ×N moment)", () => {
    const r = settle({ buyIn: 50, points: 2850, mult: 3, spends: 0, bonus: 25 });
    expect(r.minted).toBe(29);
    expect(r.earned).toBe(87);
    expect(r.payout).toBe(162); // 50 + 87 + 25
    expect(r.net).toBe(112);
  });
  it("default mode clamps at the house floor — buy-in is max loss", () => {
    const r = settle({ buyIn: 50, points: 720, mult: 1, spends: 70, bonus: 0 });
    expect(r.payout).toBe(0);   // raw 50+7−70 = −13 → 0
    expect(r.net).toBe(-50);
  });
  it("signed mode lets the table reach into your pocket", () => {
    const r = settle({ buyIn: 50, points: 720, mult: 1, spends: 70, bonus: 0, signed: true });
    expect(r.payout).toBe(-13);
    expect(r.net).toBe(-63);
  });
  it("never mints from negative points", () => {
    const r = settle({ buyIn: 0, points: -400, mult: 1, spends: 0, bonus: 0 });
    expect(r.minted).toBe(0);
    expect(r.payout).toBe(0);
  });
});

describe("settleParts", () => {
  it("Σparts === payout − buyIn, zero legs dropped, floor leg explains the clamp", () => {
    const r = settle({ buyIn: 50, points: 720, mult: 1, spends: 70, bonus: 0 });
    const parts = settleParts(r);
    expect(parts.reduce((s, p) => s + p.delta, 0)).toBe(r.payout - r.buyIn);
    expect(parts.map((p) => p.label)).toEqual(["score", "power-ups", "house floor"]);
  });
  it("plain phase-1 race: a single score leg", () => {
    const r = settle({ buyIn: 0, points: 2150, mult: 1, spends: 0, bonus: 0 });
    expect(settleParts(r)).toEqual([{ label: "score", delta: 22 }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/economy.test.ts`
Expected: FAIL — `settle is not a function` (import error).

- [ ] **Step 3: Implement in `src/economy.ts`**

Append after `goldFromPoints`:

```ts
// --- Settlement (Phase 1 spec: docs/superpowers/specs/2026-06-05-gold-settlement-engine-design.md)
// The Law: wallet moves only at game edges. This is the edge.
//   minted = round(points/100) · earned = round(minted × mult)
//   payout = buyIn + earned − spends + bonus, clamped ≥ 0 unless `signed` (hard-mode preset).
export type SettlementInput = {
  buyIn: number; points: number; mult: number; spends: number; bonus: number;
  signed?: boolean;
};
export type SettlementReceipt = {
  buyIn: number; points: number; minted: number; mult: number; earned: number;
  spends: number; bonus: number; payout: number; net: number; signed: boolean;
};
export function settle(i: SettlementInput): SettlementReceipt {
  const minted = Math.max(0, Math.round(i.points / 100));
  const earned = Math.round(minted * i.mult);
  const raw = i.buyIn + earned - i.spends + i.bonus;
  const payout = i.signed ? raw : Math.max(0, raw);
  return {
    buyIn: i.buyIn, points: i.points, minted, mult: i.mult, earned,
    spends: i.spends, bonus: i.bonus, payout, net: payout - i.buyIn, signed: !!i.signed,
  };
}
// Ledger legs for the settle tx. Invariant: Σ parts.delta === payout − buyIn (the settle
// delta when buy-in is its own tx — and equals payout while buyIn is 0 in Phase 1).
export function settleParts(r: SettlementReceipt): LedgerPart[] {
  const parts: LedgerPart[] = [];
  if (r.earned) parts.push({ label: "score", delta: r.earned });
  if (r.spends) parts.push({ label: "power-ups", delta: -r.spends });
  if (r.bonus) parts.push({ label: "bonus", delta: r.bonus });
  const floor = r.payout - (r.buyIn + r.earned - r.spends + r.bonus);
  if (floor !== 0) parts.push({ label: "house floor", delta: floor });
  return parts;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/economy.test.ts`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/economy.ts test/economy.test.ts
git commit -m "feat(economy): settle()/settleParts — the pure settlement contract"
```

---

### Task 2: Server — race receipt, parts mint, confirmed re-broadcast

**Files:**
- Modify: `src/types.ts` (~line 60, beside `goldAwarded`)
- Modify: `src/room.ts` (finishGame waitUntil block, ~lines 1509–1530; snapshotFor player mapping, ~line 1911+)
- Test: Create `test/room-settle-receipt.test.ts` (model on `test/room-finish-broadcast.test.ts`)

- [ ] **Step 1: Add the type**

In `src/types.ts`, `PlayerState`, directly under `goldAwarded?: number;`:

```ts
  receipt?: SettlementReceipt; // race: settlement receipt, set ONLY after a confirmed (res.ok) mint
```

Add `import type { SettlementReceipt } from "./economy.ts";` at the top of `types.ts` (match existing import style; if `types.ts` currently has no imports, place it as line 1).

- [ ] **Step 2: Write the failing test**

Create `test/room-settle-receipt.test.ts`. Copy the `vi.mock("cloudflare:workers", ...)` stub and `makeHarness()` helper **verbatim** from `test/room-finish-broadcast.test.ts` (they exist precisely to be reused), then:

```ts
// Race settlement: when the USER-DO mint CONFIRMS (res.ok), the player gets a receipt and
// a follow-up snapshot broadcast carries it. When the mint hangs/fails, NO receipt — the
// client falls back to the plain refreshGold snap (never celebrate an unconfirmed mint).
it("attaches receipt + re-broadcasts after a confirmed race mint", async () => {
  const h = makeHarness({ userFetch: async () => new Response("{}", { status: 200 }) });
  await h.playRaceToWin("alice", 2150); // helper from harness; see room-finish-broadcast for the drive pattern
  await flushMicro();
  const last = h.lastBroadcastSnapshot();
  const alice = last.players.find((p: any) => p.username === "alice");
  expect(alice.receipt).toBeDefined();
  expect(alice.receipt.payout).toBe(alice.receipt.minted); // phase 1: mult 1, no extras
});

it("no receipt when the mint never confirms", async () => {
  const h = makeHarness({ userFetch: () => new Promise(() => {}) }); // hangs forever
  await h.playRaceToWin("alice", 2150);
  await flushMicro();
  const alice = h.lastBroadcastSnapshot().players.find((p: any) => p.username === "alice");
  expect(alice.receipt).toBeUndefined();
});
```

NOTE: `makeHarness` in `room-finish-broadcast.test.ts` may expose different helper names — adapt the *drive* (join + guess the winning word) to whatever that file actually does (read it fully first; it already drives `finishGame` with a hanging USER fetch). Keep the two assertions above intact.

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/room-settle-receipt.test.ts`
Expected: FAIL — `receipt` is `undefined` in the confirmed case.

- [ ] **Step 4: Implement in `src/room.ts`**

(a) Extend the economy import (line 13) with `settle, settleParts`.

(b) In the `finishGame` waitUntil block (~1509–1530), replace the gold-mint branch:

```ts
        const player = this.state.players.find((p) => p.username === username);
        const receipt = settle({
          buyIn: 0,                       // Phase 2 turns buy-ins on
          points: player ? player.points : 0,
          mult: 1,                        // Phase 1: no multiplier sources yet
          spends: 0,
          bonus: 0,
        });
        const stub = this.env.USER.get(this.env.USER.idFromName(username));
        const calls = [
          stub.fetch(`https://do/append?username=${encodeURIComponent(username)}`, { method: "POST", body: JSON.stringify(record) })
            .catch((e) => console.error("report failed", username, (e as Error).message)),
        ];
        if (receipt.payout > 0 && !player?.isBot) {
          calls.push(
            stub.fetch(`https://do/ledger/append?username=${encodeURIComponent(username)}`, {
              method: "POST",
              body: JSON.stringify({
                token: "gold", delta: receipt.payout, reason: "mint:cashout",
                ref: `${this.state.path}#${this.state.round}`, parts: settleParts(receipt),
              }),
            }).then((res) => {
              // HONEST RECEIPT: attach only on a confirmed write, then tell everyone.
              // (Same rule as the daily's goldAwarded — never celebrate an unconfirmed mint.)
              if (res.ok && player) {
                player.receipt = receipt;
                this.broadcastAll({ type: "snapshot", room: this.snapshotFor(null) });
              } else if (!res.ok) console.error("race mint non-ok", username, res.status);
            }).catch((e) => console.error("mint failed", username, (e as Error).message)),
          );
        }
        return calls;
```

CAREFUL: `snapshotFor(null)` broadcast — check how `broadcastAll` is used elsewhere for snapshots (~line 1955 sends per-viewer snapshots). If snapshots are per-viewer (`snapshotFor(this.userFor(ws))`), reuse that exact per-socket send loop instead of `broadcastAll` with a null viewer — copy the pattern at the existing "confirmed" daily broadcast (grep `scored` / the second daily broadcast in `scorePlayer`). Keep the mechanism identical to daily's confirmed broadcast.

(c) In `snapshotFor`'s player mapping (~1911+), copy the receipt beside whatever carries `goldAwarded` (grep `goldAwarded` inside `snapshotFor`; if it is not in the race snapshot mapping, add `receipt: p.receipt,` to the per-player object that includes `points`).

(d) Keep the receipt in localStorage-of-the-DO? NO — receipt is in-memory `PlayerState` only; rooms are per-round, persistence not needed.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run test/room-settle-receipt.test.ts test/room-finish-broadcast.test.ts && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/room.ts test/room-settle-receipt.test.ts
git commit -m "feat(room): race settlement receipt — parts mint + confirmed re-broadcast"
```

---

### Task 3: Client — races move onto the round-score adapter (the bug fix)

**Files:**
- Modify: `public/app.js` (sites listed per step; line numbers from current worktree)
- Modify: `public/locales/en.js` (one new key)

No new unit test (DOM module); the guard is behavioral: after this task, **nothing in a race calls `setGold`/`addGold`/`drainGold` (edition.js wallet) between game start and settlement.** Verify with the grep in Step 7.

- [ ] **Step 1: i18n key**

In `public/locales/en.js` beside `"daily.roundScorePrefix": "Round",` (line 54) add:

```js
  "race.scorePrefix": "Score",
```

- [ ] **Step 2: payoutOpts — both modes use the round score** (`app.js` ~1995)

Replace:

```js
        const payoutOpts = game.isDaily
          ? { wallet: roundScoreWallet, hud: $("#roundScore"), prefix: ROUND_SCORE_PREFIX() }
          : { hud: $("#goldHud") };
```

with:

```js
        // §A everywhere (settlement spec): in EVERY mode the payout/drain choreography
        // drives the EPHEMERAL #roundScore — the sacred ◆ wallet moves only at settlement.
        const payoutOpts = { wallet: roundScoreWallet, hud: $("#roundScore"), prefix: SCORE_PREFIX() };
```

Define `SCORE_PREFIX` next to `ROUND_SCORE_PREFIX` (~1811):

```js
const SCORE_PREFIX = () => (game.isDaily ? t("daily.roundScorePrefix") : t("race.scorePrefix")) + " ";
```

(Keep `ROUND_SCORE_PREFIX` if still referenced elsewhere — grep; update remaining call sites at ~2133 and the static render ~1820 to `SCORE_PREFIX`.)

- [ ] **Step 3: kill the race-only double-count bookkeeping**

The adapter now owns `game.goldThisRound` in all modes, so DELETE the two manual race-only mutations (and their now-wrong comments):
- ~1999: `if (penalty > 0 && !game.isDaily) game.goldThisRound = (game.goldThisRound || 0) - penalty;`
- the matching `if (!game.isDaily) game.goldThisRound = (game.goldThisRound || 0) + total;` inside the `discoveries > 0` branch (search `Race-only: bump the per-round tally`)

Also update `balanceBefore` (search `const balanceBefore = game.isDaily`) to drop the mode split:

```js
          const balanceBefore = game.goldThisRound || 0;
```

- [ ] **Step 4: invalid-guess drain + win bonus go to the score too**

(a) ~2128–2135 (invalid penalty): make the race branch use the same `{ wallet: roundScoreWallet, hud: $("#roundScore"), prefix: SCORE_PREFIX() }` opts and delete any `!game.isDaily` manual `goldThisRound` adjustment beside it (same double-count rule).

(b) Win path (~3679–3681): replace

```js
    const winGold = GOLD.solve + speedBonus + finalGreens * GOLD.hot;
    awardGold(winGold, getSettings().reducedMotion);
    game.goldThisRound = (game.goldThisRound || 0) + winGold;
```

with

```js
    const winGold = GOLD.solve + speedBonus + finalGreens * GOLD.hot;
    awardGold(winGold, getSettings().reducedMotion, { wallet: roundScoreWallet, hud: $("#roundScore"), prefix: SCORE_PREFIX() });
```

(the adapter mutates `goldThisRound` itself — no manual add).

- [ ] **Step 5: power-ups + bankruptcy read the stake in races** (`app.js` ~658)

`powerupsCtx` currently injects the real wallet (`getGold`, `drainGold` from edition.js). Make them mode-aware — daily KEEPS the real wallet (existing §A rule: WOTD power-ups cost real gold), races use the stake:

```js
const stakeGold = () => game.goldThisRound || 0;
const powerupsCtx = {
  game,
  send: (msg) => send(msg),
  render: () => render(),
  toast: (text, opts) => toast(text, opts),
  renderGoldHud,
  getSettings,
  // Settlement spec: races spend/check the STAKE (round score); the ◆ wallet never moves
  // mid-game. Daily keeps the real wallet (§A: WOTD power-ups cost real gold) until Phase 2.
  getGold: () => (game.isDaily ? getGold() : stakeGold()),
  drainGold: (n) => {
    if (game.isDaily) return drainGold(n);
    game.goldThisRound = stakeGold() - n;
    renderRoundScore?.();
    return game.goldThisRound;
  },
  getUsername,
  forfeit: (reason) => forfeit(reason),
};
```

CHECK: the static round-score render fn name near line 1816 (`function …` that paints `#roundScore`) — use its real name instead of `renderRoundScore?.()` if it differs.

- [ ] **Step 6: show #roundScore in races**

Find where `#roundScore` is unhidden for dailies (~2491, `const rs = $("#roundScore")`). Remove/adjust the daily-only gate so races unhide it too at round start, and confirm it resets per round (search `goldThisRound = 0` ~2602 — the reset already exists for both modes).

- [ ] **Step 7: verify the wallet freeze**

Run: `grep -n "awardGold\|goldDrain\|drainGold\|spendGold\|addGold(" public/app.js | grep -v roundScore | grep -v "wallet:"`
Expected: remaining hits are ONLY (a) daily power-up path via powerupsCtx, (b) the settlement/cash-out reconcile (`cashOutDaily`, and Task 5's race settlement), (c) imports/comments. Anything else ticking the real wallet mid-game is a missed site — fix it.

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add public/app.js public/locales/en.js
git commit -m "fix(race): wallet frozen mid-game — races run on the round-score stake adapter"
```

---

### Task 4: `public/settle.js` — renderer registry + Supernova

**Files:**
- Create: `public/settle.js`
- Test: Create `test/settle-lines.test.js`

- [ ] **Step 1: Write the failing test for the pure part**

Create `test/settle-lines.test.js`:

```js
import { describe, it, expect } from "vitest";
import { receiptLines } from "../public/settle.js";

const receipt = (over = {}) => ({
  buyIn: 0, points: 2150, minted: 22, mult: 1, earned: 22,
  spends: 0, bonus: 0, payout: 22, net: 22, signed: false, ...over,
});

describe("receiptLines", () => {
  it("phase-1 race: mint line + payout line only (zero legs dropped)", () => {
    const lines = receiptLines(receipt());
    expect(lines).toEqual([
      { key: "mint", text: "2,150 pts → ◆ 22", tone: "gain" },
      { key: "payout", text: "◆ 22 to your wallet · net +22", tone: "gain" },
    ]);
  });
  it("mult, spends, bonus and the house floor each get a line", () => {
    const lines = receiptLines(receipt({ buyIn: 50, mult: 3, earned: 66, spends: 90, bonus: 10, payout: 36, net: -14 }));
    expect(lines.map((l) => l.key)).toEqual(["mint", "mult", "spends", "bonus", "payout"]);
    expect(lines.find((l) => l.key === "mult").text).toContain("×3");
    expect(lines.find((l) => l.key === "payout").tone).toBe("loss");
  });
  it("bust reads as the house floor", () => {
    const lines = receiptLines(receipt({ buyIn: 50, spends: 90, payout: 0, net: -50 }));
    expect(lines.find((l) => l.key === "payout").text).toContain("◆ 0");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/settle-lines.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `public/settle.js`**

Three exports: `receiptLines` (pure, tested), `registerSettleRenderer`/`renderSettlement` (registry), plus the built-in `"supernova"` renderer. Structure:

```js
// Wordul — settlement screen module. A race ends in a RECEIPT (server-confirmed); this
// module turns it into the dopamine moment. Renderers are THEME PLUG-INS: a fixed receipt
// contract in, animation out — editions can pin their own (settleRenderer) the same way
// they pin tiles/sounds. Default: "supernova" (design ritual winner, 2026-06-05).
import { t } from "/i18n.js";   // CHECK actual i18n import path used by sibling modules (grep gold.js/app.js)

// Pure: receipt → display lines. Zero legs dropped; Σ visible numbers stays honest.
export function receiptLines(r) {
  const fmt = (n) => n.toLocaleString("en-US");
  const lines = [{ key: "mint", text: `${fmt(r.points)} pts → ◆ ${fmt(r.minted)}`, tone: "gain" }];
  if (r.mult > 1) lines.push({ key: "mult", text: `×${r.mult} → ◆ ${fmt(r.earned)}`, tone: "gain" });
  if (r.spends) lines.push({ key: "spends", text: `power-ups − ◆ ${fmt(r.spends)}`, tone: "loss" });
  if (r.bonus) lines.push({ key: "bonus", text: `bonus + ◆ ${fmt(r.bonus)}`, tone: "gain" });
  lines.push({
    key: "payout",
    text: `◆ ${fmt(r.payout)} to your wallet · net ${r.net >= 0 ? "+" : "−"}${fmt(Math.abs(r.net))}`,
    tone: r.net >= 0 ? "gain" : "loss",
  });
  return lines;
}

const renderers = new Map();
export function registerSettleRenderer(name, fn) { renderers.set(name, fn); }
// opts: { reducedMotion, walletBefore, onWalletTick(value), playChime } — app-owned hooks,
// same decoupling rule as gold.js (never import app.js).
export function renderSettlement(receipt, opts = {}) {
  const name = opts.renderer || "supernova";
  const fn = renderers.get(name) || renderers.get("supernova");
  return fn(receipt, opts); // → Promise resolving when the show (or static fallback) is done
}

registerSettleRenderer("supernova", supernova);
async function supernova(receipt, opts) {
  // PORT of /designs/settlement-supernova.html, adapted:
  //  - mounts a fullscreen overlay <div id="settleOverlay"> + <canvas>, removed on resolve
  //  - reducedMotion → NO canvas: render receiptLines() as static text + resolve fast
  //  - the final count-up drives opts.onWalletTick(value) so app.js owns the real HUD
  //  - sounds via opts.playChime (app-owned), not its own AudioContext
  //  - mult beat skipped when receipt.mult === 1 (Phase 1 default)
  //  - i18n: caption strings via t() keys added in Step 5
  // Keep the prototype's beats: mint coins → (mult split) → (spends fly off red) →
  // (bonus shooting stars) → payout figure + swarm to wallet + count-up. Bust: quiet collapse.
}
```

Port the canvas/animation code from `/tmp/settlement-supernova.html` (same machine, this session) — coin rendering (milled rim, radial gold, embossed ◆, glint sweep), orbit physics, ring bursts, captions. Strip the scenario chips/controls (real receipts replace them). Honor `prefers-reduced-motion` AND the existing settings `reducedMotion`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/settle-lines.test.js`
Expected: PASS (the pure part; the renderer is exercised in Task 5's manual verify).

- [ ] **Step 5: i18n for settlement copy**

Add to `public/locales/en.js`:

```js
  "settle.toWallet": "to your wallet",
  "settle.net": "net",
  "settle.bust": "buy-in was your max loss",
```

Use them inside `receiptLines`/supernova captions (adjust the test expectations of Step 1 to match the t()-resolved English strings — the test env resolves en.js; if `t()` needs DOM/locale bootstrapping in tests, keep `receiptLines` taking an optional `tFn = (k) => …` parameter defaulting to identity-English so the pure test stays hermetic).

- [ ] **Step 6: Commit**

```bash
git add public/settle.js test/settle-lines.test.js public/locales/en.js
git commit -m "feat(settle): settlement renderer registry + supernova default"
```

---

### Task 5: Wire the race finish to the settlement screen

**Files:**
- Modify: `public/app.js` (~2076–2085 `phaseEnded` block; import list line ~11)

- [ ] **Step 1: Import**

Add to the app.js imports: `import { renderSettlement } from "/settle.js";`

- [ ] **Step 2: Replace the blind snap with the receipt show**

At the `phaseEnded` site (~2076–2085) the code currently does `if (msg.room.phase === "finished") refreshGold();`. Replace with:

```js
    if (msg.room.phase === "finished") {
      // Settlement spec: the receipt (server-confirmed mint) drives the show. It may arrive
      // on a FOLLOW-UP snapshot (the confirmed re-broadcast), so run on whichever snapshot
      // first carries it — once. No receipt (mint failed / old server)? The plain
      // refreshGold reconcile below still keeps the wallet true.
      maybeRunSettlement(msg);
      refreshGold(); // safe either way: wallet was never inflated mid-game anymore
    }
```

And add (near `cashOutDaily`, ~2349, mirroring its ONLY-UP reconcile):

```js
let settlementShown = false; // reset wherever cashedOut/goldThisRound reset per round (~2602)
function maybeRunSettlement(msg) {
  if (settlementShown || game.isDaily) return;
  const me = (msg.room.players || []).find((p) => p.username === getUsername());
  if (!me || !me.receipt) return;
  settlementShown = true;
  const name = getUsername();
  if (!name) return;
  // ONLY-UP: fetch truth, pin HUD to (balance − payout), let the show count it up.
  fetch(`/api/user/${encodeURIComponent(name)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => {
      const balance = p && typeof p.gold === "number" ? p.gold : null;
      if (balance == null) { refreshGold(); return; }
      const pre = Math.max(0, balance - Math.max(0, me.receipt.payout));
      setGold(pre); renderGoldHud();
      return renderSettlement(me.receipt, {
        reducedMotion: getSettings().reducedMotion,
        walletBefore: pre,
        onWalletTick: (v) => { setGold(v); renderGoldHud(); },
        playChime,
      });
    })
    .catch(() => refreshGold());
}
```

Reset `settlementShown = false;` beside `game.goldThisRound = 0;` (~2602, per-round reset).

- [ ] **Step 3: Tests + typecheck + build gauntlet**

Run: `npm test && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 4: Manual verify on local dev**

Run: `npm run dev` then play a solo race vs a bot at `http://localhost:8787` (create a room, win it).
Expected, in order: score counter (not wallet) ticks during play with coin rain → on win, Supernova overlay: `pts → ◆` mint beat, coins, payout figure, swarm flies top-right, wallet counts up exactly `payout` → overlay closes, wallet matches `/api/user/<name>` balance. Loss: quiet receipt, wallet unchanged. Reduced motion (toggle in settings): static lines + instant snap, no canvas.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(race): settlement screen on finish — receipt show + ONLY-UP reconcile"
```

---

### Task 6: Ship + prod smoke

- [ ] **Step 1: Full gauntlet**

Run: `npm test && npm run typecheck && npx vitest run test/ios-input-zoom.test.ts`
Expected: all green (no new inputs were added; the ratchet must stay green).

- [ ] **Step 2: Ship**

```bash
bash dev/ship.sh
```

(tests → rebase on origin/main → backup tag → merge main → CI deploys). If the main push is rejected, re-run — another tab shipped first.

- [ ] **Step 3: Verify CI deployed the new bundle**

Run: `gh run list --workflow=deploy.yml --limit 1` → wait for success, then confirm the live bundle changed (e.g. `curl -s https://wordul.com/settle.js | head -3` returns the new module, not 404).

- [ ] **Step 4: Prod smoke (browser-verification hygiene!)**

Playwright against `wordul.com`: set name `verify-bot-settlement` (save+restore any prior `wr.username`), play one bot race to a win, confirm: score counter mid-game, Supernova on finish, wallet == `/api/user/verify-bot-settlement` balance after. **Close the browser, restore identity keys.**

- [ ] **Step 5: Post-Deploy Summary + COLONY log**

Post the standard summary (≤5 bullets, 3 test steps) and append the deploy to `.claude/COLONY.md`.

---

## Self-review notes (done at plan-writing time)

- **Spec coverage:** Law #1–6 → Tasks 1 (contract, parts invariant), 2 (two-tx/confirmed mint), 3 (wallet frozen mid-game, stake), 4–5 (renderer plug-in architecture, reduced-motion/error fallbacks). Daily unchanged (spec: later pass). Buy-ins/mult stay parameterized but off (Phase 2).
- **Known sharp edges flagged in steps:** per-viewer vs broadcastAll snapshot (Task 2 Step 4 CAREFUL note), `t()` hermeticity in tests (Task 4 Step 5), exact round-score render fn name (Task 3 Step 5 CHECK).
- **Types:** `SettlementReceipt` defined once in economy.ts; types.ts + room.ts + settle.js all consume that shape; `receiptLines` field names match it.
