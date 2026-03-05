const ADMIN_KEY_STORAGE_KEY = "upuse.adminKey.session";
const LEGACY_ADMIN_KEY_STORAGE_KEY = "upuse.adminKey";
const ADMIN_KEY_TTL_MS = 8 * 60 * 60 * 1000;

function getStorage(kind: "session" | "local") {
  if (typeof window === "undefined") return null;

  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function readSessionAdminKey() {
  const storage = getStorage("session");
  const raw = storage?.getItem(ADMIN_KEY_STORAGE_KEY) ?? "";
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw) as { value?: unknown; expiresAt?: unknown };
    const value = typeof parsed.value === "string" ? parsed.value.trim() : "";
    const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0;
    if (!value || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
      storage?.removeItem(ADMIN_KEY_STORAGE_KEY);
      return "";
    }
    return value;
  } catch {
    storage?.removeItem(ADMIN_KEY_STORAGE_KEY);
    return "";
  }
}

export function getStoredAdminKey() {
  const sessionValue = readSessionAdminKey();
  if (sessionValue) return sessionValue;

  const legacyStorage = getStorage("local");
  const legacyValue = legacyStorage?.getItem(LEGACY_ADMIN_KEY_STORAGE_KEY)?.trim() ?? "";
  if (!legacyValue) return "";

  setStoredAdminKey(legacyValue);
  legacyStorage?.removeItem(LEGACY_ADMIN_KEY_STORAGE_KEY);
  return legacyValue;
}

export function setStoredAdminKey(value: string) {
  const sessionStorage = getStorage("session");
  const localStorage = getStorage("local");
  if (!sessionStorage) return;

  const normalized = value.trim();
  if (!normalized) {
    sessionStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
    localStorage?.removeItem(LEGACY_ADMIN_KEY_STORAGE_KEY);
    return;
  }

  sessionStorage.setItem(
    ADMIN_KEY_STORAGE_KEY,
    JSON.stringify({
      value: normalized,
      expiresAt: Date.now() + ADMIN_KEY_TTL_MS,
    }),
  );
  localStorage?.removeItem(LEGACY_ADMIN_KEY_STORAGE_KEY);
}

export function clearStoredAdminKey() {
  getStorage("session")?.removeItem(ADMIN_KEY_STORAGE_KEY);
  getStorage("local")?.removeItem(LEGACY_ADMIN_KEY_STORAGE_KEY);
}
