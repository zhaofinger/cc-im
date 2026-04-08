import { loadConfig } from "./config.ts";
import { CliAdapter } from "./agent/cli-adapter.ts";
import { Bridge } from "./bridge/bridge.ts";
import { Logger } from "./logger.ts";
import { runStartupChecks } from "./startup-check.ts";
import { TelegramApi } from "./telegram/api.ts";
import { buildStartupNotification, pickMessageReactionEmoji } from "./telegram/presence.ts";

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

  telegram.bot.on("message:text", async (ctx) => {
    try {
      const text = ctx.message.text?.trim();
      if (!text) {
        return;
      }
      await telegram.setMessageReaction(
        ctx.chat.id,
        ctx.message.message_id,
        pickMessageReactionEmoji(),
      );
      await bridge.handleMessage({
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        updateId: ctx.update.update_id,
        text,
      });
    } catch (error) {
      logger.error("failed to handle telegram message", {
        error: error instanceof Error ? error.message : String(error),
        updateId: ctx.update.update_id,
      });
      await telegram.sendMessage(
        ctx.chat.id,
        `Error: ${error instanceof Error ? error.message : "unknown"}`,
      );
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
      logger.error("failed to handle telegram callback", {
        error: error instanceof Error ? error.message : String(error),
        updateId: ctx.update.update_id,
      });
      if (ctx.chat?.id) {
        await telegram.sendMessage(
          ctx.chat.id,
          `Error: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }
  });

  process.on("SIGINT", () => {
    logger.info("received SIGINT, stopping bot");
    telegram.bot.stop();
  });
  process.on("SIGTERM", () => {
    logger.info("received SIGTERM, stopping bot");
    telegram.bot.stop();
  });

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

void main();
