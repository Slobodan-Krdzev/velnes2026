# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: booking.spec.ts >> a visitor books through the hosted page
- Location: e2e/booking.spec.ts:9:5

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.fill: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByPlaceholder('+389 70 000 000')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e9]:
        - text: Velnes Fizio Centar
        - generic [ref=e10]: velnes.mk booking link
      - button "Close" [ref=e11] [cursor=pointer]
    - generic [ref=e12]:
      - generic "Location" [ref=e13]
      - generic "Service" [ref=e14]
      - generic "Time" [ref=e15]
      - generic "Details" [ref=e16]
      - generic "Payment" [ref=e17]
      - generic "Done" [ref=e18]
    - generic [ref=e19]:
      - generic [ref=e20]:
        - generic [ref=e21]: Step 4 of 5 · Details
        - generic [ref=e22]: Centar · Follow-up session · MKD 1,200
      - generic [ref=e23]:
        - text: This time is held for you —
        - generic [ref=e27]: 9:02
        - text: left.
      - heading "Your details" [level=2] [ref=e28]
      - generic [ref=e29]:
        - generic [ref=e30]:
          - generic [ref=e31]: Name*
          - textbox "Name*" [active] [ref=e32]:
            - /placeholder: Marija Stojanovska
            - text: E2E Visitor
        - generic [ref=e33]:
          - generic [ref=e34]: Phone*
          - generic [ref=e35]:
            - button "Country code" [ref=e36] [cursor=pointer]:
              - generic [ref=e37]: 🇲🇰
              - generic [ref=e38]: "+389"
            - textbox "Phone" [ref=e39]:
              - /placeholder: 70 000 000
        - generic [ref=e40]:
          - generic [ref=e41]: Email
          - textbox "Email Your confirmation and any change go here" [ref=e42]:
            - /placeholder: you@example.com
          - generic [ref=e43]: Your confirmation and any change go here
      - 'button "I agree to the cancellation policy: free until 24 hours before." [ref=e44] [cursor=pointer]'
      - generic [ref=e49]:
        - button "Change time" [ref=e50] [cursor=pointer]
        - button "Continue" [disabled]
  - paragraph [ref=e53]:
    - text: Booked through Velnes · source recorded as
    - strong [ref=e54]: Velnes booking link
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
  34 |   await expect(page.getByText('Your details')).toBeVisible();
  35 |   await expect(page.getByText(/This time is held for you/)).toBeVisible();
  36 |   await page.getByPlaceholder('Marija Stojanovska').fill('E2E Visitor');
> 37 |   await page.getByPlaceholder('+389 70 000 000').fill('+389 70 555 444');
     |                                                  ^ Error: locator.fill: Test timeout of 60000ms exceeded.
  38 |   await page.getByText(/cancellation policy/).click();
  39 |   await page.getByRole('button', { name: 'Continue' }).click();
  40 | 
  41 |   // Confirm — honest no-provider payment story, then book.
  42 |   await expect(page.getByText('Confirm your booking')).toBeVisible();
  43 |   await expect(
  44 |     page.getByText('No payment up front. You settle everything in the salon.'),
  45 |   ).toBeVisible();
  46 |   await page.getByRole('button', { name: 'Book the appointment' }).click();
  47 | 
  48 |   // Done — the door's reference and the chosen time echo back.
  49 |   await expect(page.getByText('Booked, E2E')).toBeVisible();
  50 |   await expect(page.getByText('Reference')).toBeVisible();
  51 |   await expect(page.getByText(new RegExp(slotTime.trim()))).toBeVisible();
  52 | });
  53 | 
```