/** Static-first migration: the existing site ships from public/ untouched
 *  while the app router adds auth and the portal around it. */
const staticPages = ['show', 'events', 'spectate', 'status', 'clubs', 'collateral', 'brand'];
const nextConfig = {
  async rewrites() {
    return [
      { source: '/', destination: '/index.html' },
      { source: '/rancho', destination: '/collateral/index.html' },
      ...staticPages.flatMap((p) => [
        { source: `/${p}`, destination: `/${p}/index.html` },
        { source: `/${p}/`, destination: `/${p}/index.html` },
      ]),
      { source: '/collateral/captions.html', destination: '/collateral/captions.html' },
    ];
  },
  async headers() {
    return [
      {
        source: '/collateral/files/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' }],
      },
    ];
  },
};
export default nextConfig;
