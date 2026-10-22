import { cardName, isRedSuit, rankLabel, rankOf, SUIT_SYMBOLS, suitOf } from '../engine/cards';

export type CardRole = 'private' | 'public' | 'hidden' | 'settled';

interface Props {
  /** Omitted for a face-down card: hidden cards are never passed to the UI. */
  card?: number;
  role: CardRole;
  caption?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function PlayingCard({ card, role, caption, size = 'md' }: Props) {
  if (card === undefined) {
    return (
      <figure className={`pcard pcard--${size} pcard--back`} aria-label="Face-down card" data-role={role}>
        <div className="pcard__back" aria-hidden="true">
          <span>?</span>
        </div>
        {caption && <figcaption className="pcard__caption">{caption}</figcaption>}
      </figure>
    );
  }
  const rank = rankOf(card);
  const suit = SUIT_SYMBOLS[suitOf(card)];
  const red = isRedSuit(card);
  return (
    <figure
      className={`pcard pcard--${size} pcard--${role} ${red ? 'pcard--red' : ''}`}
      data-card={card}
      data-role={role}
      aria-label={`${cardName(card)}, value ${rank}${role === 'private' ? ', your private card' : ''}`}
    >
      <div className="pcard__face" aria-hidden="true">
        <span className="pcard__corner">
          {rankLabel(rank)}
          <br />
          {suit}
        </span>
        <span className="pcard__pip">{suit}</span>
        <span className="pcard__rank">{rankLabel(rank)}</span>
        <span className="pcard__value">= {rank}</span>
      </div>
      {caption && <figcaption className="pcard__caption">{caption}</figcaption>}
    </figure>
  );
}
