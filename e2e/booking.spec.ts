import { expect, test } from '@playwright/test';

/** The public booking page, end to end against the real doors: slug →
 *  widget config → services → availability → hold → book. The visitor
 *  never authenticates; the publishable key is the only pass. */

test.use({ baseURL: 'http://localhost:4175' });

test('a visitor books through the hosted page', async ({ page }) => {
  await page.goto('/book/velnes-fizio');

  // Location step — the demo world has two live locations.
  await expect(page.getByText('Where would you like to come?')).toBeVisible();
  await expect(page.getByText('velnes.mk booking link')).toBeVisible();
  await page.getByRole('button', { name: /Centar/ }).click();

  // Service step — grouped, priced by the door.
  await expect(page.getByText('What can we do for you?')).toBeVisible();
  await page.getByRole('button', { name: /Follow-up session/ }).click();

  // Time step — pick a weekday far enough out to be inside opening
  // hours, then the first free slot.
  await expect(page.getByText('Who and when?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Any professional' })).toBeVisible();
  const days = page.locator('.bday');
  await days.last().click();
  const slot = page.locator('.bslot:not([disabled])').first();
  await expect(slot).toBeVisible();
  const slotTime = (await slot.textContent()) ?? '';
  await slot.click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Details — the hold countdown is running now.
  await expect(page.getByText('Your details')).toBeVisible();
  await expect(page.getByText(/This time is held for you/)).toBeVisible();
  await page.getByPlaceholder('Marija Stojanovska').fill('E2E Visitor');
  await page.getByPlaceholder('+389 70 000 000').fill('+389 70 555 444');
  await page.getByText(/cancellation policy/).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Confirm — honest no-provider payment story, then book.
  await expect(page.getByText('Confirm your booking')).toBeVisible();
  await expect(
    page.getByText('No payment up front. You settle everything in the salon.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Book the appointment' }).click();

  // Done — the door's reference and the chosen time echo back.
  await expect(page.getByText('Booked, E2E')).toBeVisible();
  await expect(page.getByText('Reference')).toBeVisible();
  await expect(page.getByText(new RegExp(slotTime.trim()))).toBeVisible();
});
