/**
 * Resolves the underlying provider deep-link from a Tripay hosted checkout page.
 * Tripay renders the direct wallet URL inside the `#continue-pay` button:
 * `<button id="continue-pay" onclick="window.open('https://m.dana.id/link/pay?...', '_self')">`
 * or for ShopeePay:
 * `<button id="continue-pay" onclick="window.open('https://app.shopeepay.co.id/u/pay_checkout?...', '_self')">`
 *
 * NOTE: Tripay only renders deep-links when requested with an Android/Mobile User-Agent!
 * If requested with a desktop UA, Tripay serves a toast saying "buka halaman ini melalui perangkat mobile".
 *
 * If the page cannot be scraped or does not match, returns null so the caller
 * cleanly falls back to Tripay's original checkout_url.
 */

const SCRAPE_TIMEOUT_MS = 4000;

// Mobile Android UA ensures Tripay outputs direct app/web deep-links (DANA, ShopeePay, OVO, etc.)
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36";

function unescapeHtml(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function resolveDirectWalletUrl(
  checkoutUrl: string | null | undefined
): Promise<string | null> {
  if (!checkoutUrl || !checkoutUrl.startsWith("https://tripay.co.id/checkout/")) {
    return null;
  }

  try {
    const res = await fetch(checkoutUrl, {
      method: "GET",
      headers: {
        "User-Agent": MOBILE_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    });

    if (!res.ok) return null;
    const html = await res.text();

    // 1. DANA deep-link pattern
    const danaMatch = html.match(
      /id=["']continue-pay["'][^>]*onclick=["'][^"']*window\.open\(\s*['"](https:\/\/m\.dana\.id\/[^'"]+)['"]/i
    ) || html.match(/window\.open\(\s*['"](https:\/\/m\.dana\.id\/[^'"]+)['"]/i);

    if (danaMatch && danaMatch[1]) {
      const cleaned = unescapeHtml(danaMatch[1].trim());
      if (cleaned.includes("bizNo=") || cleaned.includes("trackId=")) {
        return cleaned;
      }
    }

    // 2. ShopeePay deep-link pattern: https://app.shopeepay.co.id/u/pay_checkout?...
    const shopeeMatch = html.match(
      /id=["']continue-pay["'][^>]*onclick=["'][^"']*window\.open\(\s*['"](https:\/\/app\.shopeepay\.co\.id\/[^'"]+)['"]/i
    ) || html.match(/window\.open\(\s*['"](https:\/\/app\.shopeepay\.co\.id\/[^'"]+)['"]/i);

    if (shopeeMatch && shopeeMatch[1]) {
      const cleaned = unescapeHtml(shopeeMatch[1].trim());
      if (cleaned.includes("order_key=") || cleaned.includes("token=") || cleaned.includes("mid=")) {
        return cleaned;
      }
    }

    // 3. Generic continue-pay button pattern for other e-wallets
    const genericButtonMatch = html.match(
      /id=["']continue-pay["'][^>]*onclick=["'][^"']*window\.open\(\s*['"](https:\/\/[^'"]+)['"]/i
    );
    if (genericButtonMatch && genericButtonMatch[1]) {
      const cleaned = unescapeHtml(genericButtonMatch[1].trim());
      if (!cleaned.includes("tripay.co.id")) {
        return cleaned;
      }
    }

    // 4. Form action fallback: <form action="https://..." method="post/get">
    const formMatch = html.match(
      /<form[^>]*action=["'](https:\/\/[^'"]+)["'][^>]*id=["'](?:payment-form|form-pay)["']/i
    );
    if (formMatch && formMatch[1]) {
      const cleaned = unescapeHtml(formMatch[1].trim());
      if (!cleaned.includes("tripay.co.id")) {
        return cleaned;
      }
    }

    return null;
  } catch (err) {
    console.warn(`[Tripay Direct Scraper] Failed to resolve direct URL from ${checkoutUrl}:`, err);
    return null;
  }
}
