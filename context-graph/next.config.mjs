import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Home-directory lockfile (e.g. C:\Users\<you>\package-lock.json) makes Next pick the wrong workspace root.
  // Pin the app root here, and alias Tailwind so PostCSS resolves packages from this folder (see Next turbopack docs).
  turbopack: {
    root: __dirname,
    resolveAlias: {
      tailwindcss: path.join(__dirname, "node_modules", "tailwindcss"),
    },
  },
};

export default nextConfig;
