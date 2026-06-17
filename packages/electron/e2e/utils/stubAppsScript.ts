import http from 'http';

export interface StubRows {
  rows: Array<{
    rowId: string;
    type: string;
    title: string;
    commandFeature: string;
    description: string;
  }>;
}

/**
 * Starts a minimal HTTP server that mimics a Google Apps Script web app endpoint.
 * Answers GET requests containing `api=rows` with the provided rows JSON.
 * All other requests return 404.
 *
 * The server binds to 127.0.0.1 on a random port so it is reachable by the
 * Electron main process (same machine) without conflicting with other servers.
 */
export function startStubAppsScript(
  state: StubRows,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url && req.url.includes('api=rows') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows: state.rows }));
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}/exec`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
