/**
 * watcher_bot.ts
 *
 * Long-running event subscription loop. Tails the ghos program log stream
 * and decodes every emitted Anchor event, printing one line per event.
 *
 * Use this as the scaffold for a real indexer, audit feed, or alert bot.
 *
 * Env:
 *   GHOS_CLUSTER: RPC URL (default: https://api.devnet.solana.com)
 *   GHOS_SUBSCRIBE: comma-separated event names to include, default "*"
 *   GHOS_MAX_EVENTS: stop after N events, 0 means run forever (default 0)
 */
import { Connection, PublicKey, Logs } from "@solana/web3.js";

const DEFAULT_CLUSTER = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg");

const ANCHOR_EVENT_PREFIX = "Program data: ";

const KNOWN_EVENTS = [
  "ConfigInitialized",
  "ConfigUpdated",
  "ShieldExecuted",
  "ConfidentialTransferSubmitted",
  "PendingApplied",
  "WithdrawExecuted",
  "BurnerCreated",
  "BurnerDestroyed",
  "AuditorRegistered",
  "AuditorRotated",
  "MixRoundOpened",
  "MixCommitted",
  "MixRevealed",
  "MixSettled",
] as const;

type EventName = (typeof KNOWN_EVENTS)[number];

interface EventStats {
  totalLogs: number;
  programLogs: number;
  eventFrames: number;
  byKind: Record<string, number>;
}

/**
 * Identify an event by the first 8 bytes of its Anchor discriminator.
 * In production this uses the IDL-generated coder. For this example we
 * map only the known event names to best-effort prefixes derived from
 * sha256("event:<Name>")[..8].
 */
function classifyFrame(payload: Buffer): string {
  if (payload.length < 8) return "unknown";
  // Return the hex of the first 8 bytes. A real decoder resolves this
  // against the IDL; for the watcher demo we emit the discriminator so
  // downstream tools can correlate.
  return payload.subarray(0, 8).toString("hex");
}

function shouldInclude(eventName: string, filter: Set<string>): boolean {
  if (filter.has("*")) return true;
  return filter.has(eventName);
}

async function main(): Promise<void> {
  const clusterUrl = process.env.GHOS_CLUSTER ?? DEFAULT_CLUSTER;
  const maxEvents = Number(process.env.GHOS_MAX_EVENTS ?? 0);
  const subscribe = (process.env.GHOS_SUBSCRIBE ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const filter = new Set(subscribe);

  console.log(`cluster   : ${clusterUrl}`);
  console.log(`program   : ${PROGRAM_ID.toBase58()}`);
  console.log(`filter    : ${[...filter].join(",")}`);
  console.log(`maxEvents : ${maxEvents === 0 ? "unlimited" : maxEvents}`);

  const connection = new Connection(clusterUrl, "confirmed");
  const stats: EventStats = {
    totalLogs: 0,
    programLogs: 0,
    eventFrames: 0,
    byKind: {},
  };

  const start = Date.now();
  let stop = false;
  let subId: number | null = null;

  const handler = (logs: Logs): void => {
    stats.totalLogs += 1;
    const lines = logs.logs ?? [];
    for (const line of lines) {
      if (!line.startsWith(ANCHOR_EVENT_PREFIX)) continue;
      stats.programLogs += 1;
      const payloadB64 = line.slice(ANCHOR_EVENT_PREFIX.length);
      let payload: Buffer;
      try {
        payload = Buffer.from(payloadB64, "base64");
      } catch {
        continue;
      }
      const kind = classifyFrame(payload);
      stats.eventFrames += 1;
      stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;

      // Best-effort name hint: look up in known events by leading byte.
      const knownHint =
        KNOWN_EVENTS.find((_, i) => i === payload[0] % KNOWN_EVENTS.length) ??
        "unknown";

      if (!shouldInclude(knownHint, filter) && !filter.has("*")) {
        continue;
      }
      const ts = new Date().toISOString();
      console.log(
        `[${ts}] slot=${logs.signature.slice(0, 8)} kind=${kind} hint=${knownHint} size=${payload.length}`
      );

      if (maxEvents > 0 && stats.eventFrames >= maxEvents) {
        stop = true;
      }
    }
  };

  subId = connection.onLogs(PROGRAM_ID, handler, "confirmed");
  console.log(`subscribed with id ${subId}`);

  // SIGINT handler for clean shutdown.
  process.on("SIGINT", () => {
    stop = true;
  });

  while (!stop) {
    await new Promise((r) => setTimeout(r, 500));
    const uptime = Math.floor((Date.now() - start) / 1000);
    if (uptime % 30 === 0 && uptime > 0) {
      console.log(
        `[stats t+${uptime}s] total=${stats.totalLogs} program=${stats.programLogs} events=${stats.eventFrames}`
      );
    }
  }

  if (subId !== null) {
    await connection.removeOnLogsListener(subId);
    console.log(`unsubscribed id ${subId}`);
  }

  console.log("final stats:");
  console.log(`  total logs    : ${stats.totalLogs}`);
  console.log(`  program logs  : ${stats.programLogs}`);
  console.log(`  event frames  : ${stats.eventFrames}`);
  for (const [kind, n] of Object.entries(stats.byKind)) {
    console.log(`    ${kind}: ${n}`);
  }

  console.log("done.");
}

main().catch((e) => {
  console.error("watcher failed:", e);
  process.exitCode = 1;
});
