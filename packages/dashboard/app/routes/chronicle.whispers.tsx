import { useParams } from 'react-router';

export default function WhispersView() {
  const { agentId } = useParams();
  return (
    <div className="max-w-sm mx-auto p-4 min-h-full bg-abyss">
      <div className="text-center py-4 border-b border-cream/10">
        <div className="text-cream text-lg">{agentId ?? '(select a character)'}</div>
        <div className="text-xs text-cream/50">Whispers — private POV feed</div>
      </div>
      <div className="py-4 space-y-3">
        {[
          {
            at: '11:47',
            type: 'thought',
            text: 'Elena is hiding something. I saw her count the pills twice.',
          },
          { at: '11:52', type: 'speak_public', text: 'We need to talk about the supplies.' },
          {
            at: '11:53',
            type: 'heard_reply',
            from: 'Elena',
            text: "I'm keeping inventory. Don't accuse me.",
          },
          { at: '12:14', type: 'whisper', to: 'Finn', text: 'Keep watch tonight.' },
          { at: '12:14', type: 'heard_reply', from: 'Finn', text: 'Aye.' },
        ].map((row, i) => (
          <div key={i} className="text-sm">
            <div className="text-cream/40 text-[10px]">{row.at}</div>
            {'type' in row && row.type === 'thought' && (
              <div className="italic text-cream/70">{row.text}</div>
            )}
            {'type' in row && row.type === 'speak_public' && (
              <div className="bg-cream/10 rounded-lg p-2 text-cream">{row.text}</div>
            )}
            {'type' in row && row.type === 'whisper' && (
              <div className="bg-gold/10 rounded-lg p-2 text-cream border border-dashed border-gold/30">
                <span className="text-[10px] text-gold/70">whisper to {row.to}</span>
                <div>{row.text}</div>
              </div>
            )}
            {'type' in row && row.type === 'heard_reply' && (
              <div className="bg-cream/5 rounded-lg p-2 text-cream/80">
                <span className="text-[10px] text-cream/50">{row.from}: </span>
                {row.text}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
