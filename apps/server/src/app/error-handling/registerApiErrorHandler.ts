import type { Express } from "express";
import express from "express";
import multer from "multer";
import { ZodError } from "zod";

export function registerApiErrorHandler(app: Express) {
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof ZodError) {
      res.status(400).json({
        ok: false,
        message: "Invalid request payload",
        code: "VALIDATION_ERROR",
        errorOrigin: "validation",
        issues: error.issues.map((issue) => issue.message),
      });
      return;
    }

    if (error instanceof multer.MulterError) {
      res.status(400).json({
        ok: false,
        message: error.message || "Invalid uploaded file",
        code: "UPLOAD_ERROR",
        errorOrigin: "validation",
      });
      return;
    }

    const typedError = error as {
      status?: unknown;
      message?: unknown;
      code?: unknown;
      errorOrigin?: unknown;
      integration?: unknown;
      exposeMessage?: unknown;
    };
    const status =
      typeof typedError.status === "number" &&
      typedError.status >= 400 &&
      typedError.status < 600
        ? typedError.status
        : 500;
    if (status >= 500) {
      console.error("Unhandled API error", error);
    }
    const errorOrigin =
      typedError.errorOrigin === "session" ||
      typedError.errorOrigin === "authorization" ||
      typedError.errorOrigin === "integration" ||
      typedError.errorOrigin === "validation" ||
      typedError.errorOrigin === "server"
        ? typedError.errorOrigin
        : status === 401
          ? "session"
          : status === 403
            ? "authorization"
            : "server";
    const code = typeof typedError.code === "string" ? typedError.code : undefined;
    const integration = typeof typedError.integration === "string" ? typedError.integration : undefined;
    const message =
      status >= 500 && typedError.exposeMessage !== true
        ? "Internal server error"
        : (typeof typedError.message === "string" && typedError.message.length
          ? typedError.message
          : "Request failed");

    res.status(status).json({
      ok: false,
      message,
      ...(code ? { code } : {}),
      ...(errorOrigin ? { errorOrigin } : {}),
      ...(integration ? { integration } : {}),
    });
  });
}
