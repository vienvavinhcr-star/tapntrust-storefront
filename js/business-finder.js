const AUSTRALIA_BIAS = Object.freeze({
  north: -9,
  south: -44,
  east: 154,
  west: 112
});

let googleLoaderPromise;

function textValue(value) {
  if (!value) return "";
  return typeof value === "string" ? value : value.toString();
}

export function placeToBusinessDetails(place = {}) {
  const links = place.googleMapsLinks || {};
  return {
    businessName: textValue(place.displayName).trim(),
    businessAddress: textValue(place.formattedAddress || place.shortFormattedAddress).trim(),
    googlePlaceId: textValue(place.id).trim(),
    reviewUrl: textValue(links.writeAReviewURI).trim(),
    googleMapsUrl: textValue(place.googleMapsURI || links.placeURI).trim(),
    category: textValue(place.primaryTypeDisplayName).trim(),
    reviewLinkStatus: "Ready",
    reviewLinkSource: "Google Places"
  };
}

export function predictionToViewModel(prediction = {}) {
  return {
    id: textValue(prediction.placeId || prediction.place).trim(),
    name: textValue(prediction.mainText || prediction.text).trim(),
    address: textValue(prediction.secondaryText).trim()
  };
}

export function loadGooglePlaces(apiKey) {
  if (globalThis.google?.maps?.importLibrary) return Promise.resolve(globalThis.google.maps);
  if (googleLoaderPromise) return googleLoaderPromise;
  if (!apiKey) return Promise.reject(new Error("Google business search is not configured."));

  googleLoaderPromise = new Promise((resolve, reject) => {
    const callbackName = `__tapntrustGoogleReady_${Date.now()}`;
    const script = document.createElement("script");
    const cleanup = () => {
      delete window[callbackName];
      script.onerror = null;
    };

    window[callbackName] = () => {
      cleanup();
      resolve(window.google.maps);
    };
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&v=weekly&libraries=places&language=en&region=AU&auth_referrer_policy=origin&callback=${callbackName}`;
    script.onerror = () => {
      cleanup();
      googleLoaderPromise = undefined;
      reject(new Error("Google business search could not be loaded."));
    };
    document.head.append(script);
  });

  return googleLoaderPromise;
}

function debounce(callback, delay) {
  let timeout;
  return (...args) => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => callback(...args), delay);
  };
}

export function initialiseBusinessFinder({ root, apiKey, onChange = () => {} }) {
  if (!root) return null;

  const searchPanel = root.querySelector("[data-business-search-panel]");
  const searchInput = root.querySelector("[data-business-search]");
  const results = root.querySelector("[data-business-results]");
  const status = root.querySelector("[data-business-search-status]");
  const selectedCard = root.querySelector("[data-selected-business]");
  const selectedName = root.querySelector("[data-selected-business-name]");
  const selectedAddress = root.querySelector("[data-selected-business-address]");
  const selectedCategory = root.querySelector("[data-selected-business-category]");
  const manualPanel = root.querySelector("[data-manual-panel]");
  const modeToggle = root.querySelector("[data-manual-toggle]");
  const changeButton = root.querySelector("[data-change-business]");
  const manualName = root.querySelector("[data-manual-business-name]");
  const manualAddress = root.querySelector("[data-manual-business-address]");
  const manualReviewUrl = root.querySelector("[data-manual-review-url]");
  const hidden = {
    businessName: root.querySelector('[name="businessName"]'),
    businessAddress: root.querySelector('[name="businessAddress"]'),
    googlePlaceId: root.querySelector('[name="googlePlaceId"]'),
    reviewUrl: root.querySelector('[name="reviewUrl"]'),
    googleMapsUrl: root.querySelector('[name="googleMapsUrl"]'),
    reviewLinkStatus: root.querySelector('[name="reviewLinkStatus"]'),
    reviewLinkSource: root.querySelector('[name="reviewLinkSource"]')
  };

  let placesLibrary;
  let sessionToken;
  let suggestions = [];
  let activeIndex = -1;
  let requestSequence = 0;

  const setStatus = (message, state = "") => {
    status.textContent = message;
    status.dataset.state = state;
  };

  const clearResults = () => {
    suggestions = [];
    activeIndex = -1;
    results.replaceChildren();
    results.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.removeAttribute("aria-activedescendant");
  };

  const setDetails = (details = {}) => {
    Object.entries(hidden).forEach(([key, input]) => { input.value = details[key] || ""; });
    onChange({ ...details, mode: root.dataset.mode });
  };

  const showSearch = () => {
    root.dataset.mode = "search";
    searchPanel.hidden = false;
    manualPanel.hidden = true;
    selectedCard.hidden = true;
    modeToggle.textContent = "Can't find your business? Enter the review link manually";
    setDetails();
    searchInput.focus();
  };

  const showManual = (message = "", details = {}) => {
    const manualStatus = manualPanel.querySelector("[data-manual-status]");
    root.dataset.mode = "manual";
    searchPanel.hidden = true;
    manualPanel.hidden = false;
    selectedCard.hidden = true;
    modeToggle.textContent = "Search for the business instead";
    clearResults();
    manualName.value = details.businessName || "";
    manualAddress.value = details.businessAddress || "";
    manualReviewUrl.value = details.reviewUrl || "";
    setDetails({
      businessName: manualName.value.trim(),
      businessAddress: manualAddress.value.trim(),
      googlePlaceId: "",
      reviewUrl: manualReviewUrl.value.trim(),
      googleMapsUrl: "",
      reviewLinkStatus: "Ready",
      reviewLinkSource: "Manual"
    });
    if (manualStatus) manualStatus.textContent = message;
    manualPanel.querySelector("input")?.focus();
  };

  const showSelected = (details = {}) => {
    root.dataset.mode = "selected";
    setDetails({ ...details, reviewLinkStatus: details.reviewLinkStatus || "Ready", reviewLinkSource: details.reviewLinkSource || "Google Places" });
    selectedName.textContent = details.businessName || "Selected business";
    selectedAddress.textContent = details.businessAddress || "Address not supplied by Google";
    selectedCategory.textContent = details.category || "Selected Google business listing";
    searchPanel.hidden = true;
    manualPanel.hidden = true;
    selectedCard.hidden = false;
    modeToggle.textContent = "Can't find your business? Enter the review link manually";
  };

  const ensurePlaces = async () => {
    if (placesLibrary) return placesLibrary;
    setStatus("Preparing business search…", "loading");
    try {
      const maps = await loadGooglePlaces(apiKey);
      placesLibrary = await maps.importLibrary("places");
      sessionToken = new placesLibrary.AutocompleteSessionToken();
      setStatus("Type at least 3 characters, then choose the exact location.");
      return placesLibrary;
    } catch (error) {
      setStatus("Business search is unavailable right now. Use manual entry instead.", "error");
      showManual("Business search is unavailable right now. Enter the business details below.");
      throw error;
    }
  };

  const ensurePlacesForSearch = async () => {
    if (placesLibrary) return placesLibrary;
    try {
      const maps = await loadGooglePlaces(apiKey);
      placesLibrary = await maps.importLibrary("places");
      sessionToken = new placesLibrary.AutocompleteSessionToken();
      return placesLibrary;
    } catch (error) {
      setStatus("Business search is unavailable right now. Use manual entry instead.", "error");
      showManual("Business search is unavailable right now. Enter the business details below.");
      throw error;
    }
  };

  const renderResults = () => {
    results.replaceChildren();
    suggestions.forEach(({ prediction, view }, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "business-result";
      option.id = `business-result-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === activeIndex));
      option.innerHTML = `<span class="business-result__pin" aria-hidden="true"></span><span class="business-result__copy"><strong></strong><small></small></span><span class="business-result__arrow" aria-hidden="true">›</span>`;
      option.querySelector("strong").textContent = view.name || "Business location";
      option.querySelector("small").textContent = view.address || "Address available after selection";
      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("click", () => selectPrediction(prediction));
      results.append(option);
    });
    const attribution = document.createElement("p");
    attribution.className = "business-results__attribution";
    attribution.textContent = "Google Maps";
    attribution.setAttribute("translate", "no");
    results.append(attribution);
    results.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  };

  const updateActiveResult = (nextIndex) => {
    if (!suggestions.length) return;
    activeIndex = (nextIndex + suggestions.length) % suggestions.length;
    results.querySelectorAll('[role="option"]').forEach((option, index) => {
      option.setAttribute("aria-selected", String(index === activeIndex));
    });
    const active = results.querySelector(`#business-result-${activeIndex}`);
    searchInput.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  };

  const selectPrediction = async (prediction) => {
    clearResults();
    searchInput.disabled = true;
    setStatus("Confirming this location…", "loading");
    try {
      const place = prediction.toPlace();
      await place.fetchFields({
        fields: ["id", "displayName", "formattedAddress", "shortFormattedAddress", "primaryTypeDisplayName", "googleMapsURI", "googleMapsLinks"]
      });
      const details = placeToBusinessDetails(place);
      if (!details.businessName || !details.googlePlaceId || !details.reviewUrl) {
        throw new Error("Google did not provide a supported direct review link for this listing.");
      }

      showSelected(details);
      setStatus("");
      sessionToken = new placesLibrary.AutocompleteSessionToken();
    } catch (error) {
      searchInput.disabled = false;
      setStatus(`${error.message} Enter the link manually instead.`, "error");
      showManual(`${error.message} Enter the business details below.`);
    }
  };

  const search = debounce(async () => {
    const input = searchInput.value.trim();
    const sequence = ++requestSequence;
    clearResults();
    if (input.length < 3) {
      setStatus(input ? "Keep typing to search." : "Type at least 3 characters, then choose the exact location.");
      return;
    }

    try {
      setStatus("Searching Google business locations…", "loading");
      const library = await ensurePlacesForSearch();
      const response = await library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken,
        language: "en-AU",
        region: "au",
        locationBias: AUSTRALIA_BIAS
      });
      if (sequence !== requestSequence) return;
      suggestions = (response.suggestions || [])
        .map((suggestion) => suggestion.placePrediction)
        .filter(Boolean)
        .slice(0, 6)
        .map((prediction) => ({ prediction, view: predictionToViewModel(prediction) }));
      if (!suggestions.length) {
        setStatus("No matching locations found. Check the spelling, add a suburb, or use manual entry.", "empty");
        return;
      }
      setStatus(`${suggestions.length} matching location${suggestions.length === 1 ? "" : "s"}. Choose the correct address.`);
      renderResults();
    } catch (error) {
      if (root.dataset.mode === "manual") return;
      setStatus("We couldn't search right now. Try again or use manual entry.", "error");
    }
  }, 280);

  searchInput.addEventListener("focus", () => ensurePlaces().catch(() => {}), { once: true });
  searchInput.addEventListener("input", search);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateActiveResult(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      updateActiveResult(activeIndex - 1);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectPrediction(suggestions[activeIndex].prediction);
    } else if (event.key === "Escape") {
      clearResults();
    }
  });
  searchInput.addEventListener("blur", () => window.setTimeout(clearResults, 160));

  modeToggle.addEventListener("click", () => {
    if (root.dataset.mode === "manual") showSearch();
    else showManual();
  });
  changeButton.addEventListener("click", () => {
    searchInput.disabled = false;
    searchInput.value = "";
    showSearch();
  });

  manualPanel.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => onChange({
      mode: "manual",
      businessName: manualName.value.trim(),
      businessAddress: manualAddress.value.trim(),
      googlePlaceId: "",
      reviewUrl: manualReviewUrl.value.trim(),
      googleMapsUrl: "",
      reviewLinkStatus: "Ready",
      reviewLinkSource: "Manual"
    }));
  });

  root.dataset.mode = "search";
  return {
    showSearch,
    showManual,
    showSelected,
    setDetails,
    restore(details = {}) {
      if ((details.reviewLinkSource || "").toLowerCase() === "manual" || !details.googlePlaceId) showManual("", details);
      else showSelected(details);
    }
  };
}
