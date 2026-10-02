import { env } from '../../env.js';

/**
 * The payment provider seam — Alex, 2026-09-30.
 *
 * One door, chosen by env.paymentProvider, the same swappable shape as
 * mailTransport / insightProvider. Today there is exactly one provider
 * and it is a mock, labelled as such everywhere it shows: it moves no
 * money, it answers the way a real gateway answers (a reference, or a
 * reason), and a charge reference containing "fail" is refused so the
 * failure path can be seen in fixtures and tests. The cancellation
 * domain only ever talks to `PaymentProvider`, so the real provider,
 * when chosen, replaces this file's default and nothing else.
 */

export interface RefundOutcome {
  ok: boolean;
  /** The provider's reference for the refund, when it took it. */
  ref: string | null;
  /** Why not, when it did not. */
  reason: string | null;
  /** Whether trying again later could succeed. */
  retry: boolean;
}

export interface PaymentProvider {
  readonly name: string;
  refund(input: { chargeRef: string | null; amount: number; invoiceId: string }): Promise<RefundOutcome>;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  async refund(input: { chargeRef: string | null; amount: number; invoiceId: string }): Promise<RefundOutcome> {
    if (!input.chargeRef) return { ok: false, ref: null, reason: 'No charge reference to refund against', retry: false };
    if (input.chargeRef.includes('fail'))
      return { ok: false, ref: null, reason: 'Mock provider refused the refund', retry: true };
    if (input.amount <= 0) return { ok: true, ref: `mock_rf_zero_${input.invoiceId.slice(0, 8)}`, reason: null, retry: false };
    return { ok: true, ref: `mock_rf_${input.invoiceId.replace(/-/g, '').slice(0, 16)}`, reason: null, retry: false };
  }
}

let current: PaymentProvider | null = null;
export function paymentProvider(): PaymentProvider {
  if (current) return current;
  // env.ts refuses anything but 'mock' until a real provider exists.
  current = new MockPaymentProvider();
  return current;
}
/** Test seam. */
export function setPaymentProvider(p: PaymentProvider | null) {
  current = p;
}
void env;
