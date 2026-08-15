import config from "./config.js";

document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = new Date().getFullYear();
});

document.querySelectorAll("[data-brand-logo]").forEach((logo) => {
  const markMissing = () => logo.classList.add("is-missing");
  logo.addEventListener("error", markMissing, { once: true });
  if (logo.complete && logo.naturalWidth === 0) markMissing();
});

const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-primary-nav]");
navToggle?.addEventListener("click", () => {
  const open = navToggle.getAttribute("aria-expanded") === "true";
  navToggle.setAttribute("aria-expanded", String(!open));
  navToggle.setAttribute("aria-label", open ? "Open navigation" : "Close navigation");
  nav?.classList.toggle("is-open", !open);
});

const siteUrl = String(config.SITE_URL || "").trim().replace(/\/$/, "");
if (siteUrl) {
  try {
    const parsed = new URL(siteUrl);
    if (parsed.protocol === "https:") {
      const canonical = document.createElement("link");
      canonical.rel = "canonical";
      canonical.href = `${siteUrl}${location.pathname.replace(/\/index\.html$/, "/")}`;
      document.head.append(canonical);
    }
  } catch { /* Invalid public config is ignored. */ }
}

document.querySelectorAll("[data-support-email]").forEach((element) => {
  if (!config.SUPPORT_EMAIL) return;
  element.textContent = config.SUPPORT_EMAIL;
  if (element.tagName === "A") element.href = `mailto:${config.SUPPORT_EMAIL}`;
});

document.querySelector("[data-contact-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector("[data-contact-status]");
  if (!config.SUPPORT_EMAIL) {
    status.textContent = "Email support is temporarily unavailable. Please contact TapNTrust through Facebook or Instagram instead.";
    return;
  }
  const data = new FormData(form);
  const subject = encodeURIComponent(`TapNTrust enquiry: ${data.get("subject") || "Website enquiry"}`);
  const body = encodeURIComponent(`Name: ${data.get("name")}\nPhone: ${data.get("phone") || "Not provided"}\nEmail: ${data.get("email")}\n\n${data.get("message")}`);
  location.href = `mailto:${config.SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  status.textContent = "Opening your email app…";
});
