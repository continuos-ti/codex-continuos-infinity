import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { publishPrivateBrokerEvent } from "./private-incident-journal";
import type { BrokerToolResult } from "./turn-broker";

const KEY_ID = createHash("sha256").update("infinity-broker-vault-key-v1").digest("hex");
const MAX_RESULT_BYTES = 64 * 1024 * 1024;
const MAX_SEALED_BYTES = Math.ceil(MAX_RESULT_BYTES * 4 / 3) + 4096;
const OWNER_DIGEST = /^[0-9a-f]{64}$/;
const TRACE_ID = /^[0-9a-f]{12}$/;
const CALL_ID = /^call_[A-Za-z0-9_-]{32}$/;
const TOOL = /^[A-Za-z0-9_.:-]{1,256}$/;

interface SealedResult {
  version: 1;
  scheme: "aes-256-gcm";
  traceId: string;
  callId: string;
  tool: string;
  nativeOwnerDigest: string;
  nonce: string;
  tag: string;
  ciphertext: string;
}

function verifyIdentity(input: ResultIdentity): void {
  if (!TRACE_ID.test(input.traceId) || !CALL_ID.test(input.callId)
    || !TOOL.test(input.tool) || !OWNER_DIGEST.test(input.nativeOwnerDigest)) {
    throw new Error("Invalid broker result identity");
  }
}

export interface ResultIdentity {
  traceId: string;
  callId: string;
  tool: string;
  nativeOwnerDigest: string;
}

function resultPath(directory: string, input: ResultIdentity): string {
  const key = createHash("sha256").update(`v1:${input.callId}:sealed_result`).digest("hex");
  return join(directory, input.traceId, `${key}.json`);
}

/** Detect changes to the sealed evidence while an authenticated recovery read is in progress. */
export function captureBrokerResultFileEvidence(directory: string, identities: readonly ResultIdentity[]): {
  fingerprint: string;
  pendingPublication: boolean;
} {
  const fingerprint = createHash("sha256");
  const ordered = [...identities].sort((a, b) => a.traceId.localeCompare(b.traceId)
    || a.callId.localeCompare(b.callId));
  const traces = new Set<string>();
  let pendingPublication = false;
  for (const identity of ordered) {
    verifyIdentity(identity);
    traces.add(identity.traceId);
    const path = resultPath(directory, identity);
    fingerprint.update(JSON.stringify(identity)).update("\0");
    if (!existsSync(path)) {
      fingerprint.update("missing\0");
      continue;
    }
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_SEALED_BYTES) {
      throw new Error("Broker result vault record is invalid");
    }
    const raw = readFileSync(path);
    if (raw.byteLength !== stat.size) throw new Error("Broker result vault record changed during read");
    fingerprint.update(raw).update("\0");
  }
  for (const trace of [...traces].sort()) {
    const path = join(directory, trace);
    if (!existsSync(path)) continue;
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Broker result vault trace directory is invalid");
    }
    let pendingCount = 0;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.name.endsWith(".pending")) continue;
      if (!/^\.[0-9a-f]{64}\.[0-9a-f]{24}\.pending$/.test(entry.name)
        || !entry.isFile() || entry.isSymbolicLink() || ++pendingCount > 1_000) {
        throw new Error("Broker result vault pending publication is invalid");
      }
      pendingPublication = true;
    }
  }
  return { fingerprint: fingerprint.digest("hex"), pendingPublication };
}

function identityAAD(input: ResultIdentity): Buffer {
  return Buffer.from(JSON.stringify({ traceId: input.traceId, callId: input.callId,
    tool: input.tool, nativeOwnerDigest: input.nativeOwnerDigest }));
}

/** The key is wrapped using the current Windows user's DPAPI identity, never logged or published. */
function dpapi(operation: "Protect" | "Unprotect", bytes: Buffer): Buffer {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    "$value = [Convert]::FromBase64String([Console]::In.ReadToEnd())",
    `$out = [System.Security.Cryptography.ProtectedData]::${operation}($value, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    "[Console]::Out.Write([Convert]::ToBase64String($out))",
  ].join("\n");
  const output = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", input: bytes.toString("base64"), windowsHide: true,
    timeout: 15_000, maxBuffer: 16 * 1024,
  });
  if (output.error || output.status !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(output.stdout.trim())) {
    throw new Error("Broker result vault Windows user-key protection failed");
  }
  return Buffer.from(output.stdout.trim(), "base64");
}

function readRecord(path: string, maxBytes: number): unknown {
  if (!existsSync(path)) return undefined;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maxBytes) {
    throw new Error("Broker result vault record is invalid");
  }
  try { return JSON.parse(readFileSync(path, "utf8")) as unknown; }
  catch { throw new Error("Broker result vault record is unreadable"); }
}

function decodeCanonicalBase64(value: string, maxEncodedLength: number): Buffer {
  if (value.length > maxEncodedLength || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid broker result vault base64 payload");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error("Noncanonical broker result vault base64 payload");
  }
  return decoded;
}

/**
 * Encrypted evidence of a tool result. A valid native owner is required to seal and read it.
 * Reading is an evidence API and does not reinstate a Codex capability or authorize a tool replay.
 */
export class BrokerResultVault {
  private key?: Buffer;
  private readonly keyDirectory: string;

  constructor(private readonly directory: string) {
    this.keyDirectory = join(directory, "keys");
  }

  private getKey(createIfMissing: boolean): Buffer {
    if (this.key) return this.key;
    if (process.platform !== "win32") {
      const configured = process.env.CODEX_INFINITY_RESULT_VAULT_KEY;
      if (!configured || !/^[0-9a-f]{64}$/i.test(configured)) {
        throw new Error("Broker result vault requires a 32-byte configured key on this platform");
      }
      this.key = Buffer.from(configured, "hex");
      return this.key;
    }

    const path = join(this.keyDirectory, `${KEY_ID}.json`);
    if (!existsSync(path)) {
      if (!createIfMissing) throw new Error("Broker result vault key is unavailable");
      const generated = randomBytes(32);
      try {
        const protectedKey = dpapi("Protect", generated).toString("base64");
        publishPrivateBrokerEvent(this.keyDirectory, KEY_ID,
          { version: 1, scheme: "windows-dpapi-current-user", protectedKey });
      } finally { generated.fill(0); }
    }
    const entry = readRecord(path, 4096) as { version?: unknown; scheme?: unknown; protectedKey?: unknown };
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).sort().join(",") !== "protectedKey,scheme,version"
      || entry.version !== 1 || entry.scheme !== "windows-dpapi-current-user"
      || typeof entry.protectedKey !== "string") {
      throw new Error("Broker result vault key record is invalid");
    }
    const unwrapped = dpapi("Unprotect", decodeCanonicalBase64(entry.protectedKey, 4096));
    if (unwrapped.length !== 32) throw new Error("Broker result vault key length is invalid");
    this.key = unwrapped;
    return unwrapped;
  }

  /** Publish ciphertext before the journal's result_received boundary. */
  seal(input: ResultIdentity, result: BrokerToolResult): void {
    verifyIdentity(input);
    const encoded = JSON.stringify(result);
    if (typeof encoded !== "string" || Buffer.byteLength(encoded) > MAX_RESULT_BYTES) {
      throw new Error("Broker tool result exceeds the durable result limit");
    }
    const path = resultPath(this.directory, input);
    if (existsSync(path)) {
      const prior = this.read(input);
      if (JSON.stringify(prior) !== encoded) throw new Error("Conflicting durable broker tool result");
      return;
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.getKey(true), nonce);
    cipher.setAAD(identityAAD(input));
    const ciphertext = Buffer.concat([cipher.update(encoded, "utf8"), cipher.final()]);
    const entry: SealedResult = {
      version: 1, scheme: "aes-256-gcm", ...input,
      nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    const key = createHash("sha256").update(`v1:${input.callId}:sealed_result`).digest("hex");
    const saved = publishPrivateBrokerEvent(join(this.directory, input.traceId), key, entry);
    if (!saved.recorded && JSON.stringify(this.read(input)) !== encoded) {
      throw new Error("Conflicting durable broker tool result");
    }
  }

  /** Only callers with independently proven native thread/turn identity should supply this digest. */
  read(input: ResultIdentity): BrokerToolResult | undefined {
    verifyIdentity(input);
    const record = readRecord(resultPath(this.directory, input), MAX_SEALED_BYTES) as SealedResult | undefined;
    if (record === undefined) return undefined;
    if (!record || typeof record !== "object" || Array.isArray(record)
      || record.version !== 1 || record.scheme !== "aes-256-gcm"
      || Object.keys(record).sort().join(",") !== ["version", "scheme", "traceId", "callId",
        "tool", "nativeOwnerDigest", "nonce", "tag", "ciphertext"].sort().join(",")
      || record.traceId !== input.traceId || record.callId !== input.callId
      || record.tool !== input.tool || record.nativeOwnerDigest !== input.nativeOwnerDigest
      || typeof record.nonce !== "string" || typeof record.tag !== "string"
      || typeof record.ciphertext !== "string") {
      throw new Error("Broker result vault identity mismatch or invalid envelope");
    }
    // Missing/unwrappable key material is a distinct recovery failure. Never create a new
    // key while reading an existing result, and preserve the actionable key error.
    const key = this.getKey(false);
    try {
      const nonce = decodeCanonicalBase64(record.nonce, 16);
      const tag = decodeCanonicalBase64(record.tag, 24);
      if (nonce.length !== 12 || tag.length !== 16) throw new Error("Invalid nonce or tag");
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(identityAAD(input));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(decodeCanonicalBase64(record.ciphertext,
        Math.ceil(MAX_RESULT_BYTES * 4 / 3) + 4)), decipher.final()]);
      if (plaintext.length > MAX_RESULT_BYTES) throw new Error("Oversized decrypted result");
      const result = JSON.parse(plaintext.toString("utf8")) as BrokerToolResult;
      if (!result || typeof result !== "object" || Array.isArray(result)
        || !Array.isArray(result.content)) throw new Error("Invalid result content");
      return result;
    } catch {
      throw new Error("Broker result vault authentication or payload validation failed");
    }
  }
}

export function vaultDirectoryForJournal(journalDirectory: string): string {
  return join(dirname(journalDirectory), "broker-result-vault");
}
