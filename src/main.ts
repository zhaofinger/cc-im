import { mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { CliAdapter } from "./agent/cli-adapter.ts";
import { Bridge } from "./bridge/bridge.ts";
import { Logger } from "./logger.ts";
import { runStartupChecks } from "./startup-check.ts";
import { TelegramApi } from "./telegram/api.ts";
import { buildStartupNotification, pickMessageReactionEmoji } from "./telegram/presence.ts";
import type { ImageAttachment } from "./types.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logDir);
  const telegram = new TelegramApi(config.telegramBotToken);
  const agent = new CliAdapter(config, logger);
  const bridge = new Bridge(config, telegram, agent, logger);

  await runStartupChecks({
    config,
    telegram,
    logger,
  });

  await bridge.setup();
  logger.info("bridge setup complete", {
    workspaceRoot: config.workspaceRoot,
    allowedChatId: config.telegramAllowedChatId,
    agentProvider: config.agentProvider,
  });

  const reportError = async (chatId: number | undefined, error: unknown, updateId: number) => {
    logger.error("telegram handler failed", {
      error: error instanceof Error ? error.message : String(error),
      updateId,
    });
    if (chatId) {
      await telegram.sendMessage(
        chatId,
        `Error: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  };

  telegram.bot.on("message:text", async (ctx) => {
    try {
      await telegram.setMessageReaction(
        ctx.chat.id,
        ctx.message.message_id,
        pickMessageReactionEmoji(),
      );
      await bridge.handleMessage({
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        updateId: ctx.update.update_id,
        text: ctx.message.text?.trim(),
      });
    } catch (error) {
      await reportError(ctx.chat.id, error, ctx.update.update_id);
    }
  });

  telegram.bot.on("message:photo", async (ctx) => {
    try {
      const attachment = await saveTelegramPhotoAttachment({
        messageId: ctx.message.message_id,
        chatId: ctx.chat.id,
        updateId: ctx.update.update_id,
        logDir: config.logDir,
        telegram,
        fileId: ctx.message.photo[ctx.message.photo.length - 1]?.file_id,
        width: ctx.message.photo[ctx.message.photo.length - 1]?.width,
        height: ctx.message.photo[ctx.message.photo.length - 1]?.height,
        fileSize: ctx.message.photo[ctx.message.photo.length - 1]?.file_size,
        caption: ctx.message.caption?.trim(),
      });
      await telegram.setMessageReaction(
        ctx.chat.id,
        ctx.message.message_id,
        pickMessageReactionEmoji(),
      );
      await bridge.handleMessage({
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        updateId: ctx.update.update_id,
        text: ctx.message.caption?.trim(),
        attachments: attachment ? [attachment] : [],
      });
    } catch (error) {
      await reportError(ctx.chat.id, error, ctx.update.update_id);
    }
  });

  telegram.bot.on("message:document", async (ctx) => {
    try {
      const mimeType = ctx.message.document.mime_type || "";
      if (!mimeType.startsWith("image/")) {
        return;
      }
      const attachment = await saveTelegramDocumentAttachment({
        messageId: ctx.message.message_id,
        chatId: ctx.chat.id,
        updateId: ctx.update.update_id,
        logDir: config.logDir,
        telegram,
        fileId: ctx.message.document.file_id,
        mimeType,
        fileName: ctx.message.document.file_name,
        fileSize: ctx.message.document.file_size,
        caption: ctx.message.caption?.trim(),
      });
      await telegram.setMessageReaction(
        ctx.chat.id,
        ctx.message.message_id,
        pickMessageReactionEmoji(),
      );
      await bridge.handleMessage({
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        updateId: ctx.update.update_id,
        text: ctx.message.caption?.trim(),
        attachments: attachment ? [attachment] : [],
      });
    } catch (error) {
      await reportError(ctx.chat.id, error, ctx.update.update_id);
    }
  });

  telegram.bot.on("callback_query:data", async (ctx) => {
    try {
      await bridge.handleCallback({
        id: ctx.callbackQuery.id,
        chatId: ctx.chat?.id || ctx.callbackQuery.message?.chat.id || 0,
        messageId: ctx.callbackQuery.message?.message_id,
        data: ctx.callbackQuery.data,
      });
    } catch (error) {
      await reportError(ctx.chat?.id, error, ctx.update.update_id);
    }
  });

  let isShuttingDown = false;
  const shutdown = (signal: "SIGINT" | "SIGTERM") => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.info(`received ${signal}, stopping bot`);
    telegram.bot.stop();
    process.exit(0);
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      shutdown(signal);
    });
  }

  await telegram.bot.start({
    onStart: async (botInfo) => {
      logger.info("telegram polling started", { username: botInfo.username });
      try {
        await telegram.sendMessage(
          config.telegramAllowedChatId,
          buildStartupNotification({
            provider: config.agentProvider,
            username: botInfo.username,
            workspaceRoot: config.workspaceRoot,
          }),
          { parseMode: "HTML" },
        );
      } catch (error) {
        logger.error("failed to send startup notification", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function saveTelegramPhotoAttachment(args: {
  messageId: number;
  chatId: number;
  updateId: number;
  logDir: string;
  telegram: TelegramApi;
  fileId?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  caption?: string;
}): Promise<ImageAttachment | undefined> {
  if (!args.fileId) {
    return undefined;
  }

  const file = await args.telegram.getFile(args.fileId);
  if (!file.file_path) {
    throw new Error("Telegram photo is missing file_path");
  }

  const mediaDir = resolve(args.logDir, "telegram-media", String(args.chatId));
  mkdirSync(mediaDir, { recursive: true });
  const extension = extensionFromPath(file.file_path) || ".jpg";
  const localPath = join(mediaDir, buildMediaFileName(args.messageId, args.updateId, extension));
  await args.telegram.downloadFile(file.file_path, localPath);

  return {
    kind: "image",
    localPath,
    mimeType: "image/jpeg",
    width: args.width,
    height: args.height,
    fileSize: args.fileSize ?? file.file_size,
    caption: args.caption,
    sourceMessageId: args.messageId,
  };
}

async function saveTelegramDocumentAttachment(args: {
  messageId: number;
  chatId: number;
  updateId: number;
  logDir: string;
  telegram: TelegramApi;
  fileId: string;
  mimeType: string;
  fileName?: string;
  fileSize?: number;
  caption?: string;
}): Promise<ImageAttachment | undefined> {
  const file = await args.telegram.getFile(args.fileId);
  if (!file.file_path) {
    throw new Error("Telegram document is missing file_path");
  }

  const mediaDir = resolve(args.logDir, "telegram-media", String(args.chatId));
  mkdirSync(mediaDir, { recursive: true });
  const extension = extname(args.fileName || "") || extensionFromPath(file.file_path) || ".bin";
  const localPath = join(mediaDir, buildMediaFileName(args.messageId, args.updateId, extension));
  await args.telegram.downloadFile(file.file_path, localPath);

  return {
    kind: "image",
    localPath,
    originalFileName: args.fileName,
    mimeType: args.mimeType,
    fileSize: args.fileSize ?? file.file_size,
    caption: args.caption,
    sourceMessageId: args.messageId,
  };
}

function buildMediaFileName(messageId: number, updateId: number, extension: string): string {
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
  return `${Date.now()}-${updateId}-${messageId}${normalizedExtension}`;
}

function extensionFromPath(filePath: string): string {
  return extname(filePath.split("?")[0] || "");
}
