export function initialiseMetadata(config) {
  const value = String(config.SITE_URL || "").trim().replace(/\/$/, "");
  let siteUrl = "";
  try {
    siteUrl = new URL(value).protocol === "https:" ? value : "";
  } catch {
    siteUrl = "";
  }

  if (siteUrl) {
    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = `${siteUrl}/`;
    document.head.append(canonical);
    const ogUrl = document.createElement("meta");
    ogUrl.setAttribute("property", "og:url");
    ogUrl.content = `${siteUrl}/`;
    document.head.append(ogUrl);
  }

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "Tapntrust",
        ...(siteUrl ? { url: `${siteUrl}/`, logo: `${siteUrl}/assets/brand/tapntrust-logo.png` } : {})
      },
      {
        "@type": "Product",
        name: "Tapntrust NFC Review Card",
        description: "A 12 × 12 cm NFC review card programmed for the business location selected by the customer.",
        brand: { "@type": "Brand", name: "Tapntrust" },
        ...(siteUrl ? { image: `${siteUrl}/assets/products/tapntrust-nfc-card-transparent.webp` } : {}),
        offers: [
          { "@type": "Offer", name: "1 Card", price: "39.95", priceCurrency: "AUD", availability: "https://schema.org/InStock" },
          { "@type": "Offer", name: "2 Cards", price: "59.95", priceCurrency: "AUD", availability: "https://schema.org/InStock" },
          { "@type": "Offer", name: "3 Cards", price: "74.95", priceCurrency: "AUD", availability: "https://schema.org/InStock" },
          { "@type": "Offer", name: "5 Cards", price: "109.95", priceCurrency: "AUD", availability: "https://schema.org/InStock" }
        ]
      }
    ]
  };
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(structuredData);
  document.head.append(script);
}
