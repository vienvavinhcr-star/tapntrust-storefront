import { describe, expect, it } from "vitest";
import { enhanceAdminCrmLabelsPage } from "../src/admin-crm-labels";

describe("owner CRM status highlights and filters", () => {
  it("tints every cell for Test, Active and Cancel, including paid subscription rows", () => {
    const page = enhanceAdminCrmLabelsPage("<html><head></head><body></body></html>");
    expect(page).toContain('tr[data-crm-label="test"] > td{background:#f8f5ff}');
    expect(page).toContain('tr[data-crm-label="active"] > td{background:#f1faf5}');
    expect(page).toContain('tr[data-crm-label="cancel"] > td{background:#fff4f3}');
    expect(page).toContain('tr[hidden]{display:none!important}');
    expect(page).toContain("row.dataset.crmLabel=entry.status");
  });

  it("supports independent source and status dropdowns combined with existing search and refresh", () => {
    const page = enhanceAdminCrmLabelsPage("<html><head></head><body></body></html>");
    expect(page).toContain("data-crm-filter-source");
    expect(page).toContain("data-crm-filter-status");
    for (const source of ["shop", "ctv", "manual", "unknown"]) {
      expect(page).toContain(`<option value="${source}">`);
    }
    for (const status of ["active", "cancel", "test", "unlabelled"]) {
      expect(page).toContain(`<option value="${status}">`);
    }
    expect(page).toContain("row.dataset.crmSource===source");
    expect(page).toContain("row.dataset.crmLabel===status");
    expect(page).toContain("[data-crm-refresh],[data-crm-period]");
    expect(page).toContain("applyFilters();");
  });

  it("retains the existing admin script count and generates valid JavaScript", () => {
    const original = '<html><head></head><body><script>window.first=true;</script><script>window.second=true;</script></body></html>';
    const page = enhanceAdminCrmLabelsPage(original);
    const scripts = Array.from(page.matchAll(/<script>([\s\S]*?)<\/script>/g), match => match[1] ?? "");
    expect(scripts).toHaveLength(2);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });
});
