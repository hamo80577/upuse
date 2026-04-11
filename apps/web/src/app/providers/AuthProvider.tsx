import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { AUTH_FORBIDDEN_EVENT, AUTH_UNAUTHORIZED_EVENT, api, describeApiError } from "../../api/client";
import type { AppUser } from "../../api/types";
import { getWebSystems } from "../../core/systems/registry";
import type { AuthSystemState, SystemAccessMap, SystemAccessState, SystemCapability, SystemId } from "../../core/systems/types";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";
const UNAUTHORIZED_MESSAGE = "Sign in again to access protected routes.";

function isUnauthorizedBootstrapError(error: unknown) {
  return describeApiError(error, "") === UNAUTHORIZED_MESSAGE;
}

interface AuthContextValue {
  status: AuthSystemState["status"];
  user: AuthSystemState["user"];
  bootstrapError: string | null;
  systems: AuthSystemState["systems"];
  hasSystemAccess: AuthSystemState["hasSystemAccess"];
  hasSystemCapability: AuthSystemState["hasSystemCapability"];
  getSystemAccess: AuthSystemState["getSystemAccess"];
  refreshAuth: () => Promise<void>;
  retryBootstrap: () => void;
  login: (payload: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const disabledSystemAccess: SystemAccessState = {
  enabled: false,
  role: null,
  roleLabel: null,
  capabilities: [],
};

function buildSystemAccess(user: AppUser | null) {
  return Object.fromEntries(
    getWebSystems().map((system) => [system.id, system.resolveAccess(user)]),
  ) as SystemAccessMap;
}

function createSystemAccessHelpers(systems: SystemAccessMap) {
  const getSystemAccess = (systemId: SystemId) => systems[systemId] ?? disabledSystemAccess;
  const hasSystemAccess = (systemId: SystemId) => getSystemAccess(systemId).enabled;
  const hasSystemCapability = (systemId: SystemId, capability: SystemCapability) =>
    getSystemAccess(systemId).capabilities.includes(capability);

  return {
    getSystemAccess,
    hasSystemAccess,
    hasSystemCapability,
  };
}

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
    const systems = buildSystemAccess(user);
    const accessHelpers = createSystemAccessHelpers(systems);

    return {
      status,
      user,
      bootstrapError,
      systems,
      ...accessHelpers,
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
