// Browser preconnections and stalled downloads must not hold a restart forever.
// Allow normal requests to drain, then close remaining connections after 5 seconds.
export function closeHttpServer(server, graceMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => server.closeAllConnections(), graceMs);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeIdleConnections();
  });
}
