import { Link } from 'react-router';

export function meta() {
  return [
    { title: 'Chronicle' },
    { name: 'description', content: 'Describe any world. Watch AI play it out.' },
  ];
}

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-8">
        <h1
          className="text-6xl font-bold tracking-tight text-gold"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Chronicle
        </h1>
        <p className="text-2xl text-cream/80">Describe any world. Watch AI play it out.</p>
        <p className="text-base text-cream/60 max-w-md mx-auto">
          A configurable social simulation substrate. Runs from your terminal. Watches here.
        </p>

        <div className="flex gap-4 justify-center mt-8">
          <Link
            to="/gallery"
            className="px-6 py-3 bg-gold text-abyss font-semibold rounded-md hover:bg-gold/90"
          >
            Browse Gallery
          </Link>
          <a
            href="https://chronicle.sh/install"
            className="px-6 py-3 border border-cream/30 text-cream rounded-md hover:bg-cream/5"
          >
            Install CLI
          </a>
        </div>

        <div className="mt-12 text-sm text-cream/50">
          <code className="bg-cream/5 px-3 py-1 rounded">
            curl -sSL https://chronicle.sh/install | bash
          </code>
        </div>
      </div>
    </main>
  );
}
