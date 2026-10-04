export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function buildSingleBankMcpUrl(baseUrl: string, bankId: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const id = encodeURIComponent(bankId);
  return `${base}/mcp/${id}/`;
}

export function buildMultiBankMcpUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/mcp/`;
}

export function defaultMcpServerName(bankId: string): string {
  return `hindsight-${bankId}`;
}
