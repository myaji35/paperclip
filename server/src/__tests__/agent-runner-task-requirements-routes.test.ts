import express from "express";
import { inject } from "light-my-request";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hoistModuleGraph } from "./helpers/hoist-module-graph.js";

const routeAgentId = "11111111-1111-4111-8111-111111111111";
const failedChatRunId = "22222222-2222-4222-8222-222222222222";
const failedChatIssueId = "33333333-3333-4333-8333-333333333333";
const mockAgentService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockHeartbeatService = vi.hoisted(() => ({ getRun: vi.fn(), wakeup: vi.fn() }));
const mockIssueService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockAccessService = vi.hoisted(() => ({ decide: vi.fn() }));
const mockLogActivity = vi.hoisted(() => vi.fn());

function registerModuleMocks() {
  vi.doMock("../services/agents.js", () => ({ agentService: () => mockAgentService }));
  vi.doMock("../services/heartbeat.js", () => ({ heartbeatService: () => mockHeartbeatService }));
  vi.doMock("../services/issues.js", () => ({ issueService: () => mockIssueService }));
  vi.doMock("../services/index.js", () => ({
    agentService: () => mockAgentService,
    agentInstructionsService: () => ({}),
    accessService: () => mockAccessService,
    approvalService: () => ({}),
    builtInAgentService: () => ({ ensureCompanyDefaultAgentGrants: vi.fn() }),
    companySkillService: () => ({ listRuntimeSkillEntries: vi.fn() }),
    budgetService: () => ({}),
    heartbeatService: () => mockHeartbeatService,
    issueApprovalService: () => ({}),
    issueService: () => mockIssueService,
    logActivity: mockLogActivity,
    secretService: () => ({}),
    syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
    workspaceOperationService: () => ({}),
  }));
  vi.doMock("../adapters/index.js", () => ({
    findServerAdapter: vi.fn(), listAdapterModels: vi.fn(), detectAdapterModel: vi.fn(),
    findActiveServerAdapter: vi.fn(), requireServerAdapter: vi.fn(),
  }));
}

async function createApp(db: Record<string, unknown>) {
  const { agentRoutes } = await vi.importActual<typeof import("../routes/agents.js")>("../routes/agents.js");
  const { errorHandler } = await vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = {
      type: "board", userId: "local-board", companyIds: ["company-1"],
      source: "local_implicit", isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", agentRoutes(db as Parameters<typeof agentRoutes>[0]));
  app.use(errorHandler);
  return app;
}

describe("Paperclip Runner task requirements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.getById.mockResolvedValue({
      id: routeAgentId, companyId: "company-1", adapterType: "paperclip_runner",
    });
    mockAccessService.decide.mockResolvedValue({ allowed: true });
    mockHeartbeatService.getRun.mockResolvedValue({
      id: failedChatRunId, companyId: "company-1", agentId: routeAgentId,
      status: "failed", contextSnapshot: {},
    });
    mockHeartbeatService.wakeup.mockResolvedValue({ id: "new-run" });
    mockIssueService.getById.mockResolvedValue({
      id: failedChatIssueId, companyId: "company-1", assigneeAgentId: routeAgentId,
    });
  });

  const graph = hoistModuleGraph(registerModuleMocks, async () => createApp({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  }));

  async function post(endpoint: string, body: Record<string, unknown>) {
    // Exercise the Express middleware and routes without opening a TCP listener.
    const res = await inject(graph.value, {
      method: "POST", url: `/api/agents/${routeAgentId}/${endpoint}?companyId=company-1`,
      payload: body,
    });
    return { status: res.statusCode, body: res.json() };
  }
  const retryBody = { failedRunId: failedChatRunId, reason: "retry_failed_run" };

  it("rejects a taskless exact retry even with caller-supplied task markers", async () => {
    const res = await post("wakeup", { ...retryBody, payload: { issueId: failedChatIssueId } });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body).toMatchObject({
      error: "업무가 없는 실행은 Paperclip Runner 에서 재시도할 수 없습니다. 업무 화면에서 다시 시도하거나 업무에 메시지를 보내세요.",
      details: { code: "paperclip_runner_retry_requires_task" },
    });
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("retries a Runner run with a saved task", async () => {
    mockHeartbeatService.getRun.mockResolvedValue({
      id: failedChatRunId, companyId: "company-1", agentId: routeAgentId,
      status: "failed", contextSnapshot: { issueId: failedChatIssueId },
    });
    const res = await post("wakeup", retryBody);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(routeAgentId,
      expect.objectContaining({ payload: { issueId: failedChatIssueId } }));
  });

  it.each([{}, { issueId: failedChatIssueId }, { payload: {} },
    { payload: { issueId: " ", taskId: null, taskKey: 123 } }, { payload: [] }])(
    "rejects invoke without a usable payload task: %j", async body => {
      const res = await post("heartbeat/invoke", body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body).toMatchObject({
        error: "Paperclip Runner 에이전트는 업무 없이 실행할 수 없습니다. 업무를 배정하거나 업무에 메시지를 보내세요.",
        details: { code: "paperclip_runner_invoke_requires_task" },
      });
      expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    });

  it.each(["issueId", "taskId", "taskKey"])("allows invoke with payload.%s", async key => {
    const payload = { [key]: failedChatIssueId };
    const res = await post("heartbeat/invoke", { payload });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(routeAgentId,
      expect.objectContaining({ payload }));
  });

  it.each(["wakeup", "heartbeat/invoke"])("preserves taskless %s for another adapter", async endpoint => {
    mockAgentService.getById.mockResolvedValue({
      id: routeAgentId, companyId: "company-1", adapterType: "codex_local",
    });
    const res = await post(endpoint, endpoint === "wakeup" ? retryBody : {});
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledTimes(1);
  });
});
