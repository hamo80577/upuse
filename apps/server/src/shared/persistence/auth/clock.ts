export function nowIso() {
  return new Date().toISOString();
}

export function plusHoursIso(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
