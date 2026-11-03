/**
 * CLI tests for chat turn recovery (no DB / network):
 *   npx tsx scripts/test-turn-recovery.ts
 */
import assert from "node:assert/strict";
import {
  buildFallbackAnswer,
  hasSuccessfulToolResult,
  listProducedFiles,
  sanitizeGatewayHistory,
  withProducedFilesNote,
} from "../src/lib/chat/turn-recovery";
import { executeResponses } from "../src/lib/gateways/adapters/responses";
import type { DecryptedGatewayConfig } from "../src/lib/gateways/types";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

const docxPart = {
  type: "dynamic-tool",
  toolName: "create_document",
  state: "output-available",
  input: { filename: "laporan.docx" },
  output: { displayName: "Laporan_Kunjungan.docx", filename: "laporan-abc.docx" },
};
const searchPart = { type: "dynamic-tool", toolName: "web_search", state: "output-available", output: {} };
const failedPart = { type: "dynamic-tool", toolName: "write_file", state: "output-error", input: { filename: "x.html" } };

async function main() {
  await test("1. hasSuccessfulToolResult", () => {
    assert.equal(hasSuccessfulToolResult([docxPart]), true);
    assert.equal(hasSuccessfulToolResult([failedPart, { type: "text", text: "hi" }]), false);
  });

  await test("2. listProducedFiles: display name, file tools only, deduped", () => {
    assert.deepEqual(listProducedFiles([docxPart, searchPart, failedPart, docxPart]), ["Laporan_Kunjungan.docx"]);
    assert.deepEqual(listProducedFiles(null), []);
  });

  await test("3. buildFallbackAnswer: single file / interrupted note / no file", () => {
    const one = buildFallbackAnswer([docxPart], false);
    assert.match(one, /\*\*Laporan_Kunjungan\.docx\*\*/);
    assert.doesNotMatch(one, /lanjutkan/);
    assert.match(buildFallbackAnswer([docxPart], true), /lanjutkan/);
    assert.match(buildFallbackAnswer([searchPart], false), /sudah selesai dijalankan/);
  });

  await test("4. sanitizeGatewayHistory: drops empty, merges back-to-back user turns", () => {
    const out = sanitizeGatewayHistory([
      { role: "user", content: "buat laporan" },
      { role: "assistant", content: "  " },
      { role: "user", content: "mana belum selesai" },
      { role: "user", content: "mana woi" },
      { role: "assistant", content: "ok" },
    ]);
    assert.deepEqual(out, [
      { role: "user", content: "buat laporan\n\nmana belum selesai\n\nmana woi" },
      { role: "assistant", content: "ok" },
    ]);
  });

  await test("5. withProducedFilesNote keeps file-only replies in history", () => {
    assert.equal(withProducedFilesNote("", [docxPart]), "[Files created in this turn: Laporan_Kunjungan.docx]");
    assert.equal(withProducedFilesNote("Halo", []), "Halo");
  });

  await test("6. responses body: no empty items, user turns merged", async () => {
    let captured: Record<string, unknown> | null = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return new Response("bad", { status: 422 });
    }) as typeof fetch;
    const gateway = {
      id: 1n, name: "t", baseUrl: "https://api.x.ai/v1", apiKey: "k",
      timeoutMs: 5000, firstTokenTimeoutMs: 5000, extraHeaders: null,
    } as unknown as DecryptedGatewayConfig;
    try {
      const gen = executeResponses(gateway, {
        model: "grok-4.7",
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "a" },
          { role: "assistant", content: "" },
          { role: "user", content: "b" },
        ],
      });
      await assert.rejects(async () => {
        for await (const _ of gen) void _;
      }, (e: { rawProviderError?: string }) => e.rawProviderError === "bad");
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.ok(captured);
    assert.deepEqual((captured as Record<string, unknown>).input, [{ role: "user", content: "a\n\nb" }]);
  });

  console.log(`\nAll ${passed} tests passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
