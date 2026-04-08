import { describe, expect, test } from "bun:test";
import {
  buildStartupNotification,
  MESSAGE_REACTION_EMOJIS,
  pickMessageReactionEmoji,
} from "../presence.ts";

describe("telegram presence helpers", () => {
  test("picks reactions from the configured emoji list", () => {
    const seen = new Set<string>();

    for (let i = 0; i < 200; i += 1) {
      seen.add(pickMessageReactionEmoji());
    }

    for (const emoji of seen) {
      expect(MESSAGE_REACTION_EMOJIS).toContain(emoji as (typeof MESSAGE_REACTION_EMOJIS)[number]);
    }
    expect(MESSAGE_REACTION_EMOJIS).toHaveLength(8);
  });

  test("builds startup notification card", () => {
    const text = buildStartupNotification({
      provider: "claude",
      username: "cc_im_bot",
      workspaceRoot: "/code_workspace",
    });

    expect(text).toContain("<b>✅ CC-IM Started</b>");
    expect(text).toContain("<i>@cc_im_bot</i>");
    expect(text).toContain("<i>provider claude</i>");
    expect(text).toContain("<b>Workspace Root</b>");
    expect(text).toContain("<blockquote>/code_workspace</blockquote>");
  });
});
