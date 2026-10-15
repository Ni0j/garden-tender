import { Database } from "bun:sqlite";
import { S3Client } from "bun";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, copyFile, access, chmod } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { openDatabase } from "./db";
import { accounts, subscriptions } from "./schema";
import { eq } from "drizzle-orm";

export const deletionIntentShape = z.object({ userId: z.uuid(), customerId: z.string().nullable(), provider: z.string().nullable() });
export type DeletionIntent = z.infer<typeof deletionIntentShape>;
export async function digestFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function consistentBackup(sqlite: Database, destination: string) {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  // SQLite VACUUM INTO reads a consistent snapshot including committed WAL data.
  // SQLite refuses to overwrite a nonempty destination.
  sqlite.query("VACUUM INTO ?").run(destination);
  await chmod(destination, 0o600);
  verifyDatabase(destination);
  return { sha256: await digestFile(destination), createdAt: new Date().toISOString(), format: 1 };
}
export function verifyDatabase(path: string) {
  const db = new Database(path, { readonly: true });
  try {
    const check = db.query("PRAGMA integrity_check").all();
    if (JSON.stringify(check) !== '[{"integrity_check":"ok"}]' || db.query("PRAGMA foreign_key_check").all().length) throw new Error("Database integrity check failed.");
  } finally { db.close(); }
}
export async function restoreIsolated(source: string, destination: string, sha256: string, intents: DeletionIntent[]) {
  if (resolve(source) === resolve(destination)) throw new Error("Restore destination must be a new isolated path.");
  try { await access(destination); throw new Error("Restore destination already exists."); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  if (await digestFile(source) !== sha256) throw new Error("Backup checksum mismatch.");
  verifyDatabase(source);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination, 1); await chmod(destination, 0o600);
  const restored = openDatabase(destination);
  try {
    restored.db.transaction(tx => {
      // A restored backup must never confer stale Plus entitlement. Startup
      // reconciliation obtains current provider state before serving requests.
      tx.update(subscriptions).set({ paidThrough: 0 }).run();
      for (const input of intents) {
        const intent = deletionIntentShape.parse(input);
        const prior = tx.select().from(accounts).where(eq(accounts.userId, intent.userId)).get();
        if (prior?.deletionState === "complete") continue;
        tx.insert(accounts).values({ ...intent, createdAt: Date.now(), deletionState: "billing", deletionUpdatedAt: Date.now() }).onConflictDoUpdate({ target: accounts.userId, set: { customerId: intent.customerId, provider: intent.provider, deletionState: "billing", deletionUpdatedAt: Date.now() } }).run();
      }
    });
  } finally { restored.sqlite.close(); }
  verifyDatabase(destination);
}
export class BackupStore {
  readonly prefix: string;
  constructor(readonly s3: S3Client, prefix = "garden") { this.prefix = prefix.replace(/\/$/, ""); }
  async recordDeletion(intent: DeletionIntent) {
    const parsed = deletionIntentShape.parse(intent);
    await this.s3.write(`${this.prefix}/deletions/${parsed.userId}.json`, JSON.stringify(parsed), { type: "application/json" });
  }
  async deletionIntents() {
    const intents: DeletionIntent[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.s3.list({ prefix: `${this.prefix}/deletions/`, continuationToken });
      for (const object of page.contents ?? []) intents.push(deletionIntentShape.parse(await this.s3.file(object.key).json()));
      continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
    } while (continuationToken);
    return intents;
  }
  async backup(sqlite: Database) {
    const directory = await mkdtemp(join(tmpdir(), "garden-backup-"));
    try {
      const path = join(directory, "garden.db");
      const manifest = await consistentBackup(sqlite, path);
      const key = `${this.prefix}/snapshots/${Date.now()}-${crypto.randomUUID()}.db`;
      await this.s3.write(key, Bun.file(path));
      await this.s3.write(`${key}.json`, JSON.stringify(manifest), { type: "application/json" });
      await this.prune();
      // Only publish success after both snapshot and manifest are durable.
      return key;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  async prune(now = Date.now()) {
    for (const [folder, days] of [["snapshots", 30], ["deletions", 90]] as const) {
      let continuationToken: string | undefined;
      do {
        const page = await this.s3.list({ prefix: `${this.prefix}/${folder}/`, continuationToken });
        for (const item of page.contents ?? []) if (item.lastModified && new Date(item.lastModified).getTime() < now - days * 86_400_000) await this.s3.delete(item.key);
        continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
      } while (continuationToken);
    }
  }
  async downloadRestore(key: string, destination: string) {
    if (!key.startsWith(`${this.prefix}/snapshots/`) || !key.endsWith(".db")) throw new Error("Choose a snapshot key in this Garden backup prefix.");
    const directory = await mkdtemp(join(tmpdir(), "garden-restore-"));
    try {
      const source = join(directory, "garden.db");
      const manifest = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.iso.datetime() }).parse(await this.s3.file(`${key}.json`).json());
      if (new Date(manifest.createdAt).getTime() < Date.now() - 30 * 86_400_000) throw new Error("Snapshot exceeds the 30-day restore window; deletion protection cannot be guaranteed.");
      await Bun.write(source, this.s3.file(key));
      await restoreIsolated(source, destination, manifest.sha256, await this.deletionIntents());
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
export function createBackupStore() {
  if (!process.env.BACKUP_S3_BUCKET) return null;
  return new BackupStore(new S3Client({ bucket: process.env.BACKUP_S3_BUCKET, region: process.env.BACKUP_S3_REGION, endpoint: process.env.BACKUP_S3_ENDPOINT, accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY }), process.env.BACKUP_S3_PREFIX ?? "garden");
}
