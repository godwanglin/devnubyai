/**
 * Resolves the underlying provider deep-link from a Tripay hosted checkout page.
 * Tripay renders the direct wallet URL inside the `#continue-pay` button:
 * `<button id="continue-pay" onclick="window.open('https://m.dana.id/link/pay?...', '_self')">`
 *
 * If the page cannot be scraped or does not match, returns null so the caller
 * cleanly falls back to Tripay's original checkout_url.
 */

const SCRAPE_TIMEOUT_MS = 4000;

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
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    });

    if (!res.ok) return null;
    const html = await res.text();

    // 1. DANA matcher: window.open('https://m.dana.id/link/pay?bizNo=...', ...)
    const danaMatch = html.match(
      /id=["']continue-pay["'][^>]*onclick=["'][^"']*window\.open\(\s*['"](https:\/\/m\.dana\.id\/[^'"]+)['"]/i
    ) || html.match(/window\.open\(\s*['"](https:\/\/m\.dana\.id\/[^'"]+)['"]/i);

    if (danaMatch && danaMatch[1]) {
      const cleaned = unescapeHtml(danaMatch[1].trim());
      // Validate that essential DANA IPG parameters exist
      if (cleaned.includes("bizNo=") || cleaned.includes("trackId=")) {
        return cleaned;
      }
    }

    // 2. Generic continue-pay button pattern for other e-wallets (e.g. ShopeePay, OVO)
    const genericButtonMatch = html.match(
      /id=["']continue-pay["'][^>]*onclick=["'][^"']*window\.open\(\s*['"](https:\/\/[^'"]+)['"]/i
    );
    if (genericButtonMatch && genericButtonMatch[1]) {
      const cleaned = unescapeHtml(genericButtonMatch[1].trim());
      if (!cleaned.includes("tripay.co.id")) {
        return cleaned;
      }
    }

    // 3. Form action fallback: <form action="https://..." method="post/get">
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
