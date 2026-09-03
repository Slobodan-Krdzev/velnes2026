import { useEffect, useMemo, useRef, useState } from 'react';

/** One phone field for the whole system: a flag + dial-prefix picker
 *  and the national number. The value in and out stays one plain
 *  string ("+389 70 123 456"), so contracts, storage and seeds never
 *  change — this is presentation over the same truth. */

/* ITU dial codes by ISO 3166-1 alpha-2. The home market first. */
const CC: [string, string][] = [
  ['MK', '389'], ['AL', '355'], ['XK', '383'],
  ['AD', '376'], ['AE', '971'], ['AF', '93'], ['AG', '1268'], ['AI', '1264'],
  ['AM', '374'], ['AO', '244'], ['AR', '54'], ['AS', '1684'], ['AT', '43'],
  ['AU', '61'], ['AW', '297'], ['AZ', '994'], ['BA', '387'], ['BB', '1246'],
  ['BD', '880'], ['BE', '32'], ['BF', '226'], ['BG', '359'], ['BH', '973'],
  ['BI', '257'], ['BJ', '229'], ['BM', '1441'], ['BN', '673'], ['BO', '591'],
  ['BR', '55'], ['BS', '1242'], ['BT', '975'], ['BW', '267'], ['BY', '375'],
  ['BZ', '501'], ['CA', '1'], ['CD', '243'], ['CF', '236'], ['CG', '242'],
  ['CH', '41'], ['CI', '225'], ['CK', '682'], ['CL', '56'], ['CM', '237'],
  ['CN', '86'], ['CO', '57'], ['CR', '506'], ['CU', '53'], ['CV', '238'],
  ['CW', '599'], ['CY', '357'], ['CZ', '420'], ['DE', '49'], ['DJ', '253'],
  ['DK', '45'], ['DM', '1767'], ['DO', '1809'], ['DZ', '213'], ['EC', '593'],
  ['EE', '372'], ['EG', '20'], ['ER', '291'], ['ES', '34'], ['ET', '251'],
  ['FI', '358'], ['FJ', '679'], ['FM', '691'], ['FO', '298'], ['FR', '33'],
  ['GA', '241'], ['GB', '44'], ['GD', '1473'], ['GE', '995'], ['GH', '233'],
  ['GI', '350'], ['GL', '299'], ['GM', '220'], ['GN', '224'], ['GQ', '240'],
  ['GR', '30'], ['GT', '502'], ['GU', '1671'], ['GW', '245'], ['GY', '592'],
  ['HK', '852'], ['HN', '504'], ['HR', '385'], ['HT', '509'], ['HU', '36'],
  ['ID', '62'], ['IE', '353'], ['IL', '972'], ['IN', '91'], ['IQ', '964'],
  ['IR', '98'], ['IS', '354'], ['IT', '39'], ['JM', '1876'], ['JO', '962'],
  ['JP', '81'], ['KE', '254'], ['KG', '996'], ['KH', '855'], ['KI', '686'],
  ['KM', '269'], ['KN', '1869'], ['KP', '850'], ['KR', '82'], ['KW', '965'],
  ['KY', '1345'], ['RU', '7'], ['KZ', '7'], ['LA', '856'], ['LB', '961'], ['LC', '1758'],
  ['LI', '423'], ['LK', '94'], ['LR', '231'], ['LS', '266'], ['LT', '370'],
  ['LU', '352'], ['LV', '371'], ['LY', '218'], ['MA', '212'], ['MC', '377'],
  ['MD', '373'], ['ME', '382'], ['MG', '261'], ['MH', '692'], ['ML', '223'],
  ['MM', '95'], ['MN', '976'], ['MO', '853'], ['MR', '222'], ['MS', '1664'],
  ['MT', '356'], ['MU', '230'], ['MV', '960'], ['MW', '265'], ['MX', '52'],
  ['MY', '60'], ['MZ', '258'], ['NA', '264'], ['NC', '687'], ['NE', '227'],
  ['NG', '234'], ['NI', '505'], ['NL', '31'], ['NO', '47'], ['NP', '977'],
  ['NR', '674'], ['NU', '683'], ['NZ', '64'], ['OM', '968'], ['PA', '507'],
  ['PE', '51'], ['PF', '689'], ['PG', '675'], ['PH', '63'], ['PK', '92'],
  ['PL', '48'], ['PR', '1787'], ['PS', '970'], ['PT', '351'], ['PW', '680'],
  ['PY', '595'], ['QA', '974'], ['RO', '40'], ['RS', '381'],
  ['RW', '250'], ['SA', '966'], ['SB', '677'], ['SC', '248'], ['SD', '249'],
  ['SE', '46'], ['SG', '65'], ['SI', '386'], ['SK', '421'], ['SL', '232'],
  ['SM', '378'], ['SN', '221'], ['SO', '252'], ['SR', '597'], ['SS', '211'],
  ['ST', '239'], ['SV', '503'], ['SY', '963'], ['SZ', '268'], ['TC', '1649'],
  ['TD', '235'], ['TG', '228'], ['TH', '66'], ['TJ', '992'], ['TL', '670'],
  ['TM', '993'], ['TN', '216'], ['TO', '676'], ['TR', '90'], ['TT', '1868'],
  ['TV', '688'], ['TW', '886'], ['TZ', '255'], ['UA', '380'], ['UG', '256'],
  ['US', '1'], ['UY', '598'], ['UZ', '998'], ['VC', '1784'], ['VE', '58'],
  ['VN', '84'], ['VU', '678'], ['WS', '685'], ['YE', '967'], ['ZA', '27'],
  ['ZM', '260'], ['ZW', '263'],
];

const flagOf = (iso: string) =>
  String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/** Split a stored "+38970123456"-ish string into country + rest.
 *  Longest dial-code match wins; ties go to the list order, so the
 *  home market beats other +389s and the US beats the NANP islands. */
function parsePhone(value: string): { iso: string; dial: string; national: string } {
  // Only leading whitespace goes: the tail is what is being typed.
  const v = value.replace(/^\s+/, '');
  if (v.startsWith('+')) {
    const digits = v.slice(1).replace(/\D/g, '');
    let best: [string, string] | null = null;
    for (const [iso, dial] of CC)
      if (digits.startsWith(dial) && (!best || dial.length > best[1].length)) best = [iso, dial];
    if (best) {
      const rest = v.slice(1 + best[1].length).replace(/^[\s-]+/, '');
      return { iso: best[0], dial: best[1], national: rest };
    }
  }
  // No/unknown prefix: keep what was typed under the home country.
  return { iso: 'MK', dial: '389', national: v.replace(/^\+/, '') };
}

export function PhoneInput({
  value,
  onChange,
  id,
  placeholder,
  disabled,
  lang = 'en',
  ariaLabel,
  searchLabel = 'Search country',
  countryLabel = 'Country code',
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  /** UI language for the country names (Intl.DisplayNames). */
  lang?: string;
  ariaLabel?: string;
  searchLabel?: string;
  countryLabel?: string;
}) {
  const parsed = parsePhone(value);
  // The chosen flag survives an emptied number; the parsed one wins
  // whenever the value itself names a country.
  const [chosen, setChosen] = useState<string | null>(null);
  const cur = value.trim().startsWith('+')
    ? parsed
    : (() => {
        const iso = chosen ?? parsed.iso;
        return { iso, dial: CC.find(([i]) => i === iso)?.[1] ?? '389', national: parsed.national };
      })();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([lang], { type: 'region' });
    } catch {
      return new Intl.DisplayNames(['en'], { type: 'region' });
    }
  }, [lang]);
  const nameOf = (iso: string) => {
    try {
      return names.of(iso) ?? iso;
    } catch {
      return iso;
    }
  };

  // The national part keeps its spacing while being typed — trimming
  // here would eat the separator the user just wrote.
  const emit = (dial: string, national: string) =>
    onChange(national.trim() ? `+${dial} ${national.replace(/^\s+/, '')}` : '');

  const ql = q.trim().toLowerCase();
  const rows = CC.filter(
    ([iso, dial]) =>
      !ql || nameOf(iso).toLowerCase().includes(ql) || `+${dial}`.includes(ql) || dial.includes(ql),
  );

  return (
    <div className="pop" ref={ref} style={{ display: 'flex', gap: 8 }}>
      <button
        type="button"
        className="input"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={countryLabel}
        disabled={disabled}
        onClick={() => {
          setQ('');
          setOpen((v) => !v);
        }}
        style={{
          width: 'auto',
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
          {flagOf(cur.iso)}
        </span>
        <span className="tnum">+{cur.dial}</span>
      </button>
      <input
        id={id}
        className="input"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        aria-label={ariaLabel}
        placeholder={placeholder ?? '70 123 456'}
        disabled={disabled}
        value={cur.national}
        onChange={(e) => {
          const raw = e.target.value;
          // A pasted full number (leading +) re-picks the flag itself.
          if (raw.trim().startsWith('+')) {
            const p = parsePhone(raw);
            setChosen(p.iso);
            emit(p.dial, p.national);
          } else {
            emit(cur.dial, raw.replace(/[^\d\s()-]/g, ''));
          }
        }}
        style={{ flex: 1, minWidth: 0 }}
      />
      {open ? (
        <div
          className="menu menu-left"
          role="listbox"
          style={{ top: 'calc(100% + 6px)', maxHeight: 320, overflowY: 'auto', minWidth: 260 }}
        >
          <div style={{ padding: '4px 6px 8px' }}>
            <input
              ref={searchRef}
              className="input"
              aria-label={searchLabel}
              placeholder={searchLabel}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ height: 36 }}
            />
          </div>
          {rows.map(([iso, dial]) => (
            <button
              key={iso}
              type="button"
              role="option"
              aria-selected={iso === cur.iso}
              className="menu-row"
              onClick={() => {
                setChosen(iso);
                emit(dial, cur.national);
                setOpen(false);
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 17 }}>
                {flagOf(iso)}
              </span>
              <span className="grow" style={{ textAlign: 'left', fontWeight: 500 }}>
                {nameOf(iso)}
              </span>
              <span className="muted tnum">+{dial}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
