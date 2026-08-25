# Phase 6 — Employee App (PWA)

The prototype's phone app (`viewMobile`), full-viewport on a real
device (the desktop `.phone` frame is a demo artifact; the inner
anatomy — mo-head/mo-body/mo-tabs — is identical).

- **Sign-in:** real credentials through `@velnes/client` (the
  prototype's tap-your-name list is a demo affordance, not auth).
- **Agenda:** only the signed-in employee's appointments, grouped by
  day. Each card runs the treatment flow — Start treatment → Running
  → Finish treatment. Those two taps are the timing engine's only
  inputs; they post to the appointment-events door and trigger the
  pair's recompute. Check out rings the appointment onto the till.
- **Till:** catalog tiles for the employee's location, basket,
  TOTAL bar → Cash/Card → the one `/sales` door; the invoice number
  comes back in the toast.
- **Ranking:** the rank-row board from paid invoices — the owner
  sees the same board.
- **PWA:** installable (manifest + Velnes mark), autoUpdate service
  worker, NetworkFirst caching for agenda/location reads so a dead
  spot still shows the last known day; writes stay online-only and
  carry idempotency keys.
