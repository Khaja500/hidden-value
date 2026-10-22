import { NotRun } from '../components/charts';
import { useJson } from '../components/chartUtils';

/** Learned market maker results (spec §6, §8.5). Filled in by `npm run train`. */
export function LearnedSection() {
  const res = useJson<unknown>('models/learned-mm.json');
  return (
    <section className="research__section" id="learned" aria-labelledby="learned-h">
      <h2 id="learned-h">The learned market maker</h2>
      {res.state === 'loading' && <p className="muted">Loading training results…</p>}
      {res.state !== 'ok' && res.state !== 'loading' && (
        <NotRun file="models/learned-mm.json" command="npm run train" />
      )}
    </section>
  );
}
