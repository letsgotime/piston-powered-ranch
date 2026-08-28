export const metadata = {
  title: "PaddockGavin Events",
  description: "Curated automotive gatherings in Middle Tennessee.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0d1620" />
        <link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon.png" />
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
