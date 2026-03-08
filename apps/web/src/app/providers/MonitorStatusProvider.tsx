import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { api } from "../../api/client";
import type { DashboardSnapshot } from "../../api/types";
import { useAuth } from "./AuthProvider";

interface MonitorStatusContextValue {
  monitoring: DashboardSnapshot["monitoring"];
  refreshStatus: () => Promise<DashboardSnapshot["monitoring"]>;
  applyMonitoring: (monitoring: DashboardSnapshot["monitoring"]) => void;
  startMonitoring: () => Promise<{ ok: boolean; running: boolean; snapshot?: DashboardSnapshot }>;
  stopMonitoring: () => Promise<{ ok: boolean; running: boolean; snapshot?: DashboardSnapshot }>;
}

const initialMonitoring: DashboardSnapshot["monitoring"] = {
  running: false,
};

const MonitorStatusContext = createContext<MonitorStatusContextValue | null>(null);

export function MonitorStatusProvider(props: PropsWithChildren) {
  const { status } = useAuth();
  const [monitoring, setMonitoring] = useState<DashboardSnapshot["monitoring"]>(initialMonitoring);

  const applyMonitoring = (nextMonitoring: DashboardSnapshot["monitoring"]) => {
    setMonitoring((current) => ({
      ...current,
      ...nextMonitoring,
    }));
  };

  const refreshStatus = async () => {
    const nextMonitoring = await api.monitorStatus();
    applyMonitoring(nextMonitoring);
    return nextMonitoring;
  };

  const startMonitoring = async () => {
    const started = await api.monitorStart();
    if (started.snapshot) {
      applyMonitoring(started.snapshot.monitoring);
    } else {
      setMonitoring((current) => ({
        ...current,
        running: started.running,
      }));
    }
    return started;
  };

  const stopMonitoring = async () => {
    const stopped = await api.monitorStop();
    if (stopped.snapshot) {
      applyMonitoring(stopped.snapshot.monitoring);
    } else {
      setMonitoring((current) => ({
        ...current,
        running: stopped.running,
      }));
    }
    return stopped;
  };

  useEffect(() => {
    if (status !== "authenticated") {
      setMonitoring(initialMonitoring);
      return;
    }

    void refreshStatus().catch(() => {});
  }, [status]);

  return (
    <MonitorStatusContext.Provider
      value={{
        monitoring,
        refreshStatus,
        applyMonitoring,
        startMonitoring,
        stopMonitoring,
      }}
    >
      {props.children}
    </MonitorStatusContext.Provider>
  );
}

export function useMonitorStatus() {
  const context = useContext(MonitorStatusContext);
  if (!context) {
    throw new Error("useMonitorStatus must be used within MonitorStatusProvider");
  }
  return context;
}
