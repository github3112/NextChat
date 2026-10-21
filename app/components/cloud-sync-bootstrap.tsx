"use client";

import { useEffect } from "react";
import {
  deleteRemoteChat,
  chatNeedsUpload,
  getPyjriCloudUser,
  getUserD1Connection,
  listRemoteChats,
  RemoteChatRecord,
  writeRemoteChat,
} from "../utils/pyjri-cloud";
import { safeLocalStorage } from "../utils";
import { ChatSession, useChatStore } from "../store/chat";
import { showToast } from "./ui-lib";
import { isPyjriCloudConfigured } from "../utils/pyjri-cloud";

const storage = safeLocalStorage();
const TOMBSTONES_KEY = "pyjri-cloud-chat-tombstones";

function readTombstones(): Record<string, number> {
  const raw = storage.getItem(TOMBSTONES_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([id, timestamp]) =>
          id.length > 0 &&
          typeof timestamp === "number" &&
          Number.isFinite(timestamp),
      ),
    ) as Record<string, number>;
  } catch (error) {
    console.error("[Pyjri Cloud] invalid local deletion metadata", error);
    showToast("Cloud sync metadata is damaged; local chats were kept.");
    return {};
  }
}

function writeTombstones(tombstones: Record<string, number>) {
  storage.setItem(TOMBSTONES_KEY, JSON.stringify(tombstones));
}

function mergeSessions(
  local: ChatSession,
  remote: ChatSession,
): { session: ChatSession; conflict: boolean } {
  const messages = new Map(remote.messages.map((message) => [message.id, message]));
  let conflict = false;

  for (const message of local.messages) {
    const remoteMessage = messages.get(message.id);
    if (remoteMessage && JSON.stringify(remoteMessage) !== JSON.stringify(message)) {
      conflict = true;
    } else {
      messages.set(message.id, message);
    }
  }

  const mergedMessages = Array.from(messages.values()).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const newest = local.lastUpdate >= remote.lastUpdate ? local : remote;

  return {
    session: {
      ...remote,
      ...newest,
      messages: mergedMessages,
    },
    conflict,
  };
}

async function loadRemoteChats(): Promise<RemoteChatRecord[]> {
  const records: RemoteChatRecord[] = [];
  let cursor = "";

  do {
    const page = await listRemoteChats(cursor);
    records.push(...page.records);
    cursor = page.nextCursor ?? "";
  } while (cursor);

  return records;
}

export function CloudSyncBootstrap() {
  useEffect(() => {
    if (!isPyjriCloudConfigured()) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previousSessions = useChatStore.getState().sessions;
    let syncReady = false;
    let syncQueue = Promise.resolve();
    let revisions = new Map<string, number>();
    let fingerprints = new Map<string, string>();
    let conflictedIds = new Set<string>();
    let tombstones = readTombstones();
    let conflictNotified = false;

    const notifyConflict = () => {
      if (conflictNotified) return;
      conflictNotified = true;
      showToast(
        "A cloud chat changed on another device. Both saved versions were kept; review the chat before syncing again.",
      );
    };

    const flush = async (sessions: ChatSession[]) => {
      for (const chatId of Object.keys(tombstones)) {
        if (stopped) return;
        try {
          const result = await deleteRemoteChat(
            chatId,
            revisions.get(chatId) ?? 0,
          );
          revisions.set(chatId, result.revision);
          delete tombstones[chatId];
          writeTombstones(tombstones);
        } catch (error) {
          if (
            error instanceof Error &&
            "status" in error &&
            error.status === 409
          ) {
            conflictedIds.add(chatId);
            notifyConflict();
            continue;
          }
          console.error("[Pyjri Cloud] failed to sync chat deletion", error);
          return;
        }
      }

      for (const chat of sessions) {
        if (
          stopped ||
          chat.messages.length === 0 ||
          tombstones[chat.id] ||
          conflictedIds.has(chat.id)
        ) {
          continue;
        }
        if (!chatNeedsUpload(chat, fingerprints.get(chat.id))) continue;

        try {
          const result = await writeRemoteChat(
            chat,
            revisions.get(chat.id) ?? 0,
          );
          revisions.set(chat.id, result.revision);
          fingerprints.set(chat.id, JSON.stringify(chat));
        } catch (error) {
          if (
            error instanceof Error &&
            "status" in error &&
            error.status === 409
          ) {
            conflictedIds.add(chat.id);
            notifyConflict();
            continue;
          }
          console.error("[Pyjri Cloud] failed to sync chat", error);
          return;
        }
      }
    };

    const queueFlush = (sessions: ChatSession[]) => {
      syncQueue = syncQueue.then(() => flush(sessions)).catch((error) => {
        console.error("[Pyjri Cloud] queued chat sync failed", error);
        showToast("Could not sync chats with Pyjri Cloud.");
      });
    };

    const unsubscribe = useChatStore.subscribe((state) => {
      const nextSessions = state.sessions;
      const nextIds = new Set(nextSessions.map((session) => session.id));
      for (const previous of previousSessions) {
        if (!nextIds.has(previous.id)) {
          tombstones[previous.id] = Date.now();
        }
      }
      previousSessions = nextSessions;
      writeTombstones(tombstones);

      if (!syncReady) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        queueFlush(nextSessions);
      }, 1_500);
    });

    const initialize = async () => {
      const user = await getPyjriCloudUser();
      if (!user || stopped) return;

      const connection = await getUserD1Connection();
      if (!connection.connected || stopped) return;

      const remoteRecords = await loadRemoteChats();
      for (const record of remoteRecords) {
        revisions.set(record.chat_id, record.revision);
      }

      const localSessions = useChatStore.getState().sessions;
      const localById = new Map(localSessions.map((session) => [session.id, session]));
      const mergedById = new Map(localById);

      for (const record of remoteRecords) {
        if (tombstones[record.chat_id]) continue;
        if (record.deleted_at || !record.payload) {
          if (localById.has(record.chat_id)) {
            conflictedIds.add(record.chat_id);
            notifyConflict();
          }
          continue;
        }
        let remoteSession: ChatSession;
        try {
          remoteSession = JSON.parse(record.payload) as ChatSession;
          if (remoteSession.id !== record.chat_id || !Array.isArray(remoteSession.messages)) {
            throw new Error("Invalid remote chat shape");
          }
        } catch (error) {
          console.error("[Pyjri Cloud] invalid remote chat record", error);
          showToast("A cloud chat could not be read; local chats were kept.");
          continue;
        }
        fingerprints.set(record.chat_id, JSON.stringify(remoteSession));

        const localSession = mergedById.get(record.chat_id);
        if (!localSession) {
          mergedById.set(record.chat_id, remoteSession);
        } else {
          const merged = mergeSessions(localSession, remoteSession);
          if (merged.conflict) {
            conflictedIds.add(record.chat_id);
            notifyConflict();
          } else {
            mergedById.set(record.chat_id, merged.session);
          }
        }
      }

      const mergedSessions = Array.from(mergedById.values()).sort(
        (a, b) => b.lastUpdate - a.lastUpdate,
      );
      const current = useChatStore.getState();
      const currentId = current.sessions[current.currentSessionIndex]?.id;
      const currentIndex = Math.max(
        0,
        mergedSessions.findIndex((session) => session.id === currentId),
      );
      previousSessions = mergedSessions;
      useChatStore.setState({
        sessions: mergedSessions,
        currentSessionIndex: currentIndex,
      });

      syncReady = true;
      if (Object.keys(tombstones).length > 0) {
        queueFlush(mergedSessions);
      }
      if (stopped) return;

      queueFlush(mergedSessions);
    };

    initialize()
      .catch((error) => {
        if (!stopped) {
          console.error("[Pyjri Cloud] chat sync initialization failed", error);
          showToast("Could not sync chats with Pyjri Cloud.");
        }
      });

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return null;
}
