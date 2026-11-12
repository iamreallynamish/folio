/** Local and self-hosted entry point: serves the API and the built web app on one port. */
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { app } from "./app.js";

const dist = path.resolve("dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}
const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`Folio on http://localhost:${port}`));
