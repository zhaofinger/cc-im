import { describe, expect, test } from "bun:test";
import {
  buildNoSessionsMessage,
  buildResumeMenuMessage,
  buildSessionResumedMessage,
  buildSessionStartedMessage,
} from "../session-messages.ts";

function textOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && "text" in value) {
    const text = value.text;
    return typeof text === "string" ? text : "";
  }
  return "";
}

describe("session-messages", () => {
  test("buildSessionStartedMessage should render workspace", () => {
    expect(textOf(buildSessionStartedMessage("test_workspace"))).toContain(
      "Started a new Claude session",
    );
    expect(textOf(buildSessionStartedMessage("test_workspace"))).toContain("test_workspace");
  });

  test("buildNoSessionsMessage should render workspace", () => {
    expect(textOf(buildNoSessionsMessage("test_workspace"))).toContain("No sessions found");
    expect(textOf(buildNoSessionsMessage("test_workspace"))).toContain("test_workspace");
  });

  test("buildResumeMenuMessage should render page range", () => {
    expect(
      textOf(
        buildResumeMenuMessage({
          workspaceName: "test_workspace",
          start: 1,
          end: 8,
          total: 20,
        }),
      ),
    ).toContain("Resume Session");
    expect(
      textOf(
        buildResumeMenuMessage({
          workspaceName: "test_workspace",
          start: 1,
          end: 8,
          total: 20,
        }),
      ),
    ).toContain("(1-8 of 20)");
  });

  test("buildSessionResumedMessage should render session id as text", () => {
    const message = textOf(buildSessionResumedMessage("test_workspace", "session-123"));
    expect(message).toContain("Session Resumed");
    expect(message).toContain("test_workspace");
    expect(message).toContain("session-123");
    expect(message).not.toContain("<code>");
  });
});
