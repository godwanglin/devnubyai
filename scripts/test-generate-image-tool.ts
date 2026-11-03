import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { postProcessGeneratedImage } from "../src/lib/images/post-process";
import { executeImageGeneration } from "../src/lib/images/executor";
import { updateImageSettings, getImageSettings } from "../src/lib/images/settings";
import sharp from "sharp";

async function setupImageCatalogModel() {
  console.log("=== 1. Setting up Image Catalog Model in Database ===");

  // Find or create provider
  let provider = await db.modelProvider.findFirst({ where: { slug: "devnuby" } });
  if (!provider) {
    provider = await db.modelProvider.create({
      data: {
        slug: "devnuby",
        name: "Devnuby AI",
        logoKey: "devnuby",
      },
    });
  }

  // Ensure upstream models exist for Antigravity & xAI gateways
  const agGw = await db.gateway.findFirst({ where: { oauthProvider: "antigravity" } });
  const xaiGw = await db.gateway.findFirst({ where: { oauthProvider: "xai" } });

  if (agGw) {
    await db.upstreamModel.upsert({
      where: {
        gatewayId_modelKey: {
          gatewayId: agGw.id,
          modelKey: "gemini-3.1-flash-image",
        },
      },
      create: {
        gatewayId: agGw.id,
        modelKey: "gemini-3.1-flash-image",
        ownedBy: "Google",
        isAvailable: true,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
      update: { isAvailable: true, lastSeenAt: new Date() },
    });
  }

  if (xaiGw) {
    for (const key of ["grok-imagine-image-2.0", "grok-imagine-image"]) {
      await db.upstreamModel.upsert({
        where: {
          gatewayId_modelKey: {
            gatewayId: xaiGw.id,
            modelKey: key,
          },
        },
        create: {
          gatewayId: xaiGw.id,
          modelKey: key,
          ownedBy: "xAI",
          isAvailable: true,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
        update: { isAvailable: true, lastSeenAt: new Date() },
      });
    }
  }

  // Find all 3 upstreams
  const upstreams = await db.upstreamModel.findMany({
    where: {
      OR: [
        { modelKey: "gemini-3.1-flash-image" },
        { modelKey: "grok-imagine-image-2.0" },
        { modelKey: "grok-imagine-image" },
      ],
    },
    include: { gateway: true },
  });

  console.log(`Found ${upstreams.length} image upstream models in DB.`);

  // Upsert catalog model
  const catalog = await db.catalogModel.upsert({
    where: { publicId: "devnuby/image-gen" },
    create: {
      publicId: "devnuby/image-gen",
      displayName: "Devnuby Image Generator",
      shortName: "Image Gen",
      description: "Default image generation engine with Antigravity & Grok fallback",
      providerId: provider.id,
      category: "image",
      status: "active",
      routingStrategy: "priority",
    },
    update: {
      category: "image",
      status: "active",
      routingStrategy: "priority",
    },
  });

  // Link routes
  for (let i = 0; i < upstreams.length; i++) {
    const up = upstreams[i];
    const priority = up.modelKey.includes("gemini") ? 10 : up.modelKey.includes("2.0") ? 20 : 30;
    await db.catalogModelRoute.upsert({
      where: {
        catalogModelId_upstreamModelId: {
          catalogModelId: catalog.id,
          upstreamModelId: up.id,
        },
      },
      create: {
        catalogModelId: catalog.id,
        upstreamModelId: up.id,
        priority,
        isEnabled: true,
      },
      update: {
        priority,
        isEnabled: true,
      },
    });
  }

  // Set as active image catalog model in app_settings
  await updateImageSettings("devnuby/image-gen");
  const settings = await getImageSettings({ forceRefresh: true });
  assert.equal(settings.catalogModelId, "devnuby/image-gen");
  console.log("✓ Catalog model 'devnuby/image-gen' configured with routes and saved to app_settings.");
}

async function testPostProcessing() {
  console.log("\n=== 2. Testing Post-Processing (Aspect Ratio & Transparent BG) ===");

  const width = 200;
  const height = 200;
  const svg = `<svg width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#ffffff"/>
    <circle cx="100" cy="100" r="50" fill="#dc2626"/>
  </svg>`;
  const inputBuffer = await sharp(Buffer.from(svg)).jpeg().toBuffer();

  const widescreen = await postProcessGeneratedImage(inputBuffer, { aspectRatio: "16:9" });
  assert.equal(widescreen.mimeType, "image/jpeg");
  assert.equal(widescreen.width, 1344);
  assert.equal(widescreen.height, 768);
  console.log("✓ Aspect ratio resize to 16:9 (1344x768) verified.");

  const transparent = await postProcessGeneratedImage(inputBuffer, { transparentBackground: true });
  assert.equal(transparent.mimeType, "image/png");
  const meta = await sharp(transparent.buffer).metadata();
  assert.equal(meta.hasAlpha, true, "Output PNG must possess an alpha channel");

  const raw = await sharp(transparent.buffer).raw().toBuffer();
  assert.equal(raw[3], 0, "Corner pixel alpha must be 0 (transparent)");

  console.log("✓ Background removal produces true RGBA PNG with transparent outer background.");
}

async function testLiveGeneration() {
  console.log("\n=== 3. Testing Live executeImageGeneration with Fallback Pool ===");
  const outDir = path.resolve(process.cwd(), ".logs", "image-tests");
  fs.mkdirSync(outDir, { recursive: true });

  const result = await executeImageGeneration(
    "a cute friendly robot sticker with white borders, cartoon 3d style",
    {
      aspectRatio: "1:1",
      transparentBackground: true,
    }
  );

  assert(result.buffer.length > 5000);
  assert.equal(result.mimeType, "image/png");
  console.log("Model used:", result.modelUsed);
  console.log("Gateway used:", result.gatewayUsed);
  console.log("Account used:", result.accountEmailUsed);
  console.log("Output dimensions:", `${result.width}x${result.height}`);

  const outPath = path.join(outDir, "live-robot-transparent.png");
  fs.writeFileSync(outPath, result.buffer);
  console.log(`✓ Image saved to ${outPath} (${fs.statSync(outPath).size} bytes)`);
}

async function main() {
  await setupImageCatalogModel();
  await testPostProcessing();
  await testLiveGeneration();
  console.log("\n🎉 All Image Generation & Transparent Background tests passed successfully!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
