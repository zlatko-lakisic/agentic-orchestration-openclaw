/**
 * Purpose-built bridge for the OpenClaw plugin.
 * Simpler than /v1/chat/completions: { text, sessionId, … } → { ok, output }.
 * Injected by @zlatko-lakisic/openclaw-agentic-orchestration when missing upstream.
 */
async function handleApiV1Orchestrate(req, res) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors).end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", ...cors });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const apiKey = String(
    process.env.AGENTIC_ORCHESTRATE_API_KEY || process.env.AGENTIC_CHAT_COMPLETIONS_API_KEY || "",
  ).trim();
  if (apiKey) {
    const auth = String(req.headers.authorization || "").trim();
    const matches = auth === `Bearer ${apiKey}` || auth === apiKey;
    if (!matches) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", ...cors });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
  }

  let bodyBuf;
  try {
    bodyBuf = await readRequestBodyBuf(req, MAX_CHAT_COMPLETIONS_BODY_BYTES);
  } catch (err) {
    res.writeHead(413, { "Content-Type": "application/json; charset=utf-8", ...cors });
    res.end(JSON.stringify({ error: clientErrorMessage(err, "Request body too large") }));
    return;
  }

  let body;
  try {
    body = JSON.parse(bodyBuf.length ? bodyBuf.toString("utf8") : "{}");
  } catch {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", ...cors });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", ...cors });
    res.end(JSON.stringify({ error: "body.text is required" }));
    return;
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
  const resetSession = body.resetSession === true;
  const runMode = body.runMode || "dynamic";
  const verboseCrew = body.verboseCrew === true;
  const selectedIds = Array.isArray(body.selectedAgentProviderIds)
    ? body.selectedAgentProviderIds
    : [];

  let runResult;
  try {
    runResult = await runDynamicAwait({
      text,
      runMode,
      sessionId,
      resetSession,
      verboseCrew,
      selectedAgentProviderIds: selectedIds,
      userName: userNameFromRequestHeaders(req.headers),
    });
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", ...cors });
    res.end(JSON.stringify({ error: clientErrorMessage(e, "Orchestration failed") }));
    return;
  }

  if (runResult.code !== 0) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", ...cors });
    res.end(
      JSON.stringify({
        error: "Orchestration process exited with non-zero code",
        code: runResult.code,
        stderr: runResult.stderr?.slice(-2000),
      }),
    );
    return;
  }

  const output = normalizeOrchestratedApiContent(runResult.stdout);
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", ...cors });
  res.end(JSON.stringify({ ok: true, output }));
}
