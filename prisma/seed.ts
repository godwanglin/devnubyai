import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db as prisma } from "../src/lib/db";
import { encryptSecret } from "../src/lib/crypto/vault";
import type { InputJsonValue } from "../src/generated/internal/prismaNamespace";

async function main() {
  console.log("🌱 Starting Devnuby AI database seeding...");

  // 1. Seed Plans
  console.log("-> Seeding plans...");
  const plansData = [
    {
      slug: "free",
      name: "Free Plan",
      description: "For getting started with Devnuby AI",
      priceMonthly: 0,
      priceYearly: 0,
      currency: "IDR",
      // Spend caps in USD (null = no limit for that window)
      monthlyCostLimitUsd: "0.50",
      weeklyCostLimitUsd: null,
      fiveHourCostLimitUsd: "0.10",
      dailyRequestLimit: 200,
      requestsPerMinute: 20,
      maxParallelRequests: 1,
      badge: "Free",
      isActive: true,
      sortOrder: 10,
    },
    {
      slug: "pro",
      name: "Pro Plan",
      description: "For power users and professionals",
      priceMonthly: 149_000,
      priceYearly: 1_490_000,
      currency: "IDR",
      monthlyCostLimitUsd: "5.00",
      weeklyCostLimitUsd: "1.50",
      fiveHourCostLimitUsd: "0.40",
      dailyRequestLimit: 2000,
      requestsPerMinute: 60,
      maxParallelRequests: 3,
      badge: "Popular",
      isActive: true,
      sortOrder: 20,
    },
  ];

  for (const plan of plansData) {
    await prisma.plan.upsert({
      where: { slug: plan.slug },
      update: {
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        currency: plan.currency,
        monthlyCostLimitUsd: plan.monthlyCostLimitUsd,
        weeklyCostLimitUsd: plan.weeklyCostLimitUsd,
        fiveHourCostLimitUsd: plan.fiveHourCostLimitUsd,
        dailyRequestLimit: plan.dailyRequestLimit,
        requestsPerMinute: plan.requestsPerMinute,
        badge: plan.badge,
        isActive: plan.isActive,
        sortOrder: plan.sortOrder,
      },
      create: plan,
    });
  }
  console.log(`   Seeded ${plansData.length} plans.`);

  // 2. Seed Model Providers
  console.log("-> Seeding model providers...");
  const providersData = [
    { slug: "openai", name: "OpenAI", logoKey: "openai", sortOrder: 10 },
    { slug: "anthropic", name: "Anthropic", logoKey: "claude", sortOrder: 20 },
    { slug: "google", name: "Google Gemini", logoKey: "gemini", sortOrder: 30 },
    { slug: "deepseek", name: "DeepSeek", logoKey: "deepseek", sortOrder: 40 },
    { slug: "xai", name: "xAI Grok", logoKey: "grok", sortOrder: 50 },
    { slug: "meta", name: "Meta Llama", logoKey: "meta", sortOrder: 60 },
    { slug: "mistral", name: "Mistral AI", logoKey: "mistral", sortOrder: 70 },
    { slug: "qwen", name: "Qwen (Alibaba)", logoKey: "qwen", sortOrder: 80 },
    { slug: "moonshot", name: "Moonshot Kimi", logoKey: "kimi", sortOrder: 90 },
    { slug: "zhipu", name: "Zhipu GLM", logoKey: "zhipu", sortOrder: 100 },
    { slug: "minimax", name: "MiniMax", logoKey: "minimax", sortOrder: 110 },
    { slug: "cohere", name: "Cohere", logoKey: "cohere", sortOrder: 120 },
    { slug: "perplexity", name: "Perplexity", logoKey: "perplexity", sortOrder: 130 },
    { slug: "devnuby", name: "Devnuby (custom)", logoKey: "devnuby", sortOrder: 140 },
  ];

  for (const provider of providersData) {
    await prisma.modelProvider.upsert({
      where: { slug: provider.slug },
      update: {
        name: provider.name,
        logoKey: provider.logoKey,
        sortOrder: provider.sortOrder,
      },
      create: provider,
    });
  }
  console.log(`   Seeded ${providersData.length} model providers.`);

  // 3. Seed App Settings (Zero hardcoded values in routing code)
  console.log("-> Seeding app settings...");
  const defaultSettings: Array<{ key: string; value: InputJsonValue }> = [
    { key: "routing.primary_first", value: true },
    { key: "routing.max_attempts", value: 3 },
    {
      key: "routing.retry_on_status",
      value: [408, 409, 425, 429, 500, 502, 503, 504],
    },
    { key: "routing.fallback_on_model_not_found", value: true },
    {
      key: "routing.fallback_on_errors",
      value: ["timeout", "network", "http_5xx", "rate_limited", "model_not_found", "auth"],
    },
    { key: "routing.circuit_failure_threshold", value: 5 },
    { key: "routing.circuit_cooldown_seconds", value: 60 },
    { key: "routing.cache_ttl_seconds", value: 30 },
    { key: "routing.version", value: 1 },
    { key: "catalog.default_model", value: "openai/gpt-6-luna" },
    { key: "logs.routing_retention_days", value: 90 },
    { key: "chat.max_tool_rounds", value: 20 },
    // "" = first active catalog model writes the personalized home suggestions
    { key: "chat.home_suggestions_model", value: "" },
  ];

  for (const s of defaultSettings) {
    await prisma.appSetting.upsert({
      where: { settingKey: s.key },
      update: {},
      create: {
        settingKey: s.key,
        value: s.value,
      },
    });
  }
  console.log(`   Seeded ${defaultSettings.length} app settings.`);

  // 4. Migrate Gateway from .env into DB with AES-256-GCM encryption
  console.log("-> Migrating gateway from .env to gateways table...");
  const rawBaseUrl = process.env.GATEWAY_UPSTREAM;
  const rawApiKey = process.env.GATEWAY_API_KEY;
  const rawWireApi = (process.env.WIRE_API || "chat").replace(/["']/g, "").trim();
  const rawModelsPath = (process.env.MODEL_CATALOG_PATH || "/models")
    .replace(/["']/g, "")
    .trim();

  if (rawBaseUrl && rawApiKey) {
    const cleanBaseUrl = rawBaseUrl.replace(/["']/g, "").trim();
    const cleanApiKey = rawApiKey.replace(/["']/g, "").trim();
    const apiKeyCiphertext = encryptSecret(cleanApiKey);
    const apiKeyLast4 = cleanApiKey.slice(-4);

    const gatewaySlug = "primary-upstream";
    const gatewayName = "Primary Upstream Gateway";

    const gateway = await prisma.gateway.upsert({
      where: { slug: gatewaySlug },
      update: {
        baseUrl: cleanBaseUrl,
        wireApi: rawWireApi === "responses" ? "responses" : "chat",
        modelsPath: rawModelsPath,
        apiKeyCiphertext,
        apiKeyLast4,
        isPrimary: true,
        isEnabled: true,
        priority: 100,
        timeoutMs: 120000,
        firstTokenTimeoutMs: 20000,
        healthStatus: "healthy",
      },
      create: {
        slug: gatewaySlug,
        name: gatewayName,
        baseUrl: cleanBaseUrl,
        wireApi: rawWireApi === "responses" ? "responses" : "chat",
        modelsPath: rawModelsPath,
        apiKeyCiphertext,
        apiKeyLast4,
        isPrimary: true,
        isEnabled: true,
        priority: 100,
        timeoutMs: 120000,
        firstTokenTimeoutMs: 20000,
        healthStatus: "healthy",
      },
    });

    console.log(
      `   Migrated gateway "${gateway.name}" (id=${gateway.id.toString()}, slug=${gateway.slug}) with isPrimary=true and encrypted API key (••••${apiKeyLast4}).`
    );

    // Clean .env: remove plain-text gateway secrets
    const envPath = path.join(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf8");
      const lines = envContent.split(/\r?\n/);
      const filteredLines = lines.filter((line) => {
        const trimmed = line.trim();
        return (
          !trimmed.startsWith("GATEWAY_UPSTREAM=") &&
          !trimmed.startsWith("WIRE_API=") &&
          !trimmed.startsWith("GATEWAY_API_KEY=") &&
          !trimmed.startsWith("MODEL_CATALOG_PATH=")
        );
      });
      fs.writeFileSync(envPath, filteredLines.join("\n"), "utf8");
      console.log("   Removed GATEWAY_UPSTREAM, GATEWAY_API_KEY, WIRE_API, and MODEL_CATALOG_PATH from .env.");
    }
  } else {
    console.log("   No GATEWAY_UPSTREAM/GATEWAY_API_KEY found in .env; skipping gateway migration.");
  }

  // 5. Seed Initial Catalog Models and Upstream Routes (if gateway exists)
  console.log("-> Seeding catalog models and routes...");
  const primaryGateway = await prisma.gateway.findFirst({
    where: { isEnabled: true },
    orderBy: [{ isPrimary: "desc" }, { priority: "asc" }],
  });

  if (primaryGateway) {
    const googleProvider = await prisma.modelProvider.findUnique({
      where: { slug: "google" },
    });

    if (googleProvider) {
      const upstreamModel = await prisma.upstreamModel.upsert({
        where: {
          gatewayId_modelKey: {
            gatewayId: primaryGateway.id,
            modelKey: "gemini-3.8-flash",
          },
        },
        update: {
          ownedBy: "google",
          isAvailable: true,
          lastSeenAt: new Date(),
        },
        create: {
          gatewayId: primaryGateway.id,
          modelKey: "gemini-3.8-flash",
          ownedBy: "google",
          isAvailable: true,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
      });

      const catalogModel = await prisma.catalogModel.upsert({
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

      await prisma.catalogModelRoute.upsert({
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
        `   Seeded catalog model "${catalogModel.publicId}" routed to upstream "${upstreamModel.modelKey}" via gateway "${primaryGateway.name}".`
      );
    }
  } else {
    console.log("   No active gateway found; skipped catalog model route seeding.");
  }

  console.log("✅ Seeding completed successfully!");
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
