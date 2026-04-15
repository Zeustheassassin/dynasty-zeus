import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // Compress responses
  compress: true,

  // Strict mode surfaces double-invocation bugs early in dev
  reactStrictMode: true,

  // Allow Sleeper and ESPN images; prefer modern formats for smaller payloads
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "sleepercdn.com" },
      { protocol: "https", hostname: "a.espncdn.com" },
      { protocol: "https", hostname: "static.www.nfl.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "images.pexels.com" },
    ],
  },

  // Security & caching headers applied to all routes
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Prevent browsers from using features the app doesn't need
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          // Force HTTPS for 1 year (only sent over HTTPS; no-op in local dev)
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // Content Security Policy — tightens what resources the browser will load.
          // Sleeper CDN and ESPN CDN are allowlisted for images.
          // Supabase project is allowlisted for fetch (connect-src).
          // 'unsafe-inline' for styles is required by Tailwind CSS v4 (inlined critical styles).
          // 'unsafe-eval' is added in dev only: React dev mode uses eval() for stack traces.
          // Production never needs it — React drops eval() in prod builds.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https://sleepercdn.com https://a.espncdn.com https://static.www.nfl.com https://images.unsplash.com https://images.pexels.com",
              "font-src 'self'",
              "connect-src 'self' https://api.sleeper.app https://www.fantasycalc.com https://api.fantasycalc.com https://*.supabase.co",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
      // Cache static Sleeper player/ADP data for 5 minutes at the CDN edge
      {
        source: "/api/projections/:path*",
        headers: [
          { key: "Cache-Control", value: "s-maxage=300, stale-while-revalidate=60" },
        ],
      },
    ];
  },
};

export default nextConfig;
