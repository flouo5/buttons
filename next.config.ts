import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ohne "standalone" erzeugt der Build kein eigenstaendiges server.js, und
  // das Runtime-Image muesste die vollen node_modules mitschleppen. Alle
  // anderen Apps der Flotte laufen so; siehe Dockerfile.
  output: "standalone",
};

export default nextConfig;
