import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { AUTH_FORBIDDEN_EVENT, AUTH_UNAUTHORIZED_EVENT, api, describeApiError } from "../../api/client";
import type { AppUser } from "../../api/types";
import { getAppPermissionsForAccess, type AppPermissions } from "../permissions";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";
const UNAUTHORIZED_MESSAGE = "Sign in again to access protected routes.";

function isUnauthorizedBootstrapError(error: unknown) {
  return describeApiError(error, "") === UNAUTHORIZED_MESSAGE;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AppUser | null;
  bootstrapError: string | null;
  permissions: AppPermissions;
  isAdmin: boolean;
  scanoRole: AppUser["scanoRole"] | null;
  canAccessUpuse: boolean;
  canAccessScano: boolean;
  canManageScanoTasks: boolean;
  canManageScanoSettings: boolean;
  canSwitchSystems: boolean;
  canManage: boolean;
  canManageUsers: boolean;
  canManageMonitor: boolean;
  canRefreshOrdersNow: boolean;
  canManageBranches: boolean;
  canDeleteBranches: boolean;
  canManageThresholds: boolean;
  canManageSettings: boolean;
  canManageTokens: boolean;
  canTestTokens: boolean;
  canClearLogs: boolean;
  refreshAuth: () => Promise<void>;
  retryBootstrap: () => void;
  login: (payload: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider(props: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AppUser | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const refreshAuthRequestIdRef = useRef(0);

  const refreshAuth = useCallback(async () => {
    const requestId = refreshAuthRequestIdRef.current + 1;
    refreshAuthRequestIdRef.current = requestId;

    try {
      const response = await api.me();
      if (requestId !== refreshAuthRequestIdRef.current) return;
      setUser(response.user);
      setBootstrapError(null);
      setStatus("authenticated");
    } catch (error) {
      if (requestId !== refreshAuthRequestIdRef.current) return;
      if (isUnauthorizedBootstrapError(error)) {
        setUser(null);
        setBootstrapError(null);
        setStatus("unauthenticated");
        return;
      }

      throw error;
    }
  }, []);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setBootstrapError(null);

    void api.me()
      .then((response) => {
        if (!active) return;
        setUser(response.user);
        setBootstrapError(null);
        setStatus("authenticated");
      })
      .catch((error) => {
        if (!active) return;
        if (isUnauthorizedBootstrapError(error)) {
          setUser(null);
          setBootstrapError(null);
          setStatus("unauthenticated");
          return;
        }

        setBootstrapError(describeApiError(error, "Failed to restore session"));
      });

    return () => {
      active = false;
    };
  }, [bootstrapAttempt]);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setBootstrapError(null);
      setStatus("unauthenticated");
    };
    const onForbidden = () => {
      if (status !== "authenticated") return;
      void refreshAuth().catch(() => {});
    };

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener(AUTH_FORBIDDEN_EVENT, onForbidden);
    return () => {
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
      window.removeEventListener(AUTH_FORBIDDEN_EVENT, onForbidden);
    };
  }, [refreshAuth, status]);

  const value = useMemo<AuthContextValue>(() => {
    const canAccessUpuse = user?.upuseAccess === true;
    const canAccessScano = !!user && (user.isPrimaryAdmin || user.scanoRole === "team_lead" || user.scanoRole === "scanner");
    const permissions = getAppPermissionsForAccess(user?.role, canAccessUpuse);

    return {
      status,
      user,
      bootstrapError,
      permissions,
      isAdmin: permissions.isAdmin,
      scanoRole: user?.scanoRole ?? null,
      canAccessUpuse,
      canAccessScano,
      canManageScanoTasks: !!user && (user.isPrimaryAdmin || user.scanoRole === "team_lead"),
      canManageScanoSettings: user?.isPrimaryAdmin === true,
      canSwitchSystems: canAccessUpuse && canAccessScano,
      canManage: permissions.canManage,
      canManageUsers: permissions.canManageUsers,
      canManageMonitor: permissions.canManageMonitor,
      canRefreshOrdersNow: permissions.canRefreshOrdersNow,
      canManageBranches: permissions.canManageBranches,
      canDeleteBranches: permissions.canDeleteBranches,
      canManageThresholds: permissions.canManageThresholds,
      canManageSettings: permissions.canManageSettings,
      canManageTokens: permissions.canManageTokens,
      canTestTokens: permissions.canTestTokens,
      canClearLogs: permissions.canClearLogs,
      refreshAuth,
      retryBootstrap: () => {
        setStatus("loading");
        setBootstrapError(null);
        setBootstrapAttempt((current) => current + 1);
      },
      login: async (payload) => {
        const response = await api.login(payload);
        setUser(response.user);
        setBootstrapError(null);
        setStatus("authenticated");
      },
      logout: async () => {
        try {
          await api.logout();
        } catch (error) {
          const message = describeApiError(error, "Failed to sign out");
          if (message !== "Sign in again to access protected routes.") {
            throw error;
          }
        } finally {
          setUser(null);
          setBootstrapError(null);
          setStatus("unauthenticated");
        }
      },
    };
  }, [bootstrapError, refreshAuth, status, user]);

  return (
    <AuthContext.Provider value={value}>
      {props.children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
