import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const assets = path.join(dist, "assets");

await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "main.jsx")],
  bundle: true,
  minify: true,
  sourcemap: false,
  outfile: path.join(assets, "app.js"),
  loader: {
    ".js": "jsx",
    ".jsx": "jsx",
    ".css": "css"
  },
  define: {
    "process.env.NODE_ENV": '"production"'
  }
});

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Malayalam Voice Assistant Demo</title>
    <script type="module" crossorigin src="/assets/app.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/app.css" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

await writeFile(path.join(dist, "index.html"), html);
