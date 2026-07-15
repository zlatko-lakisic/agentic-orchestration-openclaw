  if (isApiV1Orchestrate(req)) {
    handleApiV1Orchestrate(req, res).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ error: clientErrorMessage(err, "Internal server error") }));
      } else {
        try {
          res.destroy();
        } catch {
          /* ignore */
        }
      }
    });
    return;
  }
