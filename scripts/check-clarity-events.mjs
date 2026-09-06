#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("js/clarity-events.js", "utf8").replace(/export function /g, "function ");
const app = fs.readFileSync("js/app.js", "utf8");
const drawer = fs.readFileSync("js/ui/cart-drawer.js", "utf8");
const welcome = fs.readFileSync("js/marketing/welcome-offer.js", "utf8");
const shopify = { mode: "shopify" };

function harness({ search = "", storedTest = false, blockedStorage = false, delayed = false } = {}) {
  const calls = [];
  const listeners = {};
  const data = new Map(storedTest ? [["tapntrust_test_mode", "1"]] : []);
  const session = new Map();
  const storage = (map) => ({
    getItem(key) { if (blockedStorage) throw Error("blocked"); return map.get(key); },
    setItem(key, value) { if (blockedStorage) throw Error("blocked"); map.set(key, value); },
    removeItem(key) { if (blockedStorage) throw Error("blocked"); map.delete(key); }
  });
  class Element {
    constructor(attributes = {}) { this.attributes = attributes; }
    closest(selector) { return selector === "[data-checkout]" ? this : null; }
    getAttribute(key) { return this.attributes[key]; }
  }
  const window = {
    location: { search }, localStorage: storage(data), sessionStorage: storage(session),
    ...(delayed ? {} : { clarity: (...args) => calls.push(args) })
  };
  const document = {
    documentElement: { dataset: {} },
    querySelector: () => null,
    addEventListener: (name, callback) => { (listeners[name] ||= []).push(callback); }
  };
  const context = vm.createContext({ window, document, URLSearchParams, Element });
  vm.runInContext(source, context);
  return {
    context, window, document, calls,
    events: () => calls.filter(([command]) => command === "event").map(([, name]) => name),
    click(attributes, disabled = false) {
      const target = new Element(attributes);
      target.disabled = disabled;
      for (const callback of listeners.click || []) callback({ target });
    }
  };
}

const normal = harness();
for (const count of [1, 2, 3, 5, 5]) normal.context.trackClarityPackageAdded(count, shopify);
normal.context.trackClarityPackageAdded(4, shopify);
normal.context.trackClarityPackageAdded(1, { mode: "preview" });
normal.context.trackClarityUpsellAdded("extra", shopify);
normal.context.trackClarityUpsellAdded("stand", shopify);
normal.context.trackClarityUpsellAdded("gift", shopify);
normal.context.trackClarityWelcomeClaimed(shopify);
normal.context.trackClarityWelcomeClaimed(shopify);
assert.deepEqual(normal.events(), ["add_to_cart", "add_to_cart_1_card", "add_to_cart_2_cards", "add_to_cart_3_cards", "add_to_cart_5_cards", "extra_card_added", "counter_stand_added", "welcome_offer_claimed"]);
assert(normal.calls.every((call) => call.length === 2), "Only event names may be sent; no email or cart metadata.");
for (const href of ["", "#", "   "]) normal.click({ href });
normal.click({ href: "https://checkout.example/", "aria-disabled": "true" });
normal.click({ href: "https://checkout.example/" }, true);
assert(!normal.events().includes("begin_checkout"));
normal.click({ href: "https://checkout.example/", "aria-disabled": "false" });
normal.click({ href: "https://checkout.example/" });
assert.equal(normal.events().filter((event) => event === "begin_checkout").length, 1);

for (const options of [{ search: "?test=1" }, { storedTest: true }, { search: "?test=1", blockedStorage: true }]) {
  const test = harness(options);
  test.context.trackClarityPackageAdded(5, shopify);
  test.context.trackClarityUpsellAdded("stand", shopify);
  test.context.trackClarityWelcomeClaimed(shopify);
  test.click({ href: "https://checkout.example/" });
  assert.deepEqual(test.events(), [], "Owner test mode must suppress every event.");
}
const enabled = harness({ storedTest: true, search: "?test=0" });
enabled.context.trackClarityPackageAdded(1, shopify);
assert.equal(enabled.events().length, 2);
enabled.window.TAPNTRUST_TEST_MODE = true;
enabled.context.trackClarityUpsellAdded("extra", shopify);
assert.equal(enabled.events().length, 2);

const early = harness({ delayed: true, blockedStorage: true });
early.context.trackClarityPackageAdded(2, shopify);
early.context.trackClarityPackageAdded(2, shopify);
assert.equal(early.window.clarity.q.length, 2, "Early actions queue once even without sessionStorage.");
const throwing = harness();
throwing.window.clarity = () => { throw Error("SDK unavailable"); };
assert.doesNotThrow(() => throwing.context.trackClarityUpsellAdded("extra", shopify));
const preview = harness();
preview.context.trackClarityPackageAdded(2, { mode: "preview" });
preview.context.trackClarityUpsellAdded("stand", { mode: "preview" });
preview.context.trackClarityWelcomeClaimed({ mode: "preview" });
assert.deepEqual(preview.events(), []);

// Execute the actual UI callbacks with isolated cart/form doubles: no network,
// Clarity SDK, email submission or real Shopify mutations are used by this test.
const submitBody = app.match(/form\.addEventListener\("submit", async \(event\) => \{([\s\S]*?)\n  \}\);/)?.[1];
assert(submitBody, "Primary submit callback must be found.");
async function submitPackage({ fails = false, editing = false } = {}) {
  const test = harness();
  const button = { innerHTML: "Add", dataset: {} };
  Object.assign(test.context, {
    event: { preventDefault() {} }, form: { querySelector: () => button },
    validateProductForm: () => ({}), selectedPackage: 5, editingBusinessLineId: editing ? "line" : null,
    cartActions: {
      async addMainPackage({ packageCount }) {
        assert.equal(packageCount, 5);
        test.context.selectedPackage = 1; // Selection changes during the request.
        if (fails) throw Error("Bundle gift validation failed");
        return shopify;
      },
      async updateBusinessForLine() {}
    },
    trackMetaEvent() {}, packageMetaParameters() {}, cartUi: null, toast() {}, updatePackageSelection() {}
  });
  await vm.runInContext(`(async () => {${submitBody}\n})()`, test.context);
  return test.events();
}
assert.deepEqual(await submitPackage(), ["add_to_cart", "add_to_cart_5_cards"]);
assert.deepEqual(await submitPackage({ fails: true }), []);
assert.deepEqual(await submitPackage({ editing: true }), []);

const upsellBody = drawer.match(/document\.querySelector\("\[data-cart-upsells\]"\)\?\.addEventListener\("click", async \(event\) => \{([\s\S]*?)\n    \}\);/)?.[1];
assert(upsellBody, "Manual upsell callback must be found.");
for (const kind of ["stand", "extra"]) {
  for (const fails of [false, true]) {
    const test = harness();
    const button = { dataset: { upsellAdd: kind }, textContent: "Add" };
    Object.assign(test.context, {
      event: { target: { closest: () => button } },
      cartActions: { async addUpsell() { if (fails) throw Error("Unavailable"); return shopify; } },
      trackMetaEvent() {}, upsellMetaParameters() {}, toast() {}
    });
    await vm.runInContext(`(async () => {${upsellBody}\n})()`, test.context);
    assert.deepEqual(test.events(), fails ? [] : [kind === "stand" ? "counter_stand_added" : "extra_card_added"]);
  }
}

const claimBody = welcome.match(/form\?\.addEventListener\("submit", \(event\) => \{([\s\S]*?)\n  \}\);/)?.[1];
assert(claimBody, "Welcome claim callback must be found.");
for (const [email, company, expected] of [["bad", "", []], ["alex@example.com", "bot", []], ["alex@example.com", "", ["welcome_offer_claimed"]]]) {
  const test = harness();
  Object.assign(test.context, {
    event: { preventDefault() {} }, form: {}, FormData: class { get() { return company; } },
    emailInput: { value: email, setAttribute() {}, removeAttribute() {}, focus() {} },
    cleanEmail: (value) => value.trim(), EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    formStatus: {}, formPanel: {}, successPanel: {}, latestCartState: shopify,
    nowIso: () => "2026-09-06T00:00:00Z", setLocal() {}, removeLocal() {}, STORAGE: {},
    root: { querySelector: () => null }, renderCartOffer() {}, postEvent() {}, payloadBase: () => ({}),
    endpoint: "", discountCode: "WELCOMETNT", discountPercent: 10, applyDiscount() {}
  });
  vm.runInContext(`(() => {${claimBody}\n})()`, test.context);
  assert.deepEqual(test.events(), expected);
}

console.log("Clarity funnel checks passed: successful actions, package snapshot, claim validation, checkout intent, deduplication, delayed SDK and test-mode suppression.");
