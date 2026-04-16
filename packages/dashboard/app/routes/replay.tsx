import { useParams } from 'react-router';

export default function Replay() {
  const { worldId } = useParams();
  return (
    <div className="p-8 text-center">
      <h2 className="text-2xl text-gold mb-4">Replay: {worldId}</h2>
      <p className="text-cream/60">v0.3: plays back the full event log with scrubbable timeline.</p>
    </div>
  );
}
