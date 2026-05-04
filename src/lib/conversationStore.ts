import { db } from './db';
import { Conversation, Segment } from '../types';

export type StorageBackend = 'local' | 'hybrid' | 'neo4j_chroma';

export type PersistConversationInput = {
  conversation: Conversation;
  segments: Segment[];
};

export interface ConversationStore {
  backend: StorageBackend;
  saveConversationWithSegments(input: PersistConversationInput): Promise<void>;
}

class LocalDexieConversationStore implements ConversationStore {
  backend: StorageBackend = 'local';

  async saveConversationWithSegments(input: PersistConversationInput): Promise<void> {
    await db.transaction('rw', db.conversations, db.segments, async () => {
      await db.conversations.add(input.conversation);
      for (const seg of input.segments) {
        await db.segments.add(seg);
      }
    });
  }
}

type ReplicationLogEntry = {
  id: string;
  createdAt: number;
  backend: Exclude<StorageBackend, 'local'>;
  conversationId: string;
  segmentsCount: number;
  status: 'pending' | 'synced' | 'failed';
  attempts?: number;
  lastAttemptAt?: number;
  lastError?: string;
  payload: {
    conversation: Conversation;
    segments: Segment[];
  };
};

const REPLICATION_LOG_KEY = 'SOCRATE_REPLICATION_LOG';

function readReplicationLog(): ReplicationLogEntry[] {
  const raw = localStorage.getItem(REPLICATION_LOG_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeReplicationLog(entries: ReplicationLogEntry[]) {
  localStorage.setItem(REPLICATION_LOG_KEY, JSON.stringify(entries));
}

function appendReplicationEntry(entry: ReplicationLogEntry) {
  const current = readReplicationLog();
  current.push(entry);
  // Keep bounded history to avoid unbounded localStorage growth during test phase.
  const bounded = current.slice(-200);
  writeReplicationLog(bounded);
}

type ReplicationSummary = {
  pending: number;
  synced: number;
  failed: number;
  total: number;
};

function getReplicationSummaryInternal(): ReplicationSummary {
  const entries = readReplicationLog();
  let pending = 0;
  let synced = 0;
  let failed = 0;
  for (const e of entries) {
    if (e.status === 'synced') synced += 1;
    else if (e.status === 'failed') failed += 1;
    else pending += 1;
  }
  return { pending, synced, failed, total: entries.length };
}

async function replicateEntryStub(entry: ReplicationLogEntry): Promise<void> {
  // Stage 3: deterministic local mock replication.
  // Set localStorage SOCRATE_REPLICATION_STUB_FAIL=1 to simulate transient failures.
  const failMode = localStorage.getItem('SOCRATE_REPLICATION_STUB_FAIL') === '1';
  if (failMode) {
    throw new Error(`Stub replication failure for ${entry.backend}`);
  }
}

let replicationInFlight = false;

export async function flushReplicationQueue(maxEntries = 20): Promise<ReplicationSummary> {
  if (replicationInFlight) return getReplicationSummaryInternal();
  replicationInFlight = true;
  try {
    const entries = readReplicationLog();
    const pendingEntries = entries
      .filter((e) => e.status === 'pending' || e.status === 'failed')
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, Math.max(1, maxEntries));
    if (!pendingEntries.length) return getReplicationSummaryInternal();

    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const candidate of pendingEntries) {
      const current = byId.get(candidate.id);
      if (!current) continue;
      current.attempts = Number(current.attempts || 0) + 1;
      current.lastAttemptAt = Date.now();
      try {
        await replicateEntryStub(current);
        current.status = 'synced';
        current.lastError = undefined;
      } catch (err: any) {
        current.status = 'failed';
        current.lastError = String(err?.message || err || 'unknown replication error');
      }
      byId.set(current.id, current);
    }
    writeReplicationLog(Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt));
    return getReplicationSummaryInternal();
  } finally {
    replicationInFlight = false;
  }
}

export function getReplicationSummary(): ReplicationSummary {
  return getReplicationSummaryInternal();
}

class HybridConversationStore implements ConversationStore {
  backend: StorageBackend = 'hybrid';
  private localStore = new LocalDexieConversationStore();

  async saveConversationWithSegments(input: PersistConversationInput): Promise<void> {
    // Step 2 validation mode: write local source-of-truth first.
    await this.localStore.saveConversationWithSegments(input);

    // Then append a replication intent for future Neo4j/Chroma workers.
    appendReplicationEntry({
      id: `${input.conversation.id}:${Date.now()}`,
      createdAt: Date.now(),
      backend: 'hybrid',
      conversationId: input.conversation.id,
      segmentsCount: input.segments.length,
      status: 'pending',
      attempts: 0,
      payload: {
        conversation: input.conversation,
        segments: input.segments,
      },
    });
    void flushReplicationQueue();
  }
}

class Neo4jChromaConversationStore implements ConversationStore {
  backend: StorageBackend = 'neo4j_chroma';
  private localStore = new LocalDexieConversationStore();

  async saveConversationWithSegments(input: PersistConversationInput): Promise<void> {
    // Safety-first during progressive rollout:
    // keep local writes and queue a "pending" replication entry.
    await this.localStore.saveConversationWithSegments(input);
    appendReplicationEntry({
      id: `${input.conversation.id}:${Date.now()}`,
      createdAt: Date.now(),
      backend: 'neo4j_chroma',
      conversationId: input.conversation.id,
      segmentsCount: input.segments.length,
      status: 'pending',
      attempts: 0,
      payload: {
        conversation: input.conversation,
        segments: input.segments,
      },
    });
    void flushReplicationQueue();
  }
}

function resolveBackend(): StorageBackend {
  const raw = String(localStorage.getItem('SOCRATE_STORAGE_BACKEND') || 'local').toLowerCase();
  if (raw === 'hybrid') return 'hybrid';
  if (raw === 'neo4j_chroma') return 'neo4j_chroma';
  return 'local';
}

export function getConversationStore(): ConversationStore {
  const backend = resolveBackend();
  if (backend === 'hybrid') return new HybridConversationStore();
  if (backend === 'neo4j_chroma') return new Neo4jChromaConversationStore();
  return new LocalDexieConversationStore();
}
