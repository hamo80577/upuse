import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import express from "express";
import { fileURLToPath } from "node:url";
import { resolveWebDistDir } from "../../config/paths.js";

function looksLikeLinkPreviewBot(userAgent: string | undefined) {
  if (!userAgent) return false;

  return /(WhatsApp|facebookexternalhit|Facebot|TelegramBot|Slackbot|Discordbot|LinkedInBot|Twitterbot|SkypeUriPreview)/i.test(
    userAgent,
  );
}

export function registerProductionAssets(app: Express) {
  const runtimeEntryPath = fileURLToPath(import.meta.url);
  const isCompiledRuntime = runtimeEntryPath.includes(`${path.sep}dist${path.sep}`);
  const isProductionRuntime = isCompiledRuntime && process.env.NODE_ENV?.trim().toLowerCase() === "production";

  if (!isProductionRuntime) {
    return;
  }

  const webDistDir = resolveWebDistDir();
  const webIndexPath = path.join(webDistDir, "index.html");

  if (!fs.existsSync(webIndexPath)) {
    throw new Error(
      `Missing frontend build output at ${webIndexPath}. Run "npm run build" before starting production.`,
    );
  }

  const assetDirPrefix = `assets${path.sep}`;
  app.use(express.static(webDistDir, {
    index: false,
    fallthrough: true,
    setHeaders(res, filePath) {
      const relativePath = path.relative(webDistDir, filePath);
      if (relativePath === "index.html") {
        res.setHeader("Cache-Control", "no-cache");
        return;
      }

      if (relativePath.startsWith(assetDirPrefix)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }

    if (path.extname(req.path)) {
      next();
      return;
    }

    const acceptsHtml = typeof req.headers.accept === "string" && req.headers.accept.includes("text/html");
    const isLinkPreview = looksLikeLinkPreviewBot(typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined);
    if (!acceptsHtml && !isLinkPreview) {
      next();
      return;
    }

    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(webIndexPath);
  });
}
