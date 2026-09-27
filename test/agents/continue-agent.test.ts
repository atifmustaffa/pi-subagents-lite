import { beforeEach, describe, expect, it, vi } from "vitest";
import { shellMock } from "../fixtures.js";
import { asExtensionContext } from "../pi-boundaries.js";

const { mockGetRecord, mockSteer } = vi.hoisted(() => ({
  mockGetRecord: vi.fn(),
  mockSteer: vi.fn(),
}));

vi.mock("../../src/shell.js", () =>
  shellMock({
    manager: {
      getRecord: mockGetRecord,
      steer: mockSteer,
    },
  }),
);

import { executeContinueAgentTool } from "../../src/agents/tool-execution.js";

function settledRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "abc123def456ghi",
    lifecycle: { status: "completed" },
    execution: { settled: true, session: { isStreaming: false } },
    ...overrides,
  };
}

describe("executeContinueAgentTool", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    [{ prompt: "continue" }, "agent_id is required"],
    [{ agent_id: "abc123def456ghi" }, "prompt is required"],
  ])("validates required parameters", async (params, message) => {
    await expect(
      executeContinueAgentTool("call_1", params, undefined, undefined, asExtensionContext({})),
    ).rejects.toThrow(message);
    expect(mockSteer).not.toHaveBeenCalled();
  });

  it("returns a clear error when the agent does not exist", async () => {
    mockGetRecord.mockReturnValue(undefined);

    await expect(
      executeContinueAgentTool(
        "call_2",
        { agent_id: "missing", prompt: "continue" },
        undefined,
        undefined,
        asExtensionContext({}),
      ),
    ).rejects.toThrow("Agent missing not found");
    expect(mockSteer).not.toHaveBeenCalled();
  });

  it("continues the same settled agent through manager.steer", async () => {
    const record = settledRecord();
    mockGetRecord.mockReturnValue(record);
    mockSteer.mockImplementation(async () => {
      record.lifecycle.status = "running";
      return true;
    });

    const result = await executeContinueAgentTool(
      "call_3",
      { agent_id: record.id, prompt: "delete hello.txt" },
      undefined,
      undefined,
      asExtensionContext({}),
    );

    expect(mockSteer).toHaveBeenCalledWith(record.id, "delete hello.txt");
    expect(result.content[0].text).toBe("Continued agent abc123de");
    expect(result.details).toEqual({ agentId: record.id, status: "running" });
  });

  it("does not steer an agent that is still running", async () => {
    mockGetRecord.mockReturnValue(settledRecord({ lifecycle: { status: "running" } }));

    await expect(
      executeContinueAgentTool(
        "call_4",
        { agent_id: "abc123def456ghi", prompt: "continue" },
        undefined,
        undefined,
        asExtensionContext({}),
      ),
    ).rejects.toThrow("cannot be continued while running");
    expect(mockSteer).not.toHaveBeenCalled();
  });

  it("reports when the existing continuation path rejects the request", async () => {
    mockGetRecord.mockReturnValue(settledRecord());
    mockSteer.mockResolvedValue(false);

    await expect(
      executeContinueAgentTool(
        "call_5",
        { agent_id: "abc123def456ghi", prompt: "continue" },
        undefined,
        undefined,
        asExtensionContext({}),
      ),
    ).rejects.toThrow("model concurrency limit is full");
    expect(mockSteer).toHaveBeenCalledOnce();
  });
});
