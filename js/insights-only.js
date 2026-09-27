import config from "./config.js";
import { initialiseBusinessFinder } from "./business-finder.js";

const form = document.querySelector("[data-insights-upgrade-form]");
const finderRoot = form?.querySelector("[data-business-finder]");
const status = form?.querySelector("[data-upgrade-status]");
const submit = form?.querySelector("[data-upgrade-submit]");
const formPanel = document.querySelector("[data-upgrade-form-panel]");
const sentPanel = document.querySelector("[data-upgrade-sent]");
let selectedBusiness = null;

function setStatus(message = "") {
  if (status) status.textContent = message;
}

const finder = initialiseBusinessFinder({
  root: finderRoot,
  apiKey: config.GOOGLE_MAPS_API_KEY,
  onChange(details) {
    selectedBusiness = details?.googlePlaceId ? details : null;
    setStatus();
  }
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const firstName = String(new FormData(form).get("firstName") || "").trim();
  if (!firstName) {
    setStatus("Enter your first name.");
    form.querySelector('[name="firstName"]')?.focus();
    return;
  }
  if (!selectedBusiness?.googlePlaceId) {
    setStatus("Choose the exact business from the Google results.");
    finderRoot?.querySelector("[data-business-search]")?.focus();
    return;
  }

  submit.disabled = true;
  submit.textContent = "Sending secure link…";
  setStatus();
  try {
    const response = await fetch(config.INSIGHTS_UPGRADE_REQUEST_ENDPOINT, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName,
        businessName: selectedBusiness.businessName,
        googlePlaceId: selectedBusiness.googlePlaceId
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "We couldn't request the secure link. Please try again.");
    formPanel.hidden = true;
    sentPanel.hidden = false;
    sentPanel.focus?.();
  } catch (error) {
    setStatus(error.message || "We couldn't request the secure link. Please try again.");
    submit.disabled = false;
    submit.textContent = "Send secure confirmation link →";
  }
});

document.querySelector("[data-upgrade-reset]")?.addEventListener("click", () => {
  sentPanel.hidden = true;
  formPanel.hidden = false;
  form?.reset();
  selectedBusiness = null;
  finder?.showSearch();
  submit.disabled = false;
  submit.textContent = "Send secure confirmation link →";
  setStatus();
});
