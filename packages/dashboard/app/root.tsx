import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from 'react-router';

import './styles.css';

export const links = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Cormorant+Garamond:wght@500;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
  },
];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-abyss text-cream antialiased">
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// Surface render errors instead of silently blank-screening — the default
// react-router behavior in SPA mode is a black body if a child route throws.
export function ErrorBoundary() {
  const error = useRouteError();
  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.name
      : 'Unknown error';
  const message =
    error instanceof Error
      ? error.message
      : isRouteErrorResponse(error)
        ? typeof error.data === 'string'
          ? error.data
          : JSON.stringify(error.data, null, 2)
        : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Error · Chronicle</title>
        <Meta />
        <Links />
      </head>
      <body className="bg-abyss text-cream antialiased p-8 font-mono text-sm">
        <div className="max-w-4xl mx-auto">
          <div className="text-[11px] tracking-[0.3em] text-gold uppercase mb-2">
            Chronicle · Render Error
          </div>
          <h1 className="text-2xl text-red-400 mb-4">{title}</h1>
          <pre className="whitespace-pre-wrap text-cream/70 bg-[#07070a] border border-cream/10 rounded p-4 mb-4">
            {message}
          </pre>
          {stack ? (
            <pre className="whitespace-pre-wrap text-[11px] text-cream/40 bg-[#07070a] border border-cream/5 rounded p-4 overflow-auto">
              {stack}
            </pre>
          ) : null}
        </div>
        <Scripts />
      </body>
    </html>
  );
}
