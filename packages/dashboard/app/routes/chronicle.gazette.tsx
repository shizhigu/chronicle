import { useParams } from 'react-router';

export default function GazetteView() {
  const { worldId } = useParams();

  return (
    <div className="max-w-3xl mx-auto p-8 bg-cream text-abyss">
      <div className="border-y-4 border-abyss py-4 text-center">
        <h1 className="text-4xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          THE DAILY CHRONICLE
        </h1>
        <div className="text-xs mt-2">Day 1 · Vol. 1 · Free Edition</div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-6">
        <article className="col-span-2">
          <h2 className="text-2xl font-bold mb-2">Placeholder Headline Will Appear Here</h2>
          <p className="text-sm leading-relaxed">
            Once the simulation has been running, this gazette auto-generates from the day's events.
            The style adapts to your world: 1920s broadsheet, medieval scroll, modern tech blog,
            school yearbook — whatever matches.
          </p>
        </article>

        <article>
          <h3 className="font-bold border-b border-abyss pb-1 mb-2">Resource Count</h3>
          <p className="text-xs">Food 12 · Water 8 · Firewood 5</p>
        </article>
        <article>
          <h3 className="font-bold border-b border-abyss pb-1 mb-2">Overheard</h3>
          <p className="text-xs italic">"That Chen guy is weird, right?" — anonymous</p>
        </article>
      </div>

      <div className="mt-8 text-center text-xs border-t border-abyss pt-2">
        Chronicle: {worldId}
      </div>
    </div>
  );
}
