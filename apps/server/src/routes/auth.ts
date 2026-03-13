import type { Request, Response } from "express";
import { z } from "zod";
import { resolveSecurityConfig } from "../config/security.js";
import { createAuthSession, createUser, deleteAuthSession, listUsers, verifyUserCredentials } from "../services/authStore.js";
import { clearAuthSessionCookie, setAuthSessionCookie } from "../http/sessionCookie.js";
import { normalizeEmail } from "../services/auth/passwords.js";
import type { AppUserRole, AuthMeResponse, AuthUsersResponse, LoginResponse } from "../types/models.js";

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const CreateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(120),
  name: z.string().trim().min(1).max(120),
  role: z.enum(["admin", "user"] satisfies [AppUserRole, AppUserRole]),
});

function isUniqueEmailError(error: unknown) {
  const message = typeof (error as { message?: unknown })?.message === "string"
    ? (error as { message: string }).message
    : "";

  return /unique constraint failed/i.test(message) && message.includes("users.email");
}

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_ATTEMPT_BLOCK_MS = 15 * 60 * 1000;
const { loginRateLimitMaxKeys: MAX_LOGIN_ATTEMPT_KEYS } = resolveSecurityConfig();

interface LoginAttemptState {
  count: number;
  windowStartedAtMs: number;
  blockedUntilMs: number | null;
}

const loginAttempts = new Map<string, LoginAttemptState>();

function touchLoginAttempt(key: string, state: LoginAttemptState) {
  loginAttempts.delete(key);
  loginAttempts.set(key, state);
}

function enforceLoginAttemptCapacity() {
  while (loginAttempts.size > MAX_LOGIN_ATTEMPT_KEYS) {
    const oldestKey = loginAttempts.keys().next().value;
    if (!oldestKey) return;
    loginAttempts.delete(oldestKey);
  }
}

function getLoginAttemptKey(req: Request, email: string) {
  return `${req.ip || "unknown"}:${normalizeEmail(email)}`;
}

function pruneLoginAttempts(nowMs = Date.now()) {
  for (const [key, state] of loginAttempts.entries()) {
    const windowExpired = nowMs - state.windowStartedAtMs > LOGIN_ATTEMPT_WINDOW_MS;
    const blockExpired = !state.blockedUntilMs || state.blockedUntilMs <= nowMs;

    if (windowExpired && blockExpired) {
      loginAttempts.delete(key);
    }
  }
}

function getBlockedUntilMs(key: string, nowMs = Date.now()) {
  pruneLoginAttempts(nowMs);
  const state = loginAttempts.get(key);
  if (!state?.blockedUntilMs || state.blockedUntilMs <= nowMs) {
    if (state?.blockedUntilMs && state.blockedUntilMs <= nowMs) {
      loginAttempts.delete(key);
    }
    return null;
  }
  touchLoginAttempt(key, state);
  return state.blockedUntilMs;
}

function registerFailedLoginAttempt(key: string, nowMs = Date.now()) {
  const current = loginAttempts.get(key);
  const withinWindow = current && nowMs - current.windowStartedAtMs <= LOGIN_ATTEMPT_WINDOW_MS;

  const nextState: LoginAttemptState = withinWindow
    ? {
        count: current.count + 1,
        windowStartedAtMs: current.windowStartedAtMs,
        blockedUntilMs: current.blockedUntilMs,
      }
    : {
        count: 1,
        windowStartedAtMs: nowMs,
        blockedUntilMs: null,
      };

  if (nextState.count >= MAX_LOGIN_ATTEMPTS) {
    nextState.blockedUntilMs = nowMs + LOGIN_ATTEMPT_BLOCK_MS;
  }

  touchLoginAttempt(key, nextState);
  enforceLoginAttemptCapacity();
  return nextState;
}

function clearLoginAttempts(key: string) {
  loginAttempts.delete(key);
}

function buildLoginThrottleMessage(blockedUntilMs: number) {
  const remainingMinutes = Math.max(1, Math.ceil((blockedUntilMs - Date.now()) / 60_000));
  return `Too many failed sign-in attempts. Try again in ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}.`;
}

export function resetLoginRateLimitStateForTests() {
  loginAttempts.clear();
}

export function loginRoute(req: Request, res: Response) {
  const input = LoginBody.parse(req.body);
  const attemptKey = getLoginAttemptKey(req, input.email);
  const blockedUntilMs = getBlockedUntilMs(attemptKey);

  if (blockedUntilMs) {
    return res.status(429).json({
      ok: false,
      message: buildLoginThrottleMessage(blockedUntilMs),
    });
  }

  const user = verifyUserCredentials(input.email, input.password);
  if (!user) {
    const nextAttemptState = registerFailedLoginAttempt(attemptKey);
    const statusCode = nextAttemptState.blockedUntilMs ? 429 : 401;
    return res.status(statusCode).json({
      ok: false,
      message: nextAttemptState.blockedUntilMs
        ? buildLoginThrottleMessage(nextAttemptState.blockedUntilMs)
        : "Invalid email or password",
    });
  }

  clearLoginAttempts(attemptKey);
  const session = createAuthSession(user.id);
  setAuthSessionCookie(res, session.token, session.expiresAt);
  const body: LoginResponse = {
    ok: true,
    user,
  };
  res.json(body);
}

export function meRoute(req: Request, res: Response) {
  if (!req.authUser) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized",
    });
  }

  const body: AuthMeResponse = {
    ok: true,
    user: req.authUser,
  };
  res.json(body);
}

export function logoutRoute() {
  return (req: Request, res: Response) => {
    if (req.authSessionToken) {
      deleteAuthSession(req.authSessionToken);
    }

    clearAuthSessionCookie(res);
    res.json({
      ok: true,
    });
  };
}

export function listUsersRoute(_req: Request, res: Response) {
  const body: AuthUsersResponse = {
    ok: true,
    items: listUsers(),
  };
  res.json(body);
}

export function createUserRoute(req: Request, res: Response) {
  const input = CreateUserBody.parse(req.body);

  try {
    const user = createUser(input);
    res.status(201).json({
      ok: true,
      user,
    });
  } catch (error) {
    if (isUniqueEmailError(error)) {
      return res.status(409).json({
        ok: false,
        message: "Email already exists",
      });
    }

    throw error;
  }
}
