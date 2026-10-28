import "dotenv/config";
import { db } from "@/lib/db";
import { dispatchGatewayStream } from "@/lib/gateways/dispatcher";
import { executeWithFallback } from "@/lib/routing/executor";
import { resolveCandidates } from "@/lib/routing/resolver";

async function measureStream(
  stream: AsyncIterable<{ type: string; text?: string }>,
  label: string
) {
  const startedAt = performance.now();
  let firstDeltaAt: number | null = null;
  let lastDeltaAt = startedAt;
  let chunks = 0;
  let chars = 0;
  const intervals: number[] = [];

  for await (const event of stream) {
    const now = performance.now();
    if (event.type !== "delta" || !event.text) continue;
    if (firstDeltaAt === null) firstDeltaAt = now;
    intervals.push(now - lastDeltaAt);
    lastDeltaAt = now;
    chunks += 1;
    chars += event.text.length;
  }

  const totalMs = performance.now() - startedAt;
  const ttftMs = firstDeltaAt === null ? null : firstDeltaAt - startedAt;
  const postFirstIntervals = intervals.slice(1);
  const avgInterval = postFirstIntervals.length
    ? postFirstIntervals.reduce((sum, value) => sum + value, 0) / postFirstIntervals.length
    : null;

  console.log(`- ${label} TTFT: ${ttftMs === null ? "n/a" : `${ttftMs.toFixed(1)} ms`}`);
  console.log(`- ${label} Total Time: ${totalMs.toFixed(1)} ms`);
  console.log(`- ${label} Chunks: ${chunks}`);
  console.log(`- ${label} Chars: ${chars}`);
  console.log(`- ${label} Avg Post-first Chunk Interval: ${avgInterval === null ? "n/a" : `${avgInterval.toFixed(1)} ms`}`);

  return { ttftMs, totalMs, chunks, chars, avgInterval };
}

async function main() {
  const activeCatalog = await db.catalogModel.findFirst({
    where: { status: "active" },
    select: { publicId: true },
    orderBy: { publicId: "asc" },
  });
  if (!activeCatalog) throw new Error("No active catalog model found");

  const resolved = await resolveCandidates(activeCatalog.publicId, { forceRefresh: true });
  const candidate = resolved.candidates[0];
  if (!candidate) throw new Error(`No enabled route for ${activeCatalog.publicId}`);

  const prompt = "Jelaskan secara mendalam tentang siklus air di bumi beserta tahapannya, tulis dalam minimal 250 kata.";
  console.log(`[USING_PUBLIC_ID] ${activeCatalog.publicId}`);
  console.log(`[USING_UPSTREAM] ${candidate.upstreamModelKey} via ${candidate.gateway.slug}`);

  console.log("\n=======================================================");
  console.log("1. TEST DIRECT UPSTREAM STREAMING VIA SAME RESOLVED ROUTE");
  console.log("=======================================================");
  let direct;
  try {
    direct = await measureStream(
      dispatchGatewayStream(candidate.gateway, {
        model: candidate.upstreamModelKey,
        messages: [{ role: "user", content: prompt }],
      }),
      "Direct"
    );
  } catch (error) {
    console.error("DIRECT_STREAM_ERROR:", error instanceof Error ? error.message : error);
    direct = null;
  }

  console.log("\n=======================================================");
  console.log("2. TEST BACKEND EXECUTOR STREAMING (SMART ROUTER)");
  console.log("=======================================================");
  let backend;
  try {
    backend = await measureStream(
      executeWithFallback({
        publicModelId: activeCatalog.publicId,
        requestId: `bench-req-${Date.now()}`,
        request: { messages: [{ role: "user", content: prompt }] },
      }),
      "Backend"
    );
  } catch (error) {
    console.error("BACKEND_STREAM_ERROR:", error instanceof Error ? error.message : error);
    backend = null;
  }

  console.log("\n=======================================================");
  console.log("COMPARISON");
  console.log("=======================================================");
  if (!direct || !backend) {
    console.log("STATUS: INCONCLUSIVE - one stream failed before comparison.");
  } else {
    const ttftDelta = backend.ttftMs !== null && direct.ttftMs !== null
      ? backend.ttftMs - direct.ttftMs
      : null;
    console.log(`TTFT delta (separate requests, not pure router overhead): ${ttftDelta === null ? "n/a" : `${ttftDelta.toFixed(1)} ms`}`);
    console.log(`Chunk counts: direct ${direct.chunks} vs backend ${backend.chunks}`);
    console.log(`Post-first cadence: direct ${direct.avgInterval === null ? "n/a" : `${direct.avgInterval.toFixed(1)} ms`} vs backend ${backend.avgInterval === null ? "n/a" : `${backend.avgInterval.toFixed(1)} ms`}`);
    console.log(
      backend.chunks > 0 && backend.avgInterval !== null
        ? "STATUS: STREAMING EVENTS ARRIVED INCREMENTALLY."
        : "STATUS: INCONCLUSIVE - backend emitted no incremental deltas."
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
