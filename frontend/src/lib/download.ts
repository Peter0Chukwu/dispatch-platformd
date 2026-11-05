import { API_BASE, getAccessToken, refreshAccessToken } from "./api";

/**
 * FILE DOWNLOADS
 *
 * Exports are permission-checked API routes, so a plain <a href> cannot be used:
 * the browser would send the refresh cookie but not the in-memory access token.
 * We fetch with the token, then hand the bytes to the browser as a blob.
 */
export async function downloadFile(
  path: string,
  fallbackName: string,
): Promise<number> {
  const attempt = async (): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      credentials: "include",
      headers: getAccessToken()
        ? { Authorization: `Bearer ${getAccessToken()}` }
        : undefined,
    });

  let response = await attempt();
  if (response.status === 401) {
    const renewed = await refreshAccessToken();
    if (renewed) response = await attempt();
  }
  if (!response.ok) {
    throw new Error(`Export failed (${response.status})`);
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const fileName = match?.[1] ?? fallbackName;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return Number(response.headers.get("x-export-rows") ?? 0);
}
