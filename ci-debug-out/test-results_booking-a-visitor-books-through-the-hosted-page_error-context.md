# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: booking.spec.ts >> a visitor books through the hosted page
- Location: e2e/booking.spec.ts:9:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Your details')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Your details')

```

```yaml
- text: Velnes Fizio Centar velnes.mk booking link
- button "Close"
- text: Step 3 of 5 · Time Centar · Follow-up session · MKD 1,200
- heading "Who and when?" [level=2]
- text: Professional
- button "Any professional"
- button "Maria"
- text: Day
- button "Today 2 Oct"
- button "Sat 3 Oct"
- button "Mon 5 Oct"
- button "Tue 6 Oct"
- button "Wed 7 Oct"
- button "Thu 8 Oct"
- button "Fri 9 Oct"
- button "Sat 10 Oct"
- button "Mon 12 Oct"
- button "Tue 13 Oct"
- button "Wed 14 Oct"
- button "Thu 15 Oct"
- button "Fri 16 Oct"
- button "Sat 17 Oct"
- text: Time
- button "08:00" [disabled]
- button "08:15" [disabled]
- button "08:30" [disabled]
- button "08:45" [disabled]
- button "09:00"
- button "09:15"
- button "09:30"
- button "09:45"
- button "10:00"
- button "10:15"
- button "10:30"
- button "10:45"
- button "11:00"
- button "11:15"
- button "11:30"
- button "11:45"
- button "12:00"
- button "12:15"
- button "12:30"
- button "12:45"
- button "13:00"
- button "13:15"
- button "13:30"
- button "13:45"
- button "14:00"
- button "14:15"
- button "14:30" [disabled]
- button "14:45" [disabled]
- button "15:00" [disabled]
- button "15:15" [disabled]
- button "15:30" [disabled]
- button "15:45" [disabled]
- button "16:00" [disabled]
- button "16:15" [disabled]
- button "16:30" [disabled]
- button "16:45" [disabled]
- button "17:00" [disabled]
- button "17:15" [disabled]
- button "17:30" [disabled]
- button "17:45" [disabled]
- button "18:00" [disabled]
- button "18:15" [disabled]
- text: Times come straight from the salon calendar, including cleaning time between appointments.
- alert: Centar is open 09:00–15:00 on Saturdays
- button "Change service"
- button "Continue"
- paragraph:
  - text: Booked through Velnes · source recorded as
  - strong: Velnes booking link
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | 
  3  | /** The public booking page, end to end against the real doors: slug →
  4  |  *  widget config → services → availability → hold → book. The visitor
  5  |  *  never authenticates; the publishable key is the only pass. */
  6  | 
  7  | test.use({ baseURL: 'http://localhost:4175' });
  8  | 
  9  | test('a visitor books through the hosted page', async ({ page }) => {
  10 |   await page.goto('/book/velnes-fizio');
  11 | 
  12 |   // Location step — the demo world has two live locations.
  13 |   await expect(page.getByText('Where would you like to come?')).toBeVisible();
  14 |   await expect(page.getByText('velnes.mk booking link')).toBeVisible();
  15 |   await page.getByRole('button', { name: /Centar/ }).click();
  16 | 
  17 |   // Service step — grouped, priced by the door.
  18 |   await expect(page.getByText('What can we do for you?')).toBeVisible();
  19 |   await page.getByRole('button', { name: /Follow-up session/ }).click();
  20 | 
  21 |   // Time step — pick a weekday far enough out to be inside opening
  22 |   // hours, then the first free slot.
  23 |   await expect(page.getByText('Who and when?')).toBeVisible();
  24 |   await expect(page.getByRole('button', { name: 'Any professional' })).toBeVisible();
  25 |   const days = page.locator('.bday');
  26 |   await days.last().click();
  27 |   const slot = page.locator('.bslot:not([disabled])').first();
  28 |   await expect(slot).toBeVisible();
  29 |   const slotTime = (await slot.textContent()) ?? '';
  30 |   await slot.click();
  31 |   await page.getByRole('button', { name: 'Continue' }).click();
  32 | 
  33 |   // Details — the hold countdown is running now.
> 34 |   await expect(page.getByText('Your details')).toBeVisible();
     |                                                ^ Error: expect(locator).toBeVisible() failed
  35 |   await expect(page.getByText(/This time is held for you/)).toBeVisible();
  36 |   await page.getByPlaceholder('Marija Stojanovska').fill('E2E Visitor');
  37 |   // The phone is a country picker (+389 by default) and a national
  38 |   // number — not one free-text field any more.
  39 |   await page.getByLabel('Phone', { exact: true }).fill('70 555 444');
  40 |   await page.getByText(/cancellation policy/).click();
  41 |   await page.getByRole('button', { name: 'Continue' }).click();
  42 | 
  43 |   // Confirm — honest no-provider payment story, then book.
  44 |   await expect(page.getByText('Confirm your booking')).toBeVisible();
  45 |   await expect(
  46 |     page.getByText('No payment up front. You settle everything in the salon.'),
  47 |   ).toBeVisible();
  48 |   await page.getByRole('button', { name: 'Book the appointment' }).click();
  49 | 
  50 |   // Done — the door's reference and the chosen time echo back.
  51 |   await expect(page.getByText('Booked, E2E')).toBeVisible();
  52 |   await expect(page.getByText('Reference')).toBeVisible();
  53 |   await expect(page.getByText(new RegExp(slotTime.trim()))).toBeVisible();
  54 | });
  55 | 
```