import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/(app)/companies/page.tsx", "utf8");
const legacyCarrierPage = readFileSync("app/(app)/carriers/page.tsx", "utf8");
const sidebar = readFileSync("components/Sidebar.tsx", "utf8");

describe("companies and carriers module", () => {
  it("manages both record types from the companies route", () => {
    expect(page).toContain('type PartnerView = "company" | "carrier"');
    expect(page).toContain('"companies"');
    expect(page).toContain('"external_carriers"');
    expect(page).toContain("Companies / Carriers");
    expect(page).toContain("External Carriers");
  });

  it("keeps old carrier links working while exposing one sidebar module", () => {
    expect(legacyCarrierPage).toContain('redirect("/companies?type=carrier")');
    expect(sidebar).toContain('{ href: "/companies", label: "Companies / Carriers" }');
    expect(sidebar).not.toContain('{ href: "/carriers"');
  });
});
