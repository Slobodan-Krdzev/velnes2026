import type { Appointment, Employee } from '@velnes/contracts';
import { Badge, Button, Field, I, Icon, Input } from '@velnes/ui';
import { useEffect, useMemo, useState } from 'react';
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
  time: initialTime,
  employeeId: initialEmp,
  appointment,
  employees,
  onClose,
}: {
  locationId: string;
  date: string;
  time: string | null;
  employeeId: string | null;
  appointment: Appointment | null;
  employees: Employee[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const catalog = useLocationCatalog(locationId);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [mods, setMods] = useState<string[]>([]);
  const [employeeId, setEmployeeId] = useState<string>(initialEmp ?? 'any');
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState<string | null>(initialTime);
  const [custQuery, setCustQuery] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [custName, setCustName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(uuid);

  const book = useBook();
  const cancel = useCancelAppointment();
  const editing = !!appointment;

  // The prototype squeezes the page while the panel is open.
  useEffect(() => {
    document.body.classList.add('panel-open');
    return () => document.body.classList.remove('panel-open');
  }, []);

  const service = useMemo(
    () => catalog.data?.services.find((s) => s.id === serviceId) ?? null,
    [catalog.data, serviceId],
  );
  const bookable = useMemo(
    () => (catalog.data?.services ?? []).filter((s) => s.config.active && s.config.online),
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
    <>
      <div className="scrim on" onClick={onClose} />
      <aside className="panel open" role="dialog" aria-modal="true">
        <div className="panel-head plain">
          <div>
            <h2>{editing ? t('drawer.title.edit') : t('drawer.title.new')}</h2>
          </div>
          <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
            <Icon d={I.x} size={22} w={2.2} />
          </button>
        </div>

        {editing && appointment ? (
          <div className="panel-body">
            <p style={{ fontWeight: 700, fontSize: 16 }}>{appointment.title}</p>
            <p style={{ color: 'var(--ink-muted)', fontWeight: 500 }}>
              {appointment.serviceName} · {appointment.date} {appointment.start}–{appointment.end}
            </p>
            {appointment.basis ? (
              <div>
                <Badge tone="accent">{t(`drawer.durationBasis.${appointment.basis}`)}</Badge>
              </div>
            ) : null}
            <p className="tnum" style={{ fontWeight: 600 }}>
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
              <div>
                <Badge tone="danger">{t('cal.cancelled')}</Badge>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="panel-body">
              <Field label={t('drawer.service')} required>
                <select
                  className="select"
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
                  <div className="chips">
                    {service.variants
                      .filter((v) => v.active)
                      .map((v) => (
                        <button
                          key={v.id}
                          type="button"
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

              {service && service.modifiers.length > 0
                ? service.modifiers.map((g) => (
                    <Field key={g.id} label={g.name} required={g.required}>
                      <div className="chips">
                        {g.options.map((o) => {
                          const on = mods.includes(o.id);
                          return (
                            <button
                              key={o.id}
                              type="button"
                              className={`chip${on ? ' on' : ''}`}
                              onClick={() =>
                                setMods((m) =>
                                  g.type === 'single'
                                    ? on
                                      ? m.filter((x) => !g.options.some((oo) => oo.id === x))
                                      : [
                                          ...m.filter((x) => !g.options.some((oo) => oo.id === x)),
                                          o.id,
                                        ]
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
                    </Field>
                  ))
                : null}

              <Field label={t('drawer.employee')}>
                <select
                  className="select"
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

              <Field label={t('drawer.date')} required>
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
                <Field label={t('drawer.time')} required>
                  {availability.data?.slots.some((s) => s.free) ? (
                    <div className="chips" style={{ maxHeight: 170, overflowY: 'auto' }}>
                      {availability.data.slots
                        .filter((s) => s.free)
                        .map((s) => (
                          <button
                            key={s.t}
                            type="button"
                            className={`chip tnum${time === s.t ? ' on' : ''}`}
                            onClick={() => setTime(s.t)}
                          >
                            {s.t}
                          </button>
                        ))}
                    </div>
                  ) : (
                    <span className="hint">{t('drawer.noSlots')}</span>
                  )}
                </Field>
              ) : null}

              <Field label={t('drawer.customer')}>
                {customerId ? (
                  <div className="chips">
                    <button type="button" className="chip on" onClick={() => setCustomerId(null)}>
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
                      <div className="menu-scroll" style={{ display: 'grid' }}>
                        {customers.data.customers.slice(0, 5).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="menu-row"
                            onClick={() => {
                              setCustomerId(c.id);
                              setCustName(c.name);
                              setCustQuery('');
                            }}
                          >
                            <span className="grow">
                              <span className="mi-t">{c.name}</span>
                              <span className="mi-s">
                                {c.visits} visits{c.blacklisted ? ' · blacklisted' : ''}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </Field>

              {quote.data ? (
                <div
                  className="card"
                  style={{
                    display: 'flex',
                    gap: 18,
                    padding: '12px 14px',
                    background: 'var(--accent-tint)',
                    borderColor: 'var(--accent-line)',
                  }}
                >
                  <span className="tnum">
                    {t('drawer.price')}: <strong>{quote.data.price} ден</strong>
                  </span>
                  <span className="tnum">
                    {t('drawer.duration')}:{' '}
                    <strong>{t('drawer.minutes', { count: quote.data.treatmentMin })}</strong>{' '}
                    <span style={{ color: 'var(--ink-muted)' }}>
                      ({t(`drawer.durationBasis.${quote.data.basis}`)})
                    </span>
                  </span>
                </div>
              ) : null}

              {error ? (
                <p className="error-text" role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
                  {error}
                </p>
              ) : null}
            </div>
            <div className="panel-foot">
              <Button variant="ghost" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button disabled={!serviceId || !time || book.isPending} onClick={() => void submit()}>
                {book.isPending ? t('drawer.booking') : t('drawer.book')}
              </Button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
