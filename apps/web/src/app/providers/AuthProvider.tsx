import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { AUTH_UNAUTHORIZED_EVENT, api, describeApiError } from "../../api/client";
import type { AppUser } from "../../api/types";
import { getAppPermissions, type AppPermissions } from "../permissions";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: AppUser | null;
  permissions: AppPermissions;
  isAdmin: boolean;
  canManage: boolean;
  canManageUsers: boolean;
  canManageMonitor: boolean;
  canRefreshOrdersNow: boolean;
  canManageBranches: boolean;
  canDeleteBranches: boolean;
  canManageSettings: boolean;
  canManageTokens: boolean;
  canTestTokens: boolean;
  canClearLogs: boolean;
  login: (payload: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider(props: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AppUser | null>(null);

  useEffect(() => {
    let active = true;
    setStatus("loading");

    void api.me()
      .then((response) => {
        if (!active) return;
        setUser(response.user);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setStatus("unauthenticated");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setStatus("unauthenticated");
    };

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const permissions = getAppPermissions(user?.role);

    return {
      status,
      user,
      permissions,
      isAdmin: permissions.isAdmin,
      canManage: permissions.canManage,
      canManageUsers: permissions.canManageUsers,
      canManageMonitor: permissions.canManageMonitor,
      canRefreshOrdersNow: permissions.canRefreshOrdersNow,
      canManageBranches: permissions.canManageBranches,
      canDeleteBranches: permissions.canDeleteBranches,
      canManageSettings: permissions.canManageSettings,
      canManageTokens: permissions.canManageTokens,
      canTestTokens: permissions.canTestTokens,
      canClearLogs: permissions.canClearLogs,
      login: async (payload) => {
        const response = await api.login(payload);
        setUser(response.user);
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
          setStatus("unauthenticated");
        }
      },
    };
  }, [status, user]);

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
