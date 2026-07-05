import type { BillingPlan } from '../auth/billing'

export function PricingModal({ plans, busyPlanId, error, onClose, onSelectPlan }: {
  plans: BillingPlan[]
  busyPlanId?: string | null
  error?: string
  onClose: () => void
  onSelectPlan: (planId: string) => Promise<void>
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <section className="brain-dump-modal" role="dialog" aria-modal="true" aria-labelledby="pricing-title" onClick={(event) => event.stopPropagation()}>
        <div className="brain-dump-header">
          <div>
            <p className="eyebrow">Hosted plan</p>
            <h3 id="pricing-title">Upgrade OpenNapse</h3>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
        <div className="stats-grid" aria-label="Available billing plans">
          {plans.map((plan) => (
            <article key={plan.id} className="stat-card" style={{ alignItems: 'stretch', textAlign: 'left' }}>
              <span>{plan.name}</span>
              <strong>{plan.priceLabel ?? 'Contact billing'}</strong>
              {plan.description ? <small style={{ color: 'var(--muted)' }}>{plan.description}</small> : null}
              <ul className="settings-list" style={{ marginTop: 8 }}>
                {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busyPlanId !== null && busyPlanId !== undefined}
                onClick={() => void onSelectPlan(plan.id)}
              >{busyPlanId === plan.id ? 'Opening…' : 'Choose plan'}</button>
            </article>
          ))}
        </div>
        {plans.length === 0 ? <p className="settings-muted">No hosted plans returned by the billing wrapper.</p> : null}
        {error ? <p className="settings-status settings-status--error">{error}</p> : null}
      </section>
    </div>
  )
}
