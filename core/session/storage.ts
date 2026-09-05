/**
 * oh-my-pi Mobile: Local-Only Persistence Layer
 *
 * All state, messages, sessions, and credentials remain strictly on-device.
 * Zero telemetry, zero cloud synchronization.
 */

import type { CoreMessage, CoreSessionState, TodoPhase } from "../types";

export interface StoredSessionRecord {
  state: CoreSessionState;
  messages: CoreMessage[];
}

export interface IStorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  listKeys(prefix?: string): Promise<string[]>;
}

/** In-memory fallback / test storage */
export class MemoryStorageBackend implements IStorageBackend {
  private store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  async listKeys(prefix = ""): Promise<string[]> {
    return Array.from(this.store.keys()).filter((k) => k.startsWith(prefix));
  }
}

/** LocalStorage / Mobile WebView persistence */
export class LocalStorageBackend implements IStorageBackend {
  async getItem(key: string): Promise<string | null> {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(key);
    }
    return null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  }

  async removeItem(key: string): Promise<void> {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(key);
    }
  }

  async listKeys(prefix = ""): Promise<string[]> {
    if (typeof localStorage === "undefined") return [];
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        keys.push(k);
      }
    }
    return keys;
  }
}

export class LocalSessionStore {
  private backend: IStorageBackend;
  private prefix = "omp_session_";
  private activeKey = "omp_active_session_id";
  private keysKey = "omp_credential_vault";

  constructor(backend?: IStorageBackend) {
    if (backend) {
      this.backend = backend;
    } else if (typeof localStorage !== "undefined") {
      this.backend = new LocalStorageBackend();
    } else {
      this.backend = new MemoryStorageBackend();
    }
  }

  async saveSession(state: CoreSessionState, messages: CoreMessage[]): Promise<void> {
    const key = `${this.prefix}${state.sessionId}`;
    const payload: StoredSessionRecord = { state, messages };
    await this.backend.setItem(key, JSON.stringify(payload));
    await this.backend.setItem(this.activeKey, state.sessionId);
  }

  async loadSession(sessionId: string): Promise<StoredSessionRecord | null> {
    const key = `${this.prefix}${sessionId}`;
    const raw = await this.backend.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredSessionRecord;
    } catch {
      return null;
    }
  }

  async getActiveSessionId(): Promise<string | null> {
    return this.backend.getItem(this.activeKey);
  }

  async listSessions(): Promise<CoreSessionState[]> {
    const keys = await this.backend.listKeys(this.prefix);
    const sessions: CoreSessionState[] = [];
    for (const key of keys) {
      const raw = await this.backend.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as StoredSessionRecord;
          sessions.push(parsed.state);
        } catch {
          // ignore corrupted records
        }
      }
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const key = `${this.prefix}${sessionId}`;
    await this.backend.removeItem(key);
    const active = await this.getActiveSessionId();
    if (active === sessionId) {
      await this.backend.removeItem(this.activeKey);
    }
  }

  // --- Local Credential Storage (On-Device Only) ---

  async saveApiKey(provider: string, apiKey: string): Promise<void> {
    const existing = await this.getApiKeys();
    existing[provider] = apiKey;
    await this.backend.setItem(this.keysKey, JSON.stringify(existing));
  }

  async getApiKey(provider: string): Promise<string | null> {
    const keys = await this.getApiKeys();
    return keys[provider] ?? null;
  }

  async getApiKeys(): Promise<Record<string, string>> {
    const raw = await this.backend.getItem(this.keysKey);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async clearApiKeys(): Promise<void> {
    await this.backend.removeItem(this.keysKey);
  }
}
