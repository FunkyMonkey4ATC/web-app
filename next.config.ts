import type { NextConfig } from "next";

// NEXT_DIST_DIR lets a second dev server run beside a build without sharing .next
const nextConfig: NextConfig = { distDir: process.env.NEXT_DIST_DIR || ".next" };

export default nextConfig;
