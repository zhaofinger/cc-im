import { FormattedString, fmt } from "@grammyjs/parse-mode";

export function buildSessionStartedMessage(workspaceName: string) {
  return fmt`🆕 ${FormattedString.bold("Started a new Claude session")}
${FormattedString.code(workspaceName)}`;
}

export function buildNoSessionsMessage(workspaceName: string) {
  return fmt`📂 ${FormattedString.bold("No sessions found")}
📁 ${FormattedString.code(workspaceName)}

No previous sessions available to resume.`;
}

export function buildResumeMenuMessage(args: {
  workspaceName: string;
  start: number;
  end: number;
  total: number;
}) {
  const { workspaceName, start, end, total } = args;
  return fmt`📂 ${FormattedString.bold("Resume Session")} (${start}-${end} of ${total})
📁 ${FormattedString.code(workspaceName)}

Select a session to resume:`;
}

export function buildSessionResumedMessage(workspaceName: string, sessionId: string) {
  return fmt`✅ ${FormattedString.bold("Session Resumed")}
📁 ${FormattedString.code(workspaceName)}
${FormattedString.code(sessionId)}`;
}
