import {
  API_PREFIX,
  RegistrationVerifyResponseSchema,
  type RegistrationVerifyResponse,
} from '@velnes/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Centered } from './Register.js';

const STORE = 'velnes.reg';

/**
 * Where every mail to an applicant lands. The e-mail token confirms the
 * address, and the page shows where the registration stands: under
 * review, sent back (with HQ's reason and the wizard a click away),
 * declined, or live — then on to sign-in, which opens the flightdeck.
 * The resubmit token comes back with the answer and is kept the way the
 * wizard keeps it, so this link is also the way back into the wizard
 * from any device.
 */
export function RegistrationStatus() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'checking' | 'invalid' | 'ok'>('checking');
  const [row, setRow] = useState<RegistrationVerifyResponse | null>(null);

  useEffect(() => {
    if (!id || !token) {
      setState('invalid');
      return;
    }
    let cancelled = false;
    fetch(`${API_PREFIX}/registrations/${id}/verify-email?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    })
      .then(async (res) => (res.ok ? RegistrationVerifyResponseSchema.parse(await res.json()) : null))
      .then((out) => {
        if (cancelled) return;
        if (!out) {
          setState('invalid');
          return;
        }
        localStorage.setItem(STORE, JSON.stringify({ id: out.id, token: out.resubmitToken }));
        if (out.status === 'active') {
          // Approved: the owner chose a password at registration — sign
          // in lands on the flightdeck.
          navigate('/login', { replace: true, state: { notice: 'live', email: out.email } });
          return;
        }
        setRow(out);
        setState('ok');
      })
      .catch(() => {
        if (!cancelled) setState('invalid');
      });
    return () => {
      cancelled = true;
    };
  }, [id, token, navigate]);

  if (state === 'checking')
    return (
      <Centered>
        <p className="muted" style={{ fontWeight: 500 }}>{t('regStatus.checking')}</p>
      </Centered>
    );

  if (state === 'invalid' || !row)
    return (
      <Centered>
        <h1 style={{ margin: '0 0 8px' }}>{t('regStatus.invalidTitle')}</h1>
        <p className="muted" style={{ fontWeight: 500 }}>{t('regStatus.invalidBody')}</p>
        <button className="btn btn-primary" onClick={() => navigate('/onboarding')}>
          {t('regStatus.startNew')}
        </button>
      </Centered>
    );

  if (row.status === 'changes_required')
    return (
      <Centered wide>
        <h1 style={{ margin: '0 0 8px' }}>{t('reg.changesTitle')}</h1>
        <div className="note warn" style={{ textAlign: 'left', margin: '12px 0' }}>
          <b>{t('reg.reason')}</b> {row.hqReason ?? '—'}
        </div>
        <p className="muted" style={{ fontWeight: 500 }}>{t('reg.changesBody')}</p>
        <button className="btn btn-primary" onClick={() => navigate('/register')}>
          {t('reg.editResubmit')}
        </button>
      </Centered>
    );

  if (row.status === 'declined')
    return (
      <Centered>
        <h1 style={{ margin: '0 0 8px' }}>{t('reg.declinedTitle')}</h1>
        <p className="muted" style={{ fontWeight: 500 }}>{t('reg.declinedBody')}</p>
        <button className="btn btn-primary" onClick={() => navigate('/onboarding')}>
          {t('regStatus.startNew')}
        </button>
      </Centered>
    );

  // pending_review / under_review / resubmitted: HQ has it.
  return (
    <Centered>
      <h1 style={{ margin: '0 0 8px' }}>{t('regStatus.pendingTitle')}</h1>
      <p className="muted" style={{ fontWeight: 500 }}>
        {t('regStatus.pendingBody', { salon: row.salonName, email: row.email })}
      </p>
      <button className="btn btn-primary" onClick={() => navigate('/login')}>
        {t('reg.backToSignIn')}
      </button>
    </Centered>
  );
}
