import { useEffect } from 'react';
import { href } from '../router';

export function Home() {
  useEffect(() => {
    document.title = 'Hidden Value: an explainable market-making card game';
  }, []);
  return (
    <main id="main" className="page">
      <section className="hero">
        <div className="hero__text">
          <p className="stamp">A trading game</p>
          <h1>Five hidden cards. One price. Can you beat the market maker?</h1>
          <p className="lede">
            The asset is worth the sum of five face-down cards. An AI market maker quotes a bid and an ask.
            You see a card it doesn’t, and an Advisor explains, with numbers, when to buy, sell or hold.
          </p>
          <div className="row">
            <a className="btn btn--primary" href={href('/play')}>
              Play
            </a>
            <a className="btn" href={href('/tutorial')}>
              Learn in the tutorial
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
