import type { Request, Response } from "express";
import { z } from "zod";
import { createAuthSession, createUser, deleteAuthSession, deleteUserById, listUsers, updateUser, verifyUserCredentials } from "../services/authStore.js";
import { clearAuthSessionCookie, setAuthSessionCookie } from "../http/sessionCookie.js";
import { normalizeEmail } from "../services/auth/passwords.js";
import { loginIpThrottleStore, loginThrottleStore } from "../services/loginThrottleStore.js";
import type { AppUserRole, AuthMeResponse, AuthUsersResponse, LoginResponse, ScanoRole } from "../types/models.js";

const AppUserRoleSchema = z.enum(["admin", "user"] satisfies [AppUserRole, AppUserRole]);
const ScanoRoleSchema = z.enum(["team_lead", "scanner"] satisfies [ScanoRole, ScanoRole]);
const MIN_PASSWORD_LENGTH = 12;

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const CreateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(120),
  name: z.string().trim().min(1).max(120),
  upuseAccess: z.boolean(),
  upuseRole: AppUserRoleSchema.optional(),
  scanoAccessRole: ScanoRoleSchema.optional(),
}).superRefine((value, ctx) => {
  if (!value.upuseAccess && !value.scanoAccessRole) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one workspace access must be enabled.",
      path: ["upuseAccess"],
    });
  }

  if (value.upuseAccess && !value.upuseRole) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Select a UPuse role when UPuse access is enabled.",
      path: ["upuseRole"],
    });
  }

  if (!value.upuseAccess && value.upuseRole) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "UPuse role cannot be set when UPuse access is disabled.",
      path: ["upuseRole"],
    });
  }
});

const UpdateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(120).optional().or(z.literal("")),
  name: z.string().trim().min(1).max(120),
  upuseAccess: z.boolean(),
  upuseRole: AppUserRoleSchema.optional(),
  scanoAccessRole: ScanoRoleSchema.optional(),
}).superRefine((value, ctx) => {
  if (!value.upuseAccess && !value.scanoAccessRole) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one workspace access must be enabled.",
      path: ["upuseAccess"],
    });
  }

  if (value.upuseAccess && !value.upuseRole) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Select a UPuse role when UPuse access is enabled.",
      path: ["upuseRole"],
    });
  }

  if (!value.upuseAccess && value.upuseRole) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "UPuse role cannot be set when UPuse access is disabled.",
      path: ["upuseRole"],
    });
  }
});

const UserIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

function isUniqueEmailError(error: unknown) {
  const message = typeof (error as { message?: unknown })?.message === "string"
    ? (error as { message: string }).message
    : "";

  return /unique constraint failed/i.test(message) && message.includes("users.email");
}

function getLoginAttemptKey(req: Request, email: string) {
  return `acct:${req.ip || "unknown"}:${normalizeEmail(email)}`;
}

function getLoginIpAttemptKey(req: Request) {
  return `ip:${req.ip || "unknown"}`;
}

function buildLoginThrottleMessage(blockedUntilMs: number) {
  const remainingMinutes = Math.max(1, Math.ceil((blockedUntilMs - Date.now()) / 60_000));
  return `Too many failed sign-in attempts. Try again in ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}.`;
}

export function resetLoginRateLimitStateForTests() {
  loginThrottleStore.resetLoginRateLimitStateForTests();
  loginIpThrottleStore.resetLoginRateLimitStateForTests();
}

export function loginRoute(req: Request, res: Response) {
  const input = LoginBody.parse(req.body);
  const attemptKey = getLoginAttemptKey(req, input.email);
  const ipAttemptKey = getLoginIpAttemptKey(req);
  const blockedUntilMs = Math.max(
    loginThrottleStore.getBlockedUntil(attemptKey) ?? 0,
    loginIpThrottleStore.getBlockedUntil(ipAttemptKey) ?? 0,
  ) || null;

  if (blockedUntilMs) {
    return res.status(429).json({
      ok: false,
      message: buildLoginThrottleMessage(blockedUntilMs),
    });
  }

  const user = verifyUserCredentials(input.email, input.password);
  if (!user) {
    const nextAttemptState = loginThrottleStore.registerFailedLoginAttempt(attemptKey);
    const nextIpAttemptState = loginIpThrottleStore.registerFailedLoginAttempt(ipAttemptKey);
    const nextBlockedUntilMs = Math.max(
      nextAttemptState.blockedUntilMs ?? 0,
      nextIpAttemptState.blockedUntilMs ?? 0,
    ) || null;
    const statusCode = nextBlockedUntilMs ? 429 : 401;
    return res.status(statusCode).json({
      ok: false,
      message: nextBlockedUntilMs
        ? buildLoginThrottleMessage(nextBlockedUntilMs)
        : "Invalid email or password",
    });
  }

  loginThrottleStore.clearLoginAttempts(attemptKey);
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
      code: "SESSION_UNAUTHORIZED",
      errorOrigin: "session",
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

export function updateUserRoute(req: Request, res: Response) {
  const { id } = UserIdParam.parse(req.params);
  const input = UpdateUserBody.parse(req.body);

  try {
    const user = updateUser({
      id,
      email: input.email,
      name: input.name,
      upuseAccess: input.upuseAccess,
      upuseRole: input.upuseRole,
      scanoAccessRole: input.scanoAccessRole,
      password: typeof input.password === "string" && input.password.trim() ? input.password : undefined,
      actorUserId: req.authUser?.id,
    });
    res.json({
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

export function deleteUserRoute(req: Request, res: Response) {
  const { id } = UserIdParam.parse(req.params);

  deleteUserById({
    id,
    actorUserId: req.authUser?.id,
  });

  res.json({
    ok: true,
  });
}
