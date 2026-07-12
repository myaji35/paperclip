import path from "node:path";
import fs from "node:fs";
import { config as loadDotenv } from "dotenv";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { readConfigFile } from "../config-file.js";
import { resolveDefaultLogsDir, resolveHomeAwarePath, resolvePaperclipInstanceRoot } from "../home-paths.js";
import { shouldSilenceHttpSuccessLog } from "./http-log-policy.js";

// Ensure .env is loaded before reading PAPERCLIP_LOG_LEVEL, in case this
// module is imported before config.ts runs its own dotenv bootstrap.
const _instanceEnvPath = path.resolve(resolvePaperclipInstanceRoot(), ".env");
if (fs.existsSync(_instanceEnvPath)) {
  loadDotenv({ path: _instanceEnvPath, override: false, quiet: true });
}

type PinoLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
const VALID_LEVELS = new Set<string>(["trace", "debug", "info", "warn", "error", "fatal"]);

function resolveServerLogDir(): string {
  const envOverride = process.env.PAPERCLIP_LOG_DIR?.trim();
  if (envOverride) return resolveHomeAwarePath(envOverride);

  const fileLogDir = readConfigFile()?.logging.logDir?.trim();
  if (fileLogDir) return resolveHomeAwarePath(fileLogDir);

  return resolveDefaultLogsDir();
}

function resolveFileLogLevel(): PinoLevel {
  const envLevel = process.env.PAPERCLIP_LOG_LEVEL?.trim().toLowerCase();
  if (envLevel && VALID_LEVELS.has(envLevel)) return envLevel as PinoLevel;

  const configLevel = (readConfigFile()?.logging as any)?.logLevel?.trim().toLowerCase();
  if (configLevel && VALID_LEVELS.has(configLevel)) return configLevel as PinoLevel;

  return "debug";
}

const logDir = resolveServerLogDir();
fs.mkdirSync(logDir, { recursive: true });

const logFile = path.join(logDir, "server.log");
const fileLogLevel = resolveFileLogLevel();

const sharedOpts = {
  translateTime: "SYS:HH:MM:ss",
  ignore: "pid,hostname",
  singleLine: true,
};

export const logger = pino({
  level: fileLogLevel,
  redact: ["req.headers.authorization"],
}, pino.transport({
  targets: [
    {
      target: "pino-pretty",
      options: { ...sharedOpts, ignore: "pid,hostname,req,res,responseTime", colorize: true, destination: 1 },
      level: "info",
    },
    {
      target: "pino-pretty",
      options: { ...sharedOpts, colorize: false, destination: logFile, mkdir: true },
      level: fileLogLevel,
    },
  ],
}));

export const httpLogger = pinoHttp({
  logger,
  customLogLevel(_req, res, err) {
    if (shouldSilenceHttpSuccessLog(_req.method, _req.url, res.statusCode)) {
      return "silent";
    }
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage(req, res, err) {
    const ctx = (res as any).__errorContext;
    const errMsg = ctx?.error?.message || err?.message || (res as any).err?.message || "unknown error";
    return `${req.method} ${req.url} ${res.statusCode} — ${errMsg}`;
  },
  customProps(req, res) {
    if (res.statusCode >= 400) {
      const ctx = (res as any).__errorContext;
      if (ctx) {
        return {
          errorContext: ctx.error,
          reqBody: ctx.reqBody,
          reqParams: ctx.reqParams,
          reqQuery: ctx.reqQuery,
        };
      }
      const props: Record<string, unknown> = {};
      const { body, params, query } = req as any;
      if (body && typeof body === "object" && Object.keys(body).length > 0) {
        props.reqBody = body;
      }
      if (params && typeof params === "object" && Object.keys(params).length > 0) {
        props.reqParams = params;
      }
      if (query && typeof query === "object" && Object.keys(query).length > 0) {
        props.reqQuery = query;
      }
      if ((req as any).route?.path) {
        props.routePath = (req as any).route.path;
      }
      return props;
    }
    return {};
  },
});
