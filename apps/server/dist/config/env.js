export function getEnv(name, fallback) {
    const v = process.env[name];
    if (v && v.length)
        return v;
    if (fallback !== undefined)
        return fallback;
    throw new Error(`Missing env var: ${name}`);
}
