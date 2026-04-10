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
