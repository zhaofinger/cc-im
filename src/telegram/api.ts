import type { TextWithEntities } from "@grammyjs/parse-mode";
import { Bot, type InlineKeyboard } from "grammy";
import type {
  ForceReply,
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
} from "grammy/types";
import type { MessageReactionEmoji } from "./presence.ts";

type ReplyMarkup =
  | InlineKeyboard
  | InlineKeyboardMarkup
  | ReplyKeyboardMarkup
  | ReplyKeyboardRemove
  | ForceReply;

type SendMessageOptions = {
  replyMarkup?: ReplyMarkup;
  parseMode?: "HTML" | "MarkdownV2";
};

type MessageInput = string | TextWithEntities;

export class TelegramApi {
  readonly bot: Bot;

  constructor(token: string) {
    this.bot = new Bot(token);
  }

  async sendMessage(
    chatId: number,
    text: MessageInput,
    options?: InlineKeyboard | SendMessageOptions,
  ): Promise<number> {
    const message = await this.bot.api.sendMessage(chatId, ...this.normalizeMessage(text, options));
    return message.message_id;
  }

  async sendMessageDraft(chatId: number, draftId: number, text: string): Promise<void> {
    await this.bot.api.sendMessageDraft(chatId, draftId, text);
  }

  async getMe(): Promise<{ id: number; username?: string }> {
    const me = await this.bot.api.getMe();
    return {
      id: me.id,
      username: me.username,
    };
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: MessageInput,
    options?: InlineKeyboard | SendMessageOptions,
  ): Promise<void> {
    try {
      await this.bot.api.editMessageText(
        chatId,
        messageId,
        ...this.normalizeMessage(text, options),
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("message is not modified")) {
        return;
      }
      throw error;
    }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.bot.api.answerCallbackQuery(callbackQueryId, { text });
  }

  async sendTyping(chatId: number): Promise<void> {
    await this.bot.api.sendChatAction(chatId, "typing");
  }

  async setMessageReaction(
    chatId: number,
    messageId: number,
    emoji: MessageReactionEmoji,
  ): Promise<void> {
    await this.bot.api.setMessageReaction(chatId, messageId, [{ type: "emoji", emoji }]);
  }

  async setMyCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
    await this.bot.api.setMyCommands(commands);
  }

  private normalizeOptions(options?: InlineKeyboard | SendMessageOptions): SendMessageOptions {
    if (!options) {
      return {};
    }
    if ("inline_keyboard" in options) {
      return { replyMarkup: options };
    }
    return options;
  }

  private normalizeText(text: MessageInput): TextWithEntities {
    return typeof text === "string" ? { text } : text;
  }

  private normalizeMessage(
    text: MessageInput,
    options?: InlineKeyboard | SendMessageOptions,
  ): [
    string,
    {
      entities?: TextWithEntities["entities"];
      parse_mode?: SendMessageOptions["parseMode"];
      reply_markup?: InlineKeyboard | InlineKeyboardMarkup;
    },
  ] {
    const normalized = this.normalizeOptions(options);
    const payload = this.normalizeText(text);
    return [
      payload.text,
      {
        entities: payload.entities,
        parse_mode: payload.entities ? undefined : normalized.parseMode,
        reply_markup: normalized.replyMarkup as InlineKeyboard | InlineKeyboardMarkup | undefined,
      },
    ];
  }
}
