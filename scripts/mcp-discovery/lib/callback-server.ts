import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface CallbackResult {
  code: string;
  state: string;
}

/**
 * Spawns a localhost HTTP server on the given port. Resolves with the
 * authorization code from `/callback?code=…&state=…`. Verifies that `state`
 * matches the expected value.
 */
export function waitForCallback(
  port: number,
  expectedState: string
): Promise<CallbackResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");

      const finish = (status: number, body: string, err?: Error) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
        res.end(body);
        server.close();
        if (err) rejectPromise(err);
      };

      if (error) {
        finish(
          400,
          `<html><body><h2>OAuth error</h2><pre>${error}: ${errorDescription ?? ""}</pre></body></html>`,
          new Error(`OAuth error: ${error}${errorDescription ? ` — ${errorDescription}` : ""}`)
        );
        return;
      }
      if (!code) {
        finish(400, "<html><body>Missing code</body></html>", new Error("Callback missing code"));
        return;
      }
      if (state !== expectedState) {
        finish(
          400,
          "<html><body>State mismatch — possible CSRF</body></html>",
          new Error("OAuth state mismatch")
        );
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<html><body style="font-family:system-ui;padding:2em">
          <h2>Auth complete ✓</h2>
          <p>You can close this tab and return to the terminal.</p>
        </body></html>`
      );
      server.close();
      resolvePromise({ code, state });
    });

    server.on("error", rejectPromise);
    server.listen(port, "127.0.0.1");
  });
}
