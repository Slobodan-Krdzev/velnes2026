import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { PhoneInput } from '@velnes/ui';

/** The one phone field: flag + prefix + national number in, one
 *  plain "+..." string out. Tested here because @velnes/ui carries
 *  no test runner of its own. */

function Harness({ initial = '', onValue }: { initial?: string; onValue: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <PhoneInput
      value={v}
      onChange={(next) => {
        setV(next);
        onValue(next);
      }}
      ariaLabel="Phone"
    />
  );
}

describe('PhoneInput', () => {
  afterEach(cleanup);

  it('defaults to the home market and emits one +389 string', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    expect(screen.getByRole('button', { name: 'Country code' }).textContent).toContain('+389');
    await userEvent.type(screen.getByLabelText('Phone'), '70 123 456');
    expect(onValue).toHaveBeenLastCalledWith('+389 70 123 456');
  });

  it('reads the country back out of a stored value', () => {
    render(<Harness initial="+31 6 12345678" onValue={() => {}} />);
    expect(screen.getByRole('button', { name: 'Country code' }).textContent).toContain('+31');
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('6 12345678');
  });

  it('switching country re-prefixes the same national number', async () => {
    const onValue = vi.fn();
    render(<Harness initial="+389 70 123 456" onValue={onValue} />);
    await userEvent.click(screen.getByRole('button', { name: 'Country code' }));
    await userEvent.type(screen.getByLabelText('Search country'), 'Albania');
    await userEvent.click(screen.getByRole('option', { name: /Albania/ }));
    expect(onValue).toHaveBeenLastCalledWith('+355 70 123 456');
  });

  it('a pasted full number re-picks the flag itself', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText('Phone');
    await userEvent.click(input);
    await userEvent.paste('+49 151 2345');
    expect(onValue).toHaveBeenLastCalledWith('+49 151 2345');
    expect(screen.getByRole('button', { name: 'Country code' }).textContent).toContain('+49');
  });

  it('an emptied number emits the empty string, not a bare prefix', async () => {
    const onValue = vi.fn();
    render(<Harness initial="+389 70" onValue={onValue} />);
    await userEvent.clear(screen.getByLabelText('Phone'));
    expect(onValue).toHaveBeenLastCalledWith('');
  });
});
