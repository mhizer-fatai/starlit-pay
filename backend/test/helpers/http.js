import express from "express";

/** Serves routers on an ephemeral port. A fake auth reads the test user from a header. */
export async function serve(buildRouter) {
  const app = express();
  app.use(express.json());
  const currentUser = (req) => (req.headers["x-test-user"] ? { id: req.headers["x-test-user"] } : null);
  const requireAuth = (req, res, next) => {
    req.user = currentUser(req);
    return req.user ? next() : res.status(401).json({ error: "Unauthorized" });
  };
  app.use(buildRouter({ requireAuth, currentUser }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { as, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(as ? { "x-test-user": as } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { call, close: () => new Promise((resolve) => server.close(resolve)) };
}
