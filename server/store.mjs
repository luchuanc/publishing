import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

// SQLite owns this lock at OS level. A crash releases it automatically, including
// Docker restarts where a stale PID file could collide with a reused PID.
export function acquireInstanceLock(dataDir) {
  const lock = new DatabaseSync(path.join(dataDir, "instance-lock.sqlite"));
  try {
    lock.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;");
    return lock;
  } catch {
    lock.close();
    throw new Error("该数据目录已有平台实例运行，不能重复启动");
  }
}

export function openStore(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, "publishing.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, repo TEXT NOT NULL, branch TEXT NOT NULL,
      installCommand TEXT NOT NULL, buildCommand TEXT NOT NULL, outputDir TEXT NOT NULL,
      port INTEGER NOT NULL UNIQUE, publicUrl TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL,
      currentReleaseId TEXT, previousReleaseId TEXT, archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS builds (
      id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), status TEXT NOT NULL,
      config TEXT NOT NULL, autoPublish INTEGER NOT NULL, createdAt TEXT NOT NULL,
      startedAt TEXT, finishedAt TEXT, commitHash TEXT, commitMessage TEXT,
      error TEXT, sizeBytes INTEGER, publishedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS builds_project ON builds(projectId, createdAt DESC);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, projectId TEXT NOT NULL REFERENCES projects(id),
      action TEXT NOT NULL, releaseId TEXT, fromReleaseId TEXT, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL);
  `);
  return db;
}

export function transaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
