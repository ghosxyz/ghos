/**
 * Event subscription helper.
 *
 * Wraps `Connection.onLogs` so consumers can observe program events without
 * touching the raw Anchor log format. Events are parsed by scanning each log
 * line for the `Program data:` marker, base64-decoding the payload, matching
 * the first 8 bytes against event discriminators from the IDL, and emitting
 * the decoded struct.
 *
 * This is intentionally minimal: no heavy Anchor BorshCoder, just the bare
 * bytes. Decoding is performed per-event using field descriptors from the
 * IDL.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import ghosIdl from "./idl/ghos.json";
import { GHOS_PROGRAM_ID } from "./constants";
import { fromBase64 } from "./utils";
import type { EventHandler, WatcherSubscription } from "./types";

/**
 * Known event names emitted by the ghos program.
 */
export type GhosEventName =
  | "ConfigInitialized"
  | "ConfigUpdated"
  | "ShieldExecuted"
  | "ConfidentialTransferSubmitted"
  | "PendingApplied"
  | "WithdrawExecuted"
  | "BurnerCreated"
  | "BurnerDestroyed"
  | "AuditorRegistered"
  | "AuditorRotated"
  | "MixRoundOpened"
  | "MixCommitted"
  | "MixRevealed"
  | "MixSettled";

interface IdlField {
  name: string;
  type:
    | "publicKey"
    | "u64"
    | "i64"
    | "u16"
    | "u8"
    | { array: [string, number] };
  index?: boolean;
}

interface IdlEvent {
  name: string;
  discriminator: number[];
  fields: IdlField[];
}

/**
 * Map of event name to pre-built (Uint8Array) discriminator for fast match.
 */
const EVENT_DISCRIMINATORS: Record<string, Uint8Array> = {};
for (const ev of (ghosIdl.events ?? []) as IdlEvent[]) {
  EVENT_DISCRIMINATORS[ev.name] = new Uint8Array(ev.discriminator);
}

/**
 * Map of event name to field list, used to decode the payload.
 */
const EVENT_FIELDS: Record<string, IdlField[]> = {};
for (const ev of (ghosIdl.events ?? []) as IdlEvent[]) {
  EVENT_FIELDS[ev.name] = ev.fields;
}

/**
 * Decode a single event field given its type descriptor and a cursor into
 * the byte array. Returns the parsed value and the new cursor offset.
 */
function decodeField(
  bytes: Uint8Array,
  cursor: number,
  type: IdlField["type"]
): { value: unknown; cursor: number } {
  if (type === "publicKey") {
    const slice = bytes.slice(cursor, cursor + 32);
    return { value: new PublicKey(slice), cursor: cursor + 32 };
  }
  if (type === "u64") {
    let v = 0n;
    for (let i = 0; i < 8; i++) {
      v |= BigInt(bytes[cursor + i] ?? 0) << (8n * BigInt(i));
    }
    return { value: v, cursor: cursor + 8 };
  }
  if (type === "i64") {
    let v = 0n;
    for (let i = 0; i < 8; i++) {
      v |= BigInt(bytes[cursor + i] ?? 0) << (8n * BigInt(i));
    }
    // sign-extend
    const signBit = 1n << 63n;
    if (v & signBit) {
      v = v - (1n << 64n);
    }
    return { value: v, cursor: cursor + 8 };
  }
  if (type === "u16") {
    const lo = bytes[cursor] ?? 0;
    const hi = bytes[cursor + 1] ?? 0;
    return { value: lo | (hi << 8), cursor: cursor + 2 };
  }
  if (type === "u8") {
    return { value: bytes[cursor] ?? 0, cursor: cursor + 1 };
  }
  if (typeof type === "object" && type.array) {
    const [inner, len] = type.array;
    if (inner !== "u8") {
      throw new Error(`unsupported array inner type ${inner}`);
    }
    return {
      value: bytes.slice(cursor, cursor + len),
      cursor: cursor + len
    };
  }
  throw new Error(`unsupported event field type: ${JSON.stringify(type)}`);
}

/**
 * Decode a full event payload. Returns the decoded record shaped by the IDL
 * field names.
 */
export function decodeEvent(
  name: string,
  payload: Uint8Array
): Record<string, unknown> {
  const fields = EVENT_FIELDS[name];
  if (!fields) {
    throw new Error(`unknown event: ${name}`);
  }
  const obj: Record<string, unknown> = {};
  let cursor = 0;
  for (const f of fields) {
    const res = decodeField(payload, cursor, f.type);
    obj[f.name] = res.value;
    cursor = res.cursor;
  }
  return obj;
}

/**
 * Attempt to match the leading 8 bytes of the payload against one of the
 * known event discriminators. Returns the event name if a match is found.
 */
export function matchEventDiscriminator(
  payload: Uint8Array
): GhosEventName | null {
  if (payload.length < 8) {
    return null;
  }
  const head = payload.slice(0, 8);
  for (const [name, disc] of Object.entries(EVENT_DISCRIMINATORS)) {
    let ok = true;
    for (let i = 0; i < 8; i++) {
      if (head[i] !== disc[i]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return name as GhosEventName;
    }
  }
  return null;
}

/**
 * Scan a single log line for a program-data payload. Returns the base64
 * payload if present, null otherwise.
 */
export function extractProgramData(line: string): string | null {
  const prefix = "Program data: ";
  if (!line.startsWith(prefix)) {
    return null;
  }
  return line.slice(prefix.length).trim();
}

/**
 * Subscribe to an event stream on the ghos program. Provides a filtered
 * handler that only fires when the matched event's name equals the one
 * supplied.
 */
export async function subscribe<T>(
  connection: Connection,
  eventName: GhosEventName,
  handler: EventHandler<T>,
  programId: PublicKey = GHOS_PROGRAM_ID
): Promise<WatcherSubscription> {
  const subId = connection.onLogs(programId, (logs, ctx) => {
    if (!logs.logs) {
      return;
    }
    for (const line of logs.logs) {
      const payload = extractProgramData(line);
      if (!payload) {
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = fromBase64(payload);
      } catch {
        continue;
      }
      const name = matchEventDiscriminator(bytes);
      if (!name || name !== eventName) {
        continue;
      }
      let decoded: Record<string, unknown>;
      try {
        decoded = decodeEvent(name, bytes.slice(8));
      } catch {
        continue;
      }
      Promise.resolve(handler(decoded as T, ctx.slot, logs.signature ?? "")).catch(
        (err) => {
          // Swallow handler errors so a faulty consumer cannot tear the
          // subscription down.
          void err;
        }
      );
    }
  }, "confirmed");

  return {
    id: subId,
    name: eventName,
    unsubscribe: async () => {
      await connection.removeOnLogsListener(subId);
    }
  };
}

/**
 * Subscribe to every event the ghos program emits. The handler receives
 * `{ name, event, slot, signature }` for each decoded event.
 */
export async function subscribeAll(
  connection: Connection,
  handler: (payload: {
    name: GhosEventName;
    event: Record<string, unknown>;
    slot: number;
    signature: string;
  }) => void | Promise<void>,
  programId: PublicKey = GHOS_PROGRAM_ID
): Promise<WatcherSubscription> {
  const subId = connection.onLogs(programId, (logs, ctx) => {
    if (!logs.logs) {
      return;
    }
    for (const line of logs.logs) {
      const payload = extractProgramData(line);
      if (!payload) {
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = fromBase64(payload);
      } catch {
        continue;
      }
      const name = matchEventDiscriminator(bytes);
      if (!name) {
        continue;
      }
      let decoded: Record<string, unknown>;
      try {
        decoded = decodeEvent(name, bytes.slice(8));
      } catch {
        continue;
      }
      Promise.resolve(
        handler({ name, event: decoded, slot: ctx.slot, signature: logs.signature ?? "" })
      ).catch(() => {
        // ignore handler errors
      });
    }
  }, "confirmed");

  return {
    id: subId,
    name: "*",
    unsubscribe: async () => {
      await connection.removeOnLogsListener(subId);
    }
  };
}
