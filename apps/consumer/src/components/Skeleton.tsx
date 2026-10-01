/**
 * Loading skeletons (Alex, 2026-10-01): the shape of what is coming,
 * shimmering, instead of a blank or a jump. Built on the `.skel-*`
 * classes the results page already had, so every list on the app
 * loads the same way. Nothing here is interactive or announced.
 */
export function SkelLines({ n = 3, widths = ['w80', 'w60', 'w40'] }: { n?: number; widths?: string[] }) {
  return (
    <div className="skel-bd">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={`skel-line ${widths[i % widths.length]}`} />
      ))}
    </div>
  );
}

/** A result-style row: picture beside three lines. */
export function SkelRows({ n = 3 }: { n?: number }) {
  return (
    <div className="skel-rows" aria-hidden="true" data-testid="skeleton">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skel-card">
          <div className="skel-ph" />
          <SkelLines />
        </div>
      ))}
    </div>
  );
}

/** A rail of salon cards, picture on top. */
export function SkelRail({ n = 3, m = false }: { n?: number; m?: boolean }) {
  return (
    <div className={`skel-rail${m ? ' m' : ''}`} aria-hidden="true" data-testid="skeleton">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skel-card best">
          <div className="skel-ph" />
          <SkelLines n={2} widths={['w60', 'w80']} />
        </div>
      ))}
    </div>
  );
}

/** The salon page before its detail answers: gallery, name, four tiles. */
export function SalonSkeleton() {
  return (
    <div className="skel-salon" aria-hidden="true" data-testid="skeleton">
      <div className="skel-ph hero" />
      <div className="skel-line w60 title" />
      <div className="skel-line w40" />
      <div className="skel-tiles">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skel-card">
            <SkelLines n={2} widths={['w60', 'w40']} />
          </div>
        ))}
      </div>
    </div>
  );
}
