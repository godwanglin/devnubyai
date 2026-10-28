import "dotenv/config";
import { db } from "../src/lib/db";
import { decryptSecret, encryptSecret } from "../src/lib/crypto/vault";

async function main() {
  const [plans, providers, settings, gateways] = await Promise.all([
    db.plan.count(),
    db.modelProvider.count(),
    db.appSetting.findMany({ orderBy: { settingKey: "asc" } }),
    db.gateway.findMany({
      select: {
        id: true,
        slug: true,
        baseUrl: true,
        wireApi: true,
        modelsPath: true,
        isPrimary: true,
        primaryMarker: true,
        isEnabled: true,
        apiKeyLast4: true,
        apiKeyCiphertext: true,
      },
    }),
  ]);

  console.log("PLANS:", plans, "PROVIDERS:", providers);
  console.log("SETTINGS:", settings.map((s) => `${s.settingKey}=${JSON.stringify(s.value)}`));

  for (const g of gateways) {
    const key = decryptSecret(g.apiKeyCiphertext);
    console.log("GATEWAY:", {
      id: g.id.toString(),
      slug: g.slug,
      host: new URL(g.baseUrl).host.replace(/^[^.]+/, "***"),
      wireApi: g.wireApi,
      modelsPath: g.modelsPath,
      isPrimary: g.isPrimary,
      primaryMarker: g.primaryMarker,
      isEnabled: g.isEnabled,
      ciphertextBytes: g.apiKeyCiphertext.length,
      decryptOk: key.slice(-4) === g.apiKeyLast4,
    });
  }

  // A second primary gateway must be rejected by uq_gateways_single_primary.
  try {
    await db.gateway.create({
      data: {
        slug: "__verify_second_primary",
        name: "verify",
        baseUrl: "https://example.invalid/v1",
        apiKeyCiphertext: encryptSecret("x"),
        isPrimary: true,
      },
    });
    await db.gateway.delete({ where: { slug: "__verify_second_primary" } });
    console.log("SINGLE_PRIMARY_CONSTRAINT: FAILED (second primary was accepted)");
    process.exitCode = 1;
  } catch (err) {
    console.log("SINGLE_PRIMARY_CONSTRAINT: OK (rejected:", (err as { code?: string }).code ?? "error", ")");
  }
}

main()
  .catch((err) => {
    console.error("VERIFY_FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
