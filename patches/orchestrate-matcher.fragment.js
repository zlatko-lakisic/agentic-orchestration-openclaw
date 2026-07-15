/** OpenClaw plugin bridge. Matches `/api/v1/orchestrate`. */
function isApiV1Orchestrate(req) {
  const head = requestUrlHead(req);
  const decoded = (() => {
    try {
      return decodeURIComponent(head);
    } catch {
      return head;
    }
  })();
  const slashNorm = (s) => s.replace(/\\/g, "/");
  for (const c of [head, decoded, slashNorm(head), slashNorm(decoded)]) {
    if (/\/api\/v1\/orchestrate\/?$/i.test(c)) return true;
  }
  const pl = getRequestPathname(req).toLowerCase();
  return pl === "/api/v1/orchestrate" || pl.endsWith("/api/v1/orchestrate");
}
