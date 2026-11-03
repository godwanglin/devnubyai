/**
 * Resolves provider deep-links and handles direct push payments (e.g. OVO)
 * from Tripay hosted checkout pages.
 *
 * 1. Deep-link resolver:
 *    Tripay renders direct wallet URLs inside `#continue-pay`:
 *    - DANA: `window.open('https://m.dana.id/link/pay?...', '_self')`
 *    - ShopeePay: `window.open('https://app.shopeepay.co.id/u/pay_checkout?...', '_self')`
 *    Requires Android Mobile User-Agent to prevent Tripay desktop warning toast.
 *
 * 2. OVO Push Payment:
 *    Tripay's hosted page for OVO uses `proccessOVO()` which issues:
 *    `POST https://tripay.co.id/ovo-payment/process`
 *    FormData: `reference=<ref>&ovo_number=<phone>`
 *    Requires Laravel session cookies (`tripay_payment_session`, `XSRF-TOKEN`)
 *    and meta tag `csrf-token` from the checkout page.
 */

const SCRAPE_TIMEOUT_MS = 6000;

// Mobile Android UA ensures Tripay outputs direct app/web deep-links (DANA, ShopeePay)
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36";

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

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
    const danaMatch =
      html.match(
        /id=["']continue-pay["'][^>]*onclick=["'][^"']*window\.open\(\s*['"](https:\/\/m\.dana\.id\/[^'"]+)['"]/i
      ) || html.match(/window\.open\(\s*['"](https:\/\/m\.dana\.id\/[^'"]+)['"]/i);

    if (danaMatch && danaMatch[1]) {
      const cleaned = unescapeHtml(danaMatch[1].trim());
      if (cleaned.includes("bizNo=") || cleaned.includes("trackId=")) {
        return cleaned;
      }
    }

    // 2. ShopeePay deep-link pattern: https://app.shopeepay.co.id/u/pay_checkout?...
    const shopeeMatch =
      html.match(
        /id=["']continue-pay["'][^>]*onclick=["'][^"']*window\.open\(\s*['"](https:\/\/app\.shopeepay\.co\.id\/[^'"]+)['"]/i
      ) || html.match(/window\.open\(\s*['"](https:\/\/app\.shopeepay\.co\.id\/[^'"]+)['"]/i);

    if (shopeeMatch && shopeeMatch[1]) {
      const cleaned = unescapeHtml(shopeeMatch[1].trim());
      if (
        cleaned.includes("order_key=") ||
        cleaned.includes("token=") ||
        cleaned.includes("mid=")
      ) {
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

export interface OvoTriggerResult {
  success: boolean;
  message?: string;
}

/**
 * Triggers Tripay's internal OVO push payment so the user immediately receives
 * a payment prompt in their OVO app without needing to open the Tripay checkout page.
 */
export async function triggerOvoPayment(
  checkoutUrl: string,
  reference: string,
  phone: string
): Promise<OvoTriggerResult> {
  try {
    // 1. Fetch checkout page to extract cookies and CSRF token
    const pageRes = await fetch(checkoutUrl, {
      method: "GET",
      headers: {
        "User-Agent": DESKTOP_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    });

    if (!pageRes.ok) {
      return { success: false, message: `Failed to load Tripay checkout page (HTTP ${pageRes.status})` };
    }

    // Extract cookies from Set-Cookie headers
    // Using getSetCookie() for modern Node/undici or fallback to get("set-cookie")
    let rawCookies: string[] = [];
    if (typeof (pageRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function") {
      rawCookies = (pageRes.headers as unknown as { getSetCookie: () => string[] }).getSetCookie();
    } else {
      const single = pageRes.headers.get("set-cookie");
      if (single) rawCookies = [single];
    }

    const cookiePairs = rawCookies
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean);
    const cookieHeader = cookiePairs.join("; ");

    const html = await pageRes.text();

    // Extract CSRF token from <meta name="csrf-token" content="...">
    const csrfMatch = html.match(/<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i);
    const csrfToken = csrfMatch ? csrfMatch[1] : null;

    if (!csrfToken) {
      return { success: false, message: "CSRF token not found in Tripay checkout page" };
    }

    // Format phone to 08... if it starts with 62 or +62
    let ovoPhone = phone.replace(/[\s\-().+]/g, "");
    if (ovoPhone.startsWith("62")) ovoPhone = `0${ovoPhone.slice(2)}`;

    // 2. POST to Tripay internal OVO process endpoint
    const formParams = new URLSearchParams();
    formParams.set("reference", reference);
    formParams.set("ovo_number", ovoPhone);

    const postRes = await fetch("https://tripay.co.id/ovo-payment/process", {
      method: "POST",
      headers: {
        "User-Agent": DESKTOP_USER_AGENT,
        "X-CSRF-TOKEN": csrfToken,
        "X-Requested-With": "XMLHttpRequest",
        Referer: checkoutUrl,
        Cookie: cookieHeader,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
      },
      body: formParams.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    });

    const postJson = await postRes.json().catch(() => null) as { success?: boolean; message?: string } | null;

    if (postRes.ok && postJson?.success) {
      return { success: true };
    }

    return {
      success: false,
      message: postJson?.message || `Tripay OVO process returned HTTP ${postRes.status}`,
    };
  } catch (err) {
    console.warn(`[Tripay OVO Trigger] Failed for ref ${reference}:`, err);
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to process OVO payment",
    };
  }
}
