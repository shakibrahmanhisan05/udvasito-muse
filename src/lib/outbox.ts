import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Offline outbox (F-207, X03). When a request post fails because the
 * network is gone, the exact create-args are queued locally with
 * their clientId; on reconnect the queue flushes and the server's
 * clientId idempotency (requests.create) guarantees exactly one
 * request exists per queued item, however often a flush is retried.
 * The queue is per-device and holds only what the member typed into
 * their own form.
 */

export type OutboxItem = {
  clientId: string;
  /** The exact requests.create argument object. */
  payload: Record<string, unknown>;
  queuedAt: number;
};

export type KeyValueStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

const STORAGE_KEY = "udvasito.outbox.v1";

const defaultStorage: KeyValueStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};

export class Outbox {
  constructor(private readonly storage: KeyValueStorage = defaultStorage) {}

  async list(): Promise<OutboxItem[]> {
    try {
      const raw = await this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as OutboxItem[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Queue an item; the same clientId never queues twice. */
  async enqueue(item: OutboxItem): Promise<OutboxItem[]> {
    const items = await this.list();
    if (items.some((i) => i.clientId === item.clientId)) return items;
    const next = [...items, item];
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  async remove(clientId: string): Promise<OutboxItem[]> {
    const items = await this.list();
    const next = items.filter((i) => i.clientId !== clientId);
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  /**
   * Send queued items oldest-first. An item leaves the queue only
   * when `send` resolves (the server answering {existing:true} also
   * resolves — that IS success). The first failure stops the flush
   * and keeps everything queued for the next reconnect.
   */
  async flush(
    send: (item: OutboxItem) => Promise<unknown>,
  ): Promise<{ sent: number; remaining: number }> {
    let items = await this.list();
    let sent = 0;
    while (items.length > 0) {
      const [head] = items;
      try {
        await send(head!);
      } catch {
        break;
      }
      sent += 1;
      items = await this.remove(head!.clientId);
    }
    return { sent, remaining: items.length };
  }
}

export const outbox = new Outbox();
