import { useGame } from '../app/store';
import { weekDebrief, type WeekDebrief } from '../sim/debrief';
import { Empty, Kicker, Modal, Money, Pill } from './common';

/**
 * The end-of-week debriefing (playtest, 23 November): opens on Monday
 * morning once Friday's settlement is done, over the planning desk.
 */
export function Debriefing() {
  const sim = useGame((s) => s.sim);
  const open = useGame((s) => s.debrief);
  const setDebrief = useGame((s) => s.setDebrief);
  useGame((s) => s.version);
  if (!sim || !open || sim.world.phase !== 'planning') return null;
  const d = weekDebrief(sim.world, sim.playerGang);
  const close = () => setDebrief(false);

  return (
    <Modal
      title={`Week ${d.week} debriefing`}
      kicker={sim.playerGang.name}
      onClose={close}
      width={640}
      footer={<button className="btn brass" data-autofocus onClick={close}>Start planning week {sim.world.week}</button>}
    >
      <DebriefBody d={d} />
    </Modal>
  );
}

function DebriefBody({ d }: { d: WeekDebrief }) {
  return (
      <div className="debrief">
        <section>
          <Kicker>The money</Kicker>
          {d.money ? (
            <>
              <div className="kv"><span>Cash on Monday</span><Money value={d.money.opening} /></div>
              <div className="kv"><span>Came in</span><Money value={d.money.income} /></div>
              <div className="kv"><span>Went out</span><Money value={-d.money.costs} /></div>
              {d.money.tax > 0 && <div className="kv"><span>Tax</span><Money value={-d.money.tax} /></div>}
              <div className="kv debrief-total"><span>Cash on Friday</span><Money value={d.money.closing} /></div>
              <div className="kv"><span>Week's result</span>
                <Pill kind={d.money.net >= 0 ? 'good' : 'bad'}>{d.money.net >= 0 ? '+' : '−'}${Math.abs(Math.round(d.money.net)).toLocaleString('en-US')}</Pill>
              </div>
              {d.money.partial && <div className="muted tiny">Part of this week was kept before the books existed.</div>}
            </>
          ) : <Empty>No books kept yet.</Empty>}
        </section>

        <section>
          <Kicker>What changed</Kicker>
          {d.changes.length ? d.changes.map(c => (
            <div key={c.key} className="kv">
              <span>{c.label}</span>
              <span>
                <b className="mono">{c.now.toLocaleString('en-US')}</b>
                {c.delta != null && c.delta !== 0 && (
                  // More heat is bad news; more of everything else is good.
                  <Pill kind={(c.delta > 0) !== (c.key === 'suspicion') ? 'good' : 'bad'}>
                    {c.delta > 0 ? '+' : '−'}{Math.abs(c.delta).toLocaleString('en-US')}
                  </Pill>
                )}
              </span>
            </div>
          )) : <Empty>Nothing to compare yet.</Empty>}
        </section>

        <section>
          <Kicker>Orders</Kicker>
          <div className="kv"><span>Carried out</span><b className="mono">{d.orders.done}</b></div>
          <div className="kv"><span>Failed</span><b className="mono">{d.orders.failed}</b></div>
          {d.orders.failures.map((f, i) => (
            <div key={i} className="tiny debrief-line"><b>{f.name}:</b> {f.reason}</div>
          ))}
          {d.orders.failed > d.orders.failures.length && (
            <div className="muted tiny">…and {d.orders.failed - d.orders.failures.length} more in the lieutenants' reports.</div>
          )}
        </section>

        <section>
          <Kicker>Businesses</Kicker>
          {!d.businesses.best.length && !d.businesses.worst.length && <Empty>No business made or lost money.</Empty>}
          {[...d.businesses.best, ...d.businesses.worst].map(b => (
            <div key={b.id} className="kv"><span>{b.name}</span><Money value={b.profit} /></div>
          ))}
        </section>

        <section className="debrief-events">
          <Kicker>The week's events</Kicker>
          {d.events.length
            ? <ul>{d.events.map((e, i) => <li key={i}>{e}</li>)}</ul>
            : <Empty>A quiet week.</Empty>}
        </section>
      </div>
  );
}
