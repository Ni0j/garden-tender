import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const outdir = resolve(root, "client/dist");
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(root, "client/src/main.tsx")],
  outdir,
  target: "browser",
  minify: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __API_BASE_URL__: JSON.stringify(process.env.PUBLIC_API_BASE_URL ?? ""),
  },
  plugins: [{ name: "separate-css", setup(build) {
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  } }],
});
if (!result.success) throw new AggregateError(result.logs, "Client build failed");
const css = Bun.spawn([process.execPath, "./node_modules/@tailwindcss/cli/dist/index.mjs", "-i", "client/src/theme.css", "-o", "client/dist/main.css", "--minify"], {
  cwd: root, stdout: "inherit", stderr: "inherit",
});
if (await css.exited !== 0) throw new Error("CSS build failed");
const html = await Bun.file(resolve(root, "client/index.html")).text();
await Bun.write(resolve(outdir, "index.html"), html.replace("./src/main.tsx", "./main.js").replace("</head>", '  <link rel="stylesheet" href="./main.css" />\n  </head>'));
