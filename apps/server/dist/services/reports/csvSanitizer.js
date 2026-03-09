export function csvCell(value) {
    const raw = value == null ? "" : String(value);
    const shouldPrefixApostrophe = /^[=+\-@]/.test(raw) || /^[\t\r\n]/.test(raw);
    const text = shouldPrefixApostrophe ? `'${raw}` : raw;
    const escaped = text.replace(/"/g, "\"\"");
    return `"${escaped}"`;
}
