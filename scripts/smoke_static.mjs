#!/usr/bin/env node
// Serve the actual production build below a subpath, with no API available.
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "frontend/package.json"));
const { chromium, firefox, expect: baseExpect } = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 15_000 });
const useFirefox = process.env.HW1_BROWSER === "firefox";
const dist = resolve(process.env.HW1_DIST_DIR ?? join(root, "frontend/dist"));
const artifacts =
  process.env.HW1_ARTIFACT_DIR ?? join(root, "frontend/test-results/static");
const prefix = "/hw1-demo/";
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".ply": "application/octet-stream",
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (!pathname.startsWith(prefix)) {
    response.writeHead(404).end();
    return;
  }
  const path = resolve(dist, pathname.slice(prefix.length) || "index.html");
  if (!path.startsWith(dist + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(path);
    response.writeHead(200, {
      "Content-Type": mime[extname(path)] ?? "application/octet-stream",
    });
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});

let browser;
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  browser = await (useFirefox ? firefox : chromium).launch({
    headless: process.env.HW1_HEADED !== "1",
    executablePath: useFirefox ? undefined : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: useFirefox
      ? []
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    firefoxUserPrefs: { "webgl.force-enabled": true },
  });
  const page = await browser.newPage({
    viewport: { width: 1360, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      /\.(js|css|json|ply)$/.test(response.url()) &&
      response.status() !== 200
    )
      errors.push(response.url());
  });
  await page.goto(`http://127.0.0.1:${address.port}${prefix}`);
  await expect(page.getByTestId("viewport")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await expect(
    page.getByText("Local demo mode", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("6,453 points · Ready")).toBeVisible();
  await page.getByRole("button", { name: "+ Pick point", exact: true }).click();
  const box = await page.locator("canvas").boundingBox();
  for (const [x, y] of [
    [0.6, 0.5],
    [0.4, 0.5],
    [0.5, 0.6],
    [0.6, 0.65],
    [0.4, 0.65],
  ]) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    if (await page.getByLabel("Label required").isVisible()) break;
  }
  await page.getByLabel("Label required").fill("Static build landmark");
  await page
    .getByRole("button", { name: "Save annotation", exact: true })
    .click();
  await expect(
    page.getByText("Annotation saved in this browser only."),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Static build landmark", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("viewport")).toHaveAttribute(
    "data-state",
    "ready",
  );
  assert.equal(await page.evaluate(() => typeof window.__NEURAL3D__), "undefined", "Test diagnostics must be absent from production");
  const localFile = {
    name: "Static local.ply", mimeType: "application/octet-stream",
    buffer: Buffer.from("ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n-1 -1 -1\n1 1 1\n"),
  };
  await page.getByLabel("Open PLY file").setInputFiles(localFile);
  await expect(page.getByText("3 points · Ready")).toBeVisible();
  await expect(page.getByText("Local file - not uploaded", { exact: true })).toBeVisible();
  await expect(page.getByText("Static build landmark", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "+ Pick point", exact: true }).click();
  const localBox = await page.locator("canvas").boundingBox();
  await page.mouse.click(localBox.x + localBox.width / 2, localBox.y + localBox.height / 2);
  await page.getByLabel("Label required").fill("Local file landmark");
  await page.getByRole("button", { name: "Save annotation", exact: true }).click();
  await expect(page.getByText("Annotation saved in this browser only.")).toBeVisible();
  await page.getByRole("button", { name: "Use sample", exact: true }).click();
  await expect(page.getByText("Static build landmark", { exact: true })).toBeVisible();
  await page.getByLabel("Open PLY file").setInputFiles(localFile);
  await expect(page.getByText("Local file landmark", { exact: true })).toBeVisible();
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({
    path: join(artifacts, "static-subpath.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: production build at /hw1-demo/, sample/local PLY worker rendered, API absent, scene-isolated annotations restored, diagnostics absent, no browser/asset errors",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
}
