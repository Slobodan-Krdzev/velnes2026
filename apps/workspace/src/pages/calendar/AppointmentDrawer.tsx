import type { Appointment, Employee } from '@velnes/contracts';
import { Badge, Button, Field, Input } from '@velnes/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAvailability,
  useBook,
  useCancelAppointment,
  useCustomers,
  useLineQuote,
  useLocationCatalog,
} from '../../api/queries.js';
import { refusalText } from '../../refusal.js';

const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();

export function AppointmentDrawer({
  locationId,
  date: initialDate,
  appointment,
  employees,
  onClose,
}: {
  locationId: string;
  date: string;
  appointment: Appointment | null;
  employees: Employee[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const catalog = useLocationCatalog(locationId);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [mods, setMods] = useState<string[]>([]);
  const [employeeId, setEmployeeId] = useState<string>('any');
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState<string | null>(null);
  const [custQuery, setCustQuery] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [custName, setCustName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(uuid);

  const book = useBook();
  const cancel = useCancelAppointment();
  const editing = !!appointment;

  const service = useMemo(
    () => catalog.data?.services.find((s) => s.id === serviceId) ?? null,
    [catalog.data, serviceId],
  );
  const bookable = useMemo(
    () =>
      (catalog.data?.services ?? []).filter((s) => s.config.active && s.config.online),
    [catalog.data],
  );
  const skilled = useMemo(
    () =>
      employees.filter(
        (e) => !serviceId || !e.skillServiceIds.length || e.skillServiceIds.includes(serviceId),
      ),
    [employees, serviceId],
  );

  const quote = useLineQuote(
    serviceId
      ? {
          serviceId,
          locationId,
          variantId,
          modifierOptionIds: mods,
          employeeId: employeeId === 'any' ? null : employeeId,
        }
      : null,
  );
  const availability = useAvailability({ locationId, serviceId, employeeId, date, variantId });
  const customers = useCustomers(custQuery);

  const submit = async () => {
    if (!serviceId || !time) return;
    setError(null);
    try {
      await book.mutateAsync({
        key,
        locationId,
        serviceId,
        date,
        time,
        employeeId: employeeId as 'any',
        variantId,
        modifierOptionIds: mods,
        ...(customerId ? { customerId } : custName ? { name: custName } : {}),
        source: 'staff',
        deposit: 0,
      });
      onClose();
    } catch (e) {
      setError(refusalText(t, e));
    }
  };

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>{editing ? t('drawer.title.edit') : t('drawer.title.new')}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </header>

        {editing && appointment ? (
          <div className="drawer-body">
            <p>
              <strong>{appointment.title}</strong>
            </p>
            <p className="muted">
              {appointment.serviceName} · {appointment.date} {appointment.start}–{appointment.end}
            </p>
            {appointment.basis ? (
              <Badge tone="accent">{t(`drawer.durationBasis.${appointment.basis}`)}</Badge>
            ) : null}
            <p className="tnum">
              {t('drawer.price')}: {appointment.price} ден
            </p>
            {appointment.status !== 'cancelled' ? (
              <Button
                variant="danger"
                onClick={() => void cancel.mutateAsync(appointment.id).then(onClose)}
              >
                {t('drawer.cancelAppointment')}
              </Button>
            ) : (
              <Badge tone="danger">{t('cal.cancelled')}</Badge>
            )}
          </div>
        ) : (
          <div className="drawer-body">
            <Field label={t('drawer.service')}>
              <select
                className="input"
                value={serviceId ?? ''}
                onChange={(e) => {
                  setServiceId(e.target.value || null);
                  setVariantId(null);
                  setMods([]);
                  setTime(null);
                }}
              >
                <option value="">{t('drawer.pickService')}</option>
                {bookable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.config.price} ден
                  </option>
                ))}
              </select>
            </Field>

            {service && service.variants.filter((v) => v.active).length > 0 ? (
              <Field label={t('drawer.variant')}>
                <div className="chip-row">
                  {service.variants
                    .filter((v) => v.active)
                    .map((v) => (
                      <button
                        key={v.id}
                        className={`chip${variantId === v.id || (!variantId && v.std) ? ' on' : ''}`}
                        onClick={() => {
                          setVariantId(v.id);
                          setTime(null);
                        }}
                      >
                        {v.label} · {v.price} ден
                      </button>
                    ))}
                </div>
              </Field>
            ) : null}

            {service && service.modifiers.length > 0 ? (
              <Field label={t('drawer.options')}>
                <div className="mod-groups">
                  {service.modifiers.map((g) => (
                    <div key={g.id} className="mod-group">
                      <span className="muted">
                        {g.name}
                        {g.required ? ' *' : ''}
                      </span>
                      <div className="chip-row">
                        {g.options.map((o) => {
                          const on = mods.includes(o.id);
                          return (
                            <button
                              key={o.id}
                              className={`chip${on ? ' on' : ''}`}
                              onClick={() =>
                                setMods((m) =>
                                  g.type === 'single'
                                    ? on
                                      ? m.filter((x) => !g.options.some((oo) => oo.id === x))
                                      : [...m.filter((x) => !g.options.some((oo) => oo.id === x)), o.id]
                                    : on
                                      ? m.filter((x) => x !== o.id)
                                      : [...m, o.id],
                                )
                              }
                            >
                              {o.name}
                              {o.price ? ` · ${o.price > 0 ? '+' : ''}${o.price}` : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </Field>
            ) : null}

            <Field label={t('drawer.employee')}>
              <select
                className="input"
                value={employeeId}
                onChange={(e) => {
                  setEmployeeId(e.target.value);
                  setTime(null);
                }}
              >
                <option value="any">{t('drawer.anyEmployee')}</option>
                {skilled.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t('drawer.date')}>
              <Input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setTime(null);
                }}
              />
            </Field>

            {serviceId ? (
              <Field label={t('drawer.time')}>
                {availability.data?.slots.some((s) => s.free) ? (
                  <div className="slot-grid">
                    {availability.data.slots
                      .filter((s) => s.free)
                      .map((s) => (
                        <button
                          key={s.t}
                          className={`chip tnum${time === s.t ? ' on' : ''}`}
                          onClick={() => setTime(s.t)}
                        >
                          {s.t}
                        </button>
                      ))}
                  </div>
                ) : (
                  <p className="muted">{t('drawer.noSlots')}</p>
                )}
              </Field>
            ) : null}

            <Field label={t('drawer.customer')}>
              {customerId ? (
                <div className="chip-row">
                  <button className="chip on" onClick={() => setCustomerId(null)}>
                    {custName} ✕
                  </button>
                </div>
              ) : (
                <>
                  <Input
                    placeholder={t('drawer.customerSearch')}
                    value={custQuery}
                    onChange={(e) => setCustQuery(e.target.value)}
                  />
                  {custQuery && customers.data ? (
                    <div className="cust-list">
                      {customers.data.customers.slice(0, 5).map((c) => (
                        <button
                          key={c.id}
                          className="cust-row"
                          onClick={() => {
                            setCustomerId(c.id);
                            setCustName(c.name);
                            setCustQuery('');
                          }}
                        >
                          {c.name}
                          {c.blacklisted ? <Badge tone="danger">!</Badge> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </Field>

            {quote.data ? (
              <div className="quote card">
                <span className="tnum">
                  {t('drawer.price')}: <strong>{quote.data.price} ден</strong>
                </span>
                <span className="tnum">
                  {t('drawer.duration')}: <strong>{t('drawer.minutes', { count: quote.data.treatmentMin })}</strong>{' '}
                  <span className="muted">({t(`drawer.durationBasis.${quote.data.basis}`)})</span>
                </span>
              </div>
            ) : null}

            {error ? (
              <p className="error-text" role="alert">
                {error}
              </p>
            ) : null}

            <Button disabled={!serviceId || !time || book.isPending} onClick={() => void submit()}>
              {book.isPending ? t('drawer.booking') : t('drawer.book')}
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}
