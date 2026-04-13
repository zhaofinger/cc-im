import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TelegramApi } from "../api.ts";

type MockBot = {
  api: {
    sendMessage: ReturnType<typeof mock>;
    sendMessageDraft: ReturnType<typeof mock>;
    getMe: ReturnType<typeof mock>;
    getFile: ReturnType<typeof mock>;
    editMessageText: ReturnType<typeof mock>;
    answerCallbackQuery: ReturnType<typeof mock>;
    sendPhoto: ReturnType<typeof mock>;
    sendChatAction: ReturnType<typeof mock>;
    setMessageReaction: ReturnType<typeof mock>;
    setMyCommands: ReturnType<typeof mock>;
  };
};

// Create a mock for Grammy's Bot
const createMockBot = (): MockBot => ({
  api: {
    sendMessage: mock(() => Promise.resolve({ message_id: 123 })),
    sendMessageDraft: mock(() => Promise.resolve()),
    getMe: mock(() => Promise.resolve({ id: 12345, username: "testbot" })),
    getFile: mock(() => Promise.resolve({ file_path: "photos/test.png", file_size: 42 })),
    editMessageText: mock(() => Promise.resolve()),
    answerCallbackQuery: mock(() => Promise.resolve()),
    sendPhoto: mock(() => Promise.resolve({ message_id: 456 })),
    sendChatAction: mock(() => Promise.resolve()),
    setMessageReaction: mock(() => Promise.resolve()),
    setMyCommands: mock(() => Promise.resolve()),
  },
});

describe("TelegramApi", () => {
  let api: TelegramApi;
  let mockBot: ReturnType<typeof createMockBot>;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `telegram-api-test-${Date.now()}`);
    mockBot = createMockBot();
    api = new TelegramApi("test-token");
    Object.defineProperty(api, "bot", {
      value: mockBot as unknown as TelegramApi["bot"],
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    test("should create bot instance with token", () => {
      const newApi = new TelegramApi("test-token");
      expect(newApi).toBeDefined();
      expect(newApi.bot).toBeDefined();
    });
  });

  describe("sendMessage", () => {
    test("should send message with string text", async () => {
      const result = await api.sendMessage(456, "Hello");

      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(456, "Hello", {
        entities: undefined,
        reply_markup: undefined,
        parse_mode: undefined,
      });
      expect(result).toBe(123);
    });

    test("should send message with entities", async () => {
      const textWithEntities = {
        text: "Hello",
        entities: [{ type: "bold" as const, offset: 0, length: 5 }],
      };
      await api.sendMessage(456, textWithEntities);

      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(456, "Hello", {
        entities: textWithEntities.entities,
        reply_markup: undefined,
        parse_mode: undefined,
      });
    });

    test("should include reply markup", async () => {
      const keyboard = {
        inline_keyboard: [[{ text: "Button", callback_data: "data" }]],
      } as unknown as import("grammy").InlineKeyboard;
      await api.sendMessage(456, "Hello", { reply_markup: keyboard });

      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(456, "Hello", {
        entities: undefined,
        reply_markup: keyboard,
        parse_mode: undefined,
      });
    });

    test("should include parse mode", async () => {
      await api.sendMessage(456, "Hello", { parse_mode: "HTML" });

      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(456, "Hello", {
        entities: undefined,
        reply_markup: undefined,
        parse_mode: "HTML",
      });
    });
  });

  describe("sendMessageDraft", () => {
    test("should call sendMessageDraft API", async () => {
      await api.sendMessageDraft(456, 789, "Draft text");

      expect(mockBot.api.sendMessageDraft).toHaveBeenCalledWith(456, 789, "Draft text");
    });
  });

  describe("getMe", () => {
    test("should return bot info", async () => {
      const result = await api.getMe();

      expect(mockBot.api.getMe).toHaveBeenCalled();
      expect(result).toEqual({ id: 12345, username: "testbot" });
    });

    test("should handle missing username", async () => {
      mockBot.api.getMe = mock(() => Promise.resolve({ id: 12345, username: undefined }));
      const result = await api.getMe();

      expect(result.username).toBeUndefined();
    });
  });

  describe("getFile", () => {
    test("should return file metadata", async () => {
      const result = await api.getFile("file-123");

      expect(mockBot.api.getFile).toHaveBeenCalledWith("file-123");
      expect(result).toEqual({
        file_path: "photos/test.png",
        file_size: 42,
      });
    });
  });

  describe("downloadFile", () => {
    test("should download a telegram file to disk", async () => {
      const localPath = join(testDir, "downloaded.png");
      const originalFetch = global.fetch;
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
          }),
        ),
      ) as unknown as typeof global.fetch;

      try {
        const result = await api.downloadFile("photos/test.png", localPath);

        expect(global.fetch).toHaveBeenCalledWith(
          "https://api.telegram.org/file/bottest-token/photos/test.png",
        );
        expect(result).toBe(localPath);
        expect(await Bun.file(localPath).bytes()).toEqual(new Uint8Array([1, 2, 3]));
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe("editMessageText", () => {
    test("should edit message text", async () => {
      await api.editMessageText(456, 789, "New text");

      expect(mockBot.api.editMessageText).toHaveBeenCalledWith(456, 789, "New text", {
        entities: undefined,
        reply_markup: undefined,
        parse_mode: undefined,
      });
    });

    test("should include options", async () => {
      const keyboard = { inline_keyboard: [] } as unknown as import("grammy").InlineKeyboard;
      await api.editMessageText(456, 789, "New text", { reply_markup: keyboard });

      expect(mockBot.api.editMessageText).toHaveBeenCalledWith(456, 789, "New text", {
        entities: undefined,
        reply_markup: keyboard,
        parse_mode: undefined,
      });
    });

    test("should ignore 'message is not modified' error", async () => {
      mockBot.api.editMessageText = mock(() =>
        Promise.reject(new Error("message is not modified: 123")),
      );

      await expect(api.editMessageText(456, 789, "Same text")).resolves.toBeUndefined();
    });

    test("should throw other errors", async () => {
      mockBot.api.editMessageText = mock(() => Promise.reject(new Error("some other error")));

      await expect(api.editMessageText(456, 789, "Text")).rejects.toThrow("some other error");
    });
  });

  describe("answerCallbackQuery", () => {
    test("should answer callback without text", async () => {
      await api.answerCallbackQuery("callback-id");

      expect(mockBot.api.answerCallbackQuery).toHaveBeenCalledWith("callback-id", {
        text: undefined,
      });
    });

    test("should answer callback with text", async () => {
      await api.answerCallbackQuery("callback-id", "Answer text");

      expect(mockBot.api.answerCallbackQuery).toHaveBeenCalledWith("callback-id", {
        text: "Answer text",
      });
    });
  });

  describe("sendTyping", () => {
    test("should send typing action", async () => {
      await api.sendTyping(456);

      expect(mockBot.api.sendChatAction).toHaveBeenCalledWith(456, "typing");
    });
  });

  describe("sendPhoto", () => {
    test("should send a photo from a local path", async () => {
      const result = await api.sendPhoto(456, "/tmp/example.png", "caption");

      expect(mockBot.api.sendPhoto).toHaveBeenCalledTimes(1);
      expect(mockBot.api.sendPhoto.mock.calls[0]?.[0]).toBe(456);
      expect(mockBot.api.sendPhoto.mock.calls[0]?.[2]).toEqual({ caption: "caption" });
      expect(result).toBe(456);
    });
  });

  describe("setMessageReaction", () => {
    test("should set emoji reaction on a message", async () => {
      await api.setMessageReaction(456, 789, "👀");

      expect(mockBot.api.setMessageReaction).toHaveBeenCalledWith(456, 789, [
        { type: "emoji", emoji: "👀" },
      ]);
    });
  });

  describe("setMyCommands", () => {
    test("should set bot commands", async () => {
      const commands = [
        { command: "start", description: "Start the bot" },
        { command: "help", description: "Show help" },
      ];
      await api.setMyCommands(commands);

      expect(mockBot.api.setMyCommands).toHaveBeenCalledWith(commands);
    });

    test("should handle empty commands", async () => {
      await api.setMyCommands([]);

      expect(mockBot.api.setMyCommands).toHaveBeenCalledWith([]);
    });
  });
});
