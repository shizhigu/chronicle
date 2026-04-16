export default function Gallery() {
  return (
    <div className="max-w-6xl mx-auto p-8">
      <h1 className="text-4xl text-gold mb-6" style={{ fontFamily: 'var(--font-display)' }}>
        Gallery
      </h1>
      <p className="text-cream/60 mb-8">
        Public chronicles. Fork them. Remix them. Create your own.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[
          {
            id: 'chr_demo1',
            name: 'Dinner Party of Secrets',
            author: 'staff',
            forks: 47,
            views: 12483,
          },
          { id: 'chr_demo2', name: 'Island Reckoning', author: 'staff', forks: 23, views: 7812 },
          { id: 'chr_demo3', name: 'The Startup', author: 'staff', forks: 18, views: 5102 },
        ].map((c) => (
          <div
            key={c.id}
            className="border border-cream/10 rounded-lg overflow-hidden hover:border-gold/50 transition"
          >
            <div className="aspect-video bg-cream/5 flex items-center justify-center text-cream/20 text-sm">
              (highlight thumbnail)
            </div>
            <div className="p-4">
              <div className="font-semibold text-cream">{c.name}</div>
              <div className="text-xs text-cream/50 mt-1">by @{c.author}</div>
              <div className="text-xs text-cream/40 mt-2">
                {c.views.toLocaleString()} views · {c.forks} forks
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
