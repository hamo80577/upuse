export function fmtCairoTime(iso?: string, options?: Intl.DateTimeFormatOptions) {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      timeZone: "Africa/Cairo",
      hour: "2-digit",
      minute: "2-digit",
      ...options,
    });
  } catch {
    return "--";
  }
}

export function fmtCairoDateTime(iso?: string, options?: Intl.DateTimeFormatOptions) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Africa/Cairo",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      ...options,
    });
  } catch {
    return iso;
  }
}
