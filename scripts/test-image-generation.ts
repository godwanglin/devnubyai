import { getOrCreateOAuthGateway } from "../src/lib/gateways/provider-service";
import { getGatewayById } from "../src/lib/gateways/repository";
import { resolveOAuthGatewayAuth } from "../src/lib/gateways/oauth-dispatch";
import { ANTIGRAVITY_USER_AGENT } from "../src/lib/oauth/constants/antigravity";
import fs from "node:fs";
import path from "node:path";

const PROMPT = "a simple red apple on a clean white background, minimalist studio photo";
const OUT_DIR = path.resolve(process.cwd(), ".logs", "image-tests");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function testAntigravity() {
  console.log("\n==================================================");
  console.log("1. TESTING ANTIGRAVITY: gemini-3.1-flash-image");
  console.log("==================================================");
  try {
    const gwInfo = await getOrCreateOAuthGateway("antigravity");
    const gw = await getGatewayById(gwInfo.id);
    if (!gw) throw new Error("Antigravity gateway not found");
    const auth = await resolveOAuthGatewayAuth(gw);
    if (!auth) throw new Error("No active Antigravity OAuth auth resolved");

    console.log("Auth resolved! Project ID:", auth.headers["x-devnuby-antigravity-project"]);
    console.log("Access Token prefix:", auth.accessToken.slice(0, 15) + "...");

    // Antigravity inference endpoint accepts generateContent/streamGenerateContent
    // Testing modalities: ["IMAGE"] or ["TEXT", "IMAGE"]
    const endpoints = [
      "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
      "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent",
    ];

    for (const url of endpoints) {
      console.log(`\nTrying URL: ${url}`);
      const body = {
        project: auth.headers["x-devnuby-antigravity-project"],
        model: "gemini-3.1-flash-image",
        request: {
          contents: [
            {
              role: "user",
              parts: [{ text: PROMPT }],
            },
          ],
          generationConfig: {
            responseModalities: ["IMAGE"],
          },
        },
      };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": ANTIGRAVITY_USER_AGENT,
        },
        body: JSON.stringify(body),
      });

      console.log(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      console.log("Response snippet (first 600 chars):");
      console.log(text.slice(0, 600));

      if (res.ok) {
        // Look for image data in SSE or JSON
        const match = text.match(/"inlineData"\s*:\s*\{\s*"mimeType"\s*:\s*"([^"]+)"\s*,\s*"data"\s*:\s*"([^"]+)"/);
        if (match) {
          const mime = match[1];
          const b64 = match[2];
          const ext = mime.includes("png") ? "png" : "jpg";
          const outPath = path.join(OUT_DIR, `gemini-3.1-flash-image.${ext}`);
          fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
          console.log(`\n>>> SUCCESS! Image saved to: ${outPath} (${fs.statSync(outPath).size} bytes)`);
          return;
        }
      }
    }
  } catch (err) {
    console.error("Antigravity test error:", err);
  }
}

async function testXaiModel(modelName: string) {
  console.log("\n==================================================");
  console.log(`TESTING XAI (GROK): ${modelName}`);
  console.log("==================================================");
  try {
    const gwInfo = await getOrCreateOAuthGateway("xai");
    const gw = await getGatewayById(gwInfo.id);
    if (!gw) throw new Error("xAI gateway not found");
    const auth = await resolveOAuthGatewayAuth(gw);
    if (!auth) throw new Error("No active xAI OAuth auth resolved");

    console.log("Auth resolved! Access token prefix:", auth.accessToken.slice(0, 15) + "...");

    // 1. Try standard OpenAI-style /v1/images/generations
    console.log(`\n1) Probing POST https://api.x.ai/v1/images/generations with model: ${modelName}`);
    const imgRes = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "grok-cli/9router",
      },
      body: JSON.stringify({
        model: modelName,
        prompt: PROMPT,
        n: 1,
        response_format: "b64_json",
      }),
    });

    console.log(`HTTP ${imgRes.status} ${imgRes.statusText}`);
    const imgText = await imgRes.text();
    console.log("Response snippet:");
    console.log(imgText.slice(0, 600));

    if (imgRes.ok) {
      try {
        const json = JSON.parse(imgText);
        const item = json.data?.[0];
        if (item?.b64_json) {
          const outPath = path.join(OUT_DIR, `${modelName}.jpg`);
          fs.writeFileSync(outPath, Buffer.from(item.b64_json, "base64"));
          console.log(`\n>>> SUCCESS! Image saved to: ${outPath} (${fs.statSync(outPath).size} bytes)`);
          return;
        }
        if (item?.url) {
          console.log(`\n>>> SUCCESS! Image URL: ${item.url}`);
          return;
        }
      } catch {}
    }

    // 2. If 404 or unsupported, try chat completions with image tool or response format
    console.log(`\n2) Probing POST https://api.x.ai/v1/chat/completions with model: ${modelName}`);
    const chatRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "grok-cli/9router",
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: PROMPT }],
      }),
    });
    console.log(`HTTP ${chatRes.status} ${chatRes.statusText}`);
    const chatText = await chatRes.text();
    console.log(chatText.slice(0, 600));
  } catch (err) {
    console.error(`xAI ${modelName} test error:`, err);
  }
}

async function main() {
  await testAntigravity();
  await testXaiModel("grok-imagine-image");
  await testXaiModel("grok-imagine-image-2.0");
}

main().catch(console.error);
