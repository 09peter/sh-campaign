export function Panel({ title, right, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel-head">
          <span className="eyebrow">{title}</span>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

const STATUS_COLORS = {
  draft: 'border-ash text-ash',
  mustering: 'border-brass text-brasslight',
  active: 'border-emberlight text-emberlight',
  completed: 'border-olive text-bone',
  archived: 'border-line text-ash',
  pending_approval: 'border-brass text-brasslight',
  approved: 'border-olive text-bone',
  suspended: 'border-imperial text-emberlight',
  pending_verification: 'border-brass text-brasslight',
  verified: 'border-olive text-bone',
  disputed: 'border-imperial text-emberlight',
  open: 'border-brass text-brasslight',
  locked: 'border-imperial text-emberlight',
  resolving: 'border-emberlight text-emberlight',
  complete: 'border-olive text-bone',
  pending: 'border-brass text-brasslight',
  broken: 'border-imperial text-emberlight',
  idle: 'border-line text-ash',
  force_marching: 'border-brass text-brasslight',
  in_battle: 'border-imperial text-emberlight',
}

export function Badge({ children, tone }) {
  return <span className={`badge ${STATUS_COLORS[tone ?? children] ?? 'border-line text-ash'}`}>{String(children).replace(/_/g, ' ')}</span>
}

export function Field({ label, children }) {
  return <label className="block">{label && <span className="lbl">{label}</span>}{children}</label>
}

export function Empty({ children }) {
  return <p className="text-ash text-sm font-mono py-6 text-center">{children}</p>
}
