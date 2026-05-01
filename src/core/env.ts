export function getEnvValue(name: string, fallback = '') {
  const importMetaEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const viteValue = importMetaEnv?.[name];
  if (typeof viteValue === 'string' && viteValue.length > 0) return viteValue;

  const processValue = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  if (typeof processValue === 'string' && processValue.length > 0) return processValue;

  return fallback;
}

export function getAppOrigin(fallback = 'http://localhost:5173') {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return getEnvValue('OPENROUTER_HTTP_REFERER', fallback);
}
