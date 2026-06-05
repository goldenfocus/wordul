// Test-only stub for the `cloudflare:workers` virtual module, which only exists in
// the workerd runtime. vitest runs in the node environment, so importing a Durable
// Object class (which extends DurableObject) needs this minimal base. The real base
// constructor just assigns ctx/env — that's all our DO logic relies on under test.
export class DurableObject<Env = unknown> {
  ctx: DurableObjectState;
  env: Env;
  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
