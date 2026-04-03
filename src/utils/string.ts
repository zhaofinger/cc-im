export function shorten(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen - 3)}...`;
}

export function clipForTelegram(text: string, maxLen = 3900): string {
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen - 15)}\n\n_[truncated]_`;
}
