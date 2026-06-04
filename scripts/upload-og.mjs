#!/usr/bin/env node
// scripts/upload-og.mjs — upload dist/og/*.png to the wordul-og R2 bucket via the
// S3-compatible API. Needs R2 creds (account-scoped, from the vault):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ogDir = join(ROOT, "dist/og");
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (decrypt from the vault).");
  process.exit(1);
}
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const files = readdirSync(ogDir).filter((f) => f.endsWith(".png"));
const CONCURRENCY = 16;
let done = 0;
async function worker(queue) {
  while (queue.length) {
    const f = queue.pop();
    await s3.send(new PutObjectCommand({
      Bucket: "wordul-og", Key: f, Body: readFileSync(join(ogDir, f)), ContentType: "image/png",
    }));
    if (++done % 200 === 0) console.log(`${done}/${files.length}`);
  }
}
const q = [...files];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(q)));
console.log(`uploaded ${done} OG cards to wordul-og`);
