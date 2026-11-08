// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { useNavigate } from "../lib/router";
import { useAgentDetailRouteSync } from "./useAgentDetailRouteSync";

const companies = [{ id: "company-1", issuePrefix: "CMP" }, { id: "company-2", issuePrefix: "CMPAA" }];
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: { issuePrefix: "CMP" } }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each(["runtime", "runs/run-1"])("repairs a conflicting company prefix before selecting the agent company (%s)", async (suffix) => {
  const locations: string[] = [];
  const setSelectedCompanyId = vi.fn(() => {
    expect(locations.at(-1)).toBe(`/CMPAA/agents/canonical-agent/${suffix}`);
  });
  function Detail() {
    const { companyPrefix, agentId, tab, runId } = useParams();
    const location = useLocation();
    locations.push(location.pathname);
    useAgentDetailRouteSync({
      agentCompanyId: "company-2", companies,
      routeCompanyId: companies.find((company) => company.issuePrefix === companyPrefix)?.id ?? null,
      selectedCompanyId: "company-1", setSelectedCompanyId,
      routeAgentRef: agentId!, canonicalAgentRef: "canonical-agent", urlRunId: runId, urlTab: tab,
      activeView: runId ? "run-detail" : "runtime", legacyAuditSection: null, navigate: useNavigate(),
    });
    return null;
  }
  const element = document.createElement("div");
  const root = createRoot(element);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={[`/CMP/agents/agent-id/${suffix}`]}>
      <Routes>
        <Route path="/:companyPrefix/agents/:agentId/:tab" element={<Detail />} />
        <Route path="/:companyPrefix/agents/:agentId/runs/:runId" element={<Detail />} />
      </Routes>
    </MemoryRouter>));
    expect(locations).toEqual([`/CMP/agents/agent-id/${suffix}`, `/CMPAA/agents/canonical-agent/${suffix}`]);
    // Selection may sync once, only after the URL has reached the owning company.
    expect(setSelectedCompanyId).toHaveBeenCalledExactlyOnceWith("company-2", { source: "route_sync" });
  } finally {
    await act(async () => root.unmount());
  }
});
