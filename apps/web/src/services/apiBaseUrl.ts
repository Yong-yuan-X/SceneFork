export function resolveApiBaseUrl(
  configuredBaseUrl: string | undefined,
  fallbackBaseUrl: string,
): string {
  const configured = configuredBaseUrl?.trim()
  return (configured || fallbackBaseUrl).replace(/\/+$/, '')
}
