import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  console.log("Seeding gemini-3.8-flash model and route...");

  // Find primary or first enabled gateway from DB
  const gateway = await db.gateway.findFirst({
    where: { isEnabled: true },
    orderBy: [{ isPrimary: "desc" }, { priority: "asc" }],
  });

  if (!gateway) {
    console.error("No enabled gateway found in the database. Please add one first.");
    process.exit(1);
  }

  const googleProvider = await db.modelProvider.findUnique({
    where: { slug: "google" },
  });

  if (!googleProvider) {
    console.error("Google provider not found in model_providers table.");
    process.exit(1);
  }

  // 1. UpstreamModel: gemini-3.8-flash on this gateway
  const upstreamModel = await db.upstreamModel.upsert({
    where: {
      gatewayId_modelKey: {
        gatewayId: gateway.id,
        modelKey: "gemini-3.8-flash",
      },
    },
    update: {
      ownedBy: "google",
      isAvailable: true,
      lastSeenAt: new Date(),
    },
    create: {
      gatewayId: gateway.id,
      modelKey: "gemini-3.8-flash",
      ownedBy: "google",
      isAvailable: true,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  });

  console.log(
    `[OK] UpstreamModel: id=${upstreamModel.id.toString()}, gatewayId=${gateway.id.toString()}, modelKey=${upstreamModel.modelKey}`
  );

  // 2. CatalogModel: publicId = "gemini/gemini-3.8-flash"
  const catalogModel = await db.catalogModel.upsert({
    where: { publicId: "gemini/gemini-3.8-flash" },
    update: {
      displayName: "Gemini 3.8 Flash",
      shortName: "Gemini 3.8 Flash",
      description: "Google's fast, multimodal model with native tool-use support.",
      providerId: googleProvider.id,
      category: "fast",
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: false,
      status: "active",
    },
    create: {
      publicId: "gemini/gemini-3.8-flash",
      displayName: "Gemini 3.8 Flash",
      shortName: "Gemini 3.8 Flash",
      description: "Google's fast, multimodal model with native tool-use support.",
      providerId: googleProvider.id,
      category: "fast",
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: false,
      status: "active",
      sortOrder: 30,
    },
  });

  console.log(
    `[OK] CatalogModel: id=${catalogModel.id.toString()}, publicId=${catalogModel.publicId}, status=${catalogModel.status}`
  );

  // 3. CatalogModelRoute: links catalogModel to upstreamModel
  const route = await db.catalogModelRoute.upsert({
    where: {
      catalogModelId_upstreamModelId: {
        catalogModelId: catalogModel.id,
        upstreamModelId: upstreamModel.id,
      },
    },
    update: {
      priority: 1,
      isEnabled: true,
    },
    create: {
      catalogModelId: catalogModel.id,
      upstreamModelId: upstreamModel.id,
      priority: 1,
      isEnabled: true,
    },
  });

  console.log(
    `[OK] CatalogModelRoute: id=${route.id.toString()}, priority=${route.priority}, isEnabled=${route.isEnabled}`
  );

  console.log("\nSuccess: gemini/gemini-3.8-flash is now active and routed to upstream gemini-3.8-flash!");
}

main()
  .catch((err) => {
    console.error("[ERROR]", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
