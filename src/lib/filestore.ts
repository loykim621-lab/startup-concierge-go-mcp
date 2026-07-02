/**
 * 파일 저장소 — 모듈 스코프 싱글턴(인메모리, TTL 30분, 최대 20개).
 *
 * 무상태 MCP 핸들러(요청마다 server+transport 새로 생성, src/index.ts 참고)와 분리된
 * 이 모듈 자체의 상태로 파일을 보관한다. index.ts의 Express(HTTP transport)가 같은
 * 모듈을 import해서 다운로드 라우트를 노출하는 용도로 쓴다(예: GET /files/:token).
 *
 * 설계:
 * - putFile: crypto.randomBytes로 예측 불가능한 토큰 발급. TTL 30분.
 * - 최대 보관 개수 20개 초과 시 가장 오래된 항목(생성시각 기준)부터 제거.
 * - 만료 청소는 접근(put/get) 시점에 lazy로 수행(별도 타이머 없음 — 결정적·부작용 최소화).
 * - stdio 모드에서는 다운로드 URL을 만들 수 없으므로 buildDownloadUrl은 null을 반환하고,
 *   호출부(tool 핸들러)가 텍스트 폴백 안내만 하도록 한다.
 */
import { randomBytes } from "node:crypto";

export const FILE_TTL_MS = 30 * 60 * 1000; // 30분
export const MAX_FILES = 20;

interface StoredFile {
  name: string;
  data: Buffer;
  mime: string;
  createdAt: number;
  expiresAt: number;
}

export interface PutFileResult {
  token: string;
  expiresAt: number;
}

export interface GetFileResult {
  name: string;
  data: Buffer;
  mime: string;
}

// ── 모듈 스코프 싱글턴 상태 ──
const files = new Map<string, StoredFile>();
let publicBase: string | null = null;
let httpEnabled = false;

/** 만료된 항목을 제거한다(접근 시점 lazy 청소). */
function evictExpired(now: number): void {
  for (const [token, f] of files) {
    if (f.expiresAt <= now) {
      files.delete(token);
    }
  }
}

/** 최대 개수(MAX_FILES) 초과 시 가장 오래된 항목부터 제거한다. */
function evictOldestIfOverCapacity(): void {
  while (files.size > MAX_FILES) {
    let oldestToken: string | null = null;
    let oldestAt = Infinity;
    for (const [token, f] of files) {
      if (f.createdAt < oldestAt) {
        oldestAt = f.createdAt;
        oldestToken = token;
      }
    }
    if (oldestToken === null) break;
    files.delete(oldestToken);
  }
}

/**
 * 파일을 저장하고 예측 불가능한 다운로드 토큰을 발급한다.
 * TTL 30분, 최대 20개(초과 시 가장 오래된 것부터 제거).
 */
export function putFile(name: string, data: Buffer, mime: string): PutFileResult {
  const now = Date.now();
  evictExpired(now);

  const token = randomBytes(16).toString("hex");
  const expiresAt = now + FILE_TTL_MS;
  files.set(token, { name, data, mime, createdAt: now, expiresAt });

  evictOldestIfOverCapacity();

  return { token, expiresAt };
}

/** 토큰으로 파일을 조회한다. 없거나 만료되었으면 null. */
export function getFile(token: string): GetFileResult | null {
  const now = Date.now();
  evictExpired(now);

  const f = files.get(token);
  if (!f) return null;
  if (f.expiresAt <= now) {
    files.delete(token);
    return null;
  }
  return { name: f.name, data: f.data, mime: f.mime };
}

/** 다운로드 URL 조립용 공개 호스트를 기록한다(마지막으로 관측된 값). */
export function setPublicBase(base: string): void {
  publicBase = base.replace(/\/+$/, "");
}

/** 현재 기록된 공개 호스트(없으면 null). */
export function getPublicBase(): string | null {
  return publicBase;
}

/** HTTP transport 활성화 여부 표시(stdio 모드와 구분). */
export function setHttpEnabled(enabled: boolean): void {
  httpEnabled = enabled;
}

/** HTTP transport 활성화 여부 조회. */
export function isHttpEnabled(): boolean {
  return httpEnabled;
}

/**
 * 다운로드 절대 URL을 조립한다.
 * httpEnabled && publicBase가 설정된 경우에만 절대 URL을 반환하고,
 * 그렇지 않으면(stdio 모드 등) null — 호출부는 텍스트 폴백 안내만 제공해야 한다.
 */
export function buildDownloadUrl(token: string): string | null {
  if (!httpEnabled || !publicBase) return null;
  return `${publicBase}/files/${token}`;
}

/** 테스트 전용: 저장소 상태를 초기화한다. */
export function __resetForTest(): void {
  files.clear();
  publicBase = null;
  httpEnabled = false;
}
