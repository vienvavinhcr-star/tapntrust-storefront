export function initialiseConsultationForm({ config, toast }) {
  const form = document.querySelector("[data-consultation-form]");
  if (!form) return;

  const status = form.querySelector("[data-consultation-status]");
  const button = form.querySelector('button[type="submit"]');
  const endpoint = String(config.CONSULTATION_ENDPOINT || "").trim();

  const setStatus = (message, type = "") => {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-error", type === "error");
    status.classList.toggle("is-success", type === "success");
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("");

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const payload = Object.fromEntries(new FormData(form).entries());

    if (!endpoint) {
      const supportEmail = String(config.SUPPORT_EMAIL || "").trim();
      if (!supportEmail) {
        setStatus("Email support is temporarily unavailable. Please contact us through Facebook or Instagram.", "error");
        return;
      }

      const subject = `Tapntrust enquiry from ${String(payload.name || "customer").trim()}`;
      const body = [
        `Name: ${String(payload.name || "").trim()}`,
        `Phone: ${String(payload.phone || "").trim()}`,
        `Email: ${String(payload.email || "Not provided").trim() || "Not provided"}`,
        `Topic: ${String(payload.topic || "General enquiry").trim()}`,
        "",
        String(payload.message || "").trim()
      ].join("\n");

      setStatus("Opening your email app with the enquiry prepared…", "success");
      window.location.href = `mailto:${encodeURIComponent(supportEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return;
    }

    let url;
    try {
      url = new URL(endpoint, window.location.href);
      if (!["https:", "http:"].includes(url.protocol)) throw new Error("Unsupported consultation endpoint");
    } catch {
      setStatus("Online enquiries are temporarily unavailable. Please use a contact option below.", "error");
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    setStatus("Sending your request…");

    try {
      const response = await fetch(url.href, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error("Consultation request failed");
      form.reset();
      setStatus("Thanks — your request has been sent. Tapntrust will contact you soon.", "success");
      toast("Consultation request sent");
    } catch {
      setStatus("We couldn’t send your request. Please use a contact option below.", "error");
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });
}
