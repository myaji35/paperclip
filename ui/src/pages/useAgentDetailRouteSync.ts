import { useEffect } from "react";
import type { NavigateFunction } from "../lib/router";
import { agentDetailHref, type AgentDetailView } from "./agent-detail-navigation";

/** Reconcile the URL before selection so Layout and the agent cannot select competing companies. */
export function useAgentDetailRouteSync({
  agentCompanyId, companies, routeCompanyId, selectedCompanyId, setSelectedCompanyId,
  routeAgentRef, canonicalAgentRef, urlRunId, urlTab, activeView, legacyAuditSection, navigate,
}: {
  agentCompanyId?: string;
  companies: ReadonlyArray<{ id: string; issuePrefix: string }>;
  routeCompanyId: string | null;
  selectedCompanyId: string | null;
  setSelectedCompanyId: (id: string, options: { source: "route_sync" }) => void;
  routeAgentRef: string;
  canonicalAgentRef: string;
  urlRunId?: string;
  urlTab?: string;
  activeView: AgentDetailView;
  legacyAuditSection: string | null;
  navigate: NavigateFunction;
}) {
  useEffect(() => {
    if (!agentCompanyId) return;
    const canonicalTab = activeView === "run-detail" ? "overview" : activeView;
    if (routeCompanyId && routeCompanyId !== agentCompanyId) {
      const agentCompany = companies.find((company) => company.id === agentCompanyId);
      if (agentCompany) {
        const path = urlRunId
          ? `/agents/${canonicalAgentRef}/runs/${urlRunId}`
          : agentDetailHref(canonicalAgentRef, canonicalTab);
        // The router preserves absolute paths that already have a company prefix.
        navigate(`/${agentCompany.issuePrefix}${path}`, { replace: true });
        return;
      }
    }
    if (urlRunId) {
      if (routeAgentRef !== canonicalAgentRef) {
        navigate(`/agents/${canonicalAgentRef}/runs/${urlRunId}`, { replace: true });
      }
    } else if (!legacyAuditSection && (routeAgentRef !== canonicalAgentRef || urlTab !== canonicalTab)) {
      navigate(agentDetailHref(canonicalAgentRef, canonicalTab), { replace: true });
    }
    if (agentCompanyId !== selectedCompanyId) {
      setSelectedCompanyId(agentCompanyId, { source: "route_sync" });
    }
  }, [agentCompanyId, companies, routeCompanyId, selectedCompanyId, setSelectedCompanyId,
    routeAgentRef, canonicalAgentRef, urlRunId, urlTab, activeView, legacyAuditSection, navigate]);
}
