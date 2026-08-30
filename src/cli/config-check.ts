import { loadConfig } from "../config/index.js";

try {
  const config = loadConfig();
  process.stdout.write(
    `${JSON.stringify({
      status: "ok",
      environment: config.environment,
      dataDirectory: config.dataDirectory,
      larkEnabled: config.lark.enabled,
      modelEnabled: config.model.enabled,
      allowedUsers: config.lark.userRoles.size,
      allowedChats: config.lark.allowedChatIds.size,
    })}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown configuration error";
  process.stderr.write(`${JSON.stringify({ status: "invalid", message })}\n`);
  process.exitCode = 1;
}
