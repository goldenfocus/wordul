// Usage: start `npx wrangler dev --port 8810 --local`, then `node test/two-token-economy.integration.mjs`
// Verifies the secured two-token economy: per-account gold, server-side points, spend gating.
const HOST = process.env.HOST || "localhost:8810";
const slug = "econ-" + Date.now();
const room = `alice/${slug}`;
const wsUrl = `ws://${HOST}/ws?room=${encodeURIComponent(room)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ck = (c, m) => { c ? (pass++, console.log("✓", m)) : (fail++, console.log("✗ FAIL:", m)); };

function client() {
  const ws = new WebSocket(wsUrl);
  const snaps = [], errs = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "snapshot") snaps.push(m.room);
    if (m.type === "error") errs.push(m.message);
  });
  return {
    ws, snaps, errs,
    open: () => new Promise((r) => ws.addEventListener("open", r, { once: true })),
    send: (m) => ws.send(JSON.stringify(m)),
    last: () => snaps[snaps.length - 1],
  };
}
const goldOf = async (name) => {
  const r = await fetch(`http://${HOST}/api/user/${name}`);
  return (await r.json()).gold;
};

const A = client();
await A.open();
A.send({ type: "hello", username: "alice" });
await wait(400);
ck((await goldOf("alice")) === 0, `fresh account starts at 0 gold (got ${await goldOf("alice")})`);

A.send({ type: "start" });
await wait(400);
const me = () => A.last().players.find((p) => p.username === "alice");
ck(me() && me().points === 0, `points start at 0 (got ${me() && me().points})`);

// power-up rejected when broke (0 points < vowelCost)
const errsBefore = A.errs.length;
A.send({ type: "vowel_count" });
await wait(400);
ck(A.errs.length > errsBefore && /not enough points/.test(A.errs[A.errs.length - 1]),
   `power-up rejected when broke ("${A.errs[A.errs.length - 1]}")`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
