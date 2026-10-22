import type { PlayerView, SettledView } from '../engine/types';
import { PlayingCard } from './PlayingCard';

interface Props {
  view: PlayerView;
  settled?: SettledView | null;
}

/** The five hidden positions: your private card(s), public reveals, and face-down cards. */
export function CardRow({ view, settled }: Props) {
  const priv = new Map(view.privateCards.map((c) => [c.position, c.card]));
  const pub = new Map(view.revealed.map((r) => [r.position, r]));
  // Order: your cards first, then reveals in the order they happened, then face-down cards.
  const order = [
    ...view.privateCards.map((c) => c.position),
    ...view.revealed.map((r) => r.position),
    ...[0, 1, 2, 3, 4].filter((p) => !priv.has(p) && !pub.has(p)),
  ];
  const known = [...view.privateCards.map((c) => c.card), ...view.revealed.map((r) => r.card)];
  const knownSum = known.reduce((a, c) => a + (c % 13) + 1, 0);
  return (
    <section className="cards ticket" aria-labelledby="cards-title">
      <h2 className="stamp" id="cards-title">
        The five cards
      </h2>
      <div className="cards__row">
        {order.map((p) => {
          if (priv.has(p))
            return <PlayingCard key={p} card={priv.get(p)} role="private" caption="Yours (private)" />;
          const r = pub.get(p);
          if (r) return <PlayingCard key={p} card={r.card} role="public" caption={`Revealed R${r.round}`} />;
          if (settled)
            return <PlayingCard key={p} card={settled.settlement.cards[p]} role="settled" caption="Hidden" />;
          return <PlayingCard key={p} role="hidden" caption="Hidden" />;
        })}
      </div>
      <p className="cards__note">
        {settled ? (
          <>
            Value <strong className="mono">V = {settled.settlement.value}</strong>
          </>
        ) : (
          <>
            You know {known.length} of 5 (sum <span className="mono">{knownSum}</span>). V is the sum of all
            five.
          </>
        )}
      </p>
    </section>
  );
}
