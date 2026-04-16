export default function ReelView() {
  return (
    <div className="p-8 max-w-md mx-auto">
      <div className="aspect-[9/16] bg-abyss border border-cream/10 rounded-lg flex items-center justify-center">
        <div className="text-center text-cream/50">
          <div className="text-4xl mb-2">🎬</div>
          <div className="text-sm">Highlight reel</div>
          <div className="text-xs mt-2">v0.3: auto-generated 30–60s video</div>
        </div>
      </div>
      <div className="mt-6 text-center">
        <button
          type="button"
          className="px-6 py-3 bg-gold text-abyss font-semibold rounded-md hover:bg-gold/90"
        >
          Generate reel
        </button>
      </div>
    </div>
  );
}
