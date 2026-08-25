import { expect, test } from '@playwright/test';

/**
 * The supplier chain end to end, two apps against one API: the salon
 * builds and submits an order (the live buy-10-get-2 promotion adds
 * its free units by itself), the portal accepts → processes → ships
 * it with a tracking number, and the salon receives with real counts
 * — a shortage keeps it open as partially delivered, and only the
 * good units reach stock.
 */

test('an order travels the whole chain: salon → supplier portal → back into stock', async ({ page, context }) => {
  // ── The salon submits an order to BeautyPro.
  await page.goto('/login');
  await page.getByLabel('Email').fill('maria@velnes.mk');
  await page.getByLabel('Password').fill('velnes-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTitle('Maria Petrovska')).toBeVisible();
  await page.getByLabel('Suppliers', { exact: true }).click();
  await expect(page.getByText(/customer number MK-4821/)).toBeVisible();
  await page
    .locator('.rowcard', { hasText: 'BeautyPro MK' })
    .getByRole('button', { name: 'New order' })
    .click();

  const qty = page.getByLabel('Qty Thera-Band resistance set, 3 levels');
  await qty.fill('20');
  await expect(page.getByRole('button', { name: 'Submit order' })).toBeEnabled();
  await page.getByRole('button', { name: 'Submit order' }).click();
  await expect(page.getByText('Order submitted — the supplier takes it from here')).toBeVisible();

  // The new order sits in the table as Submitted.
  const row = page.locator('tr', { hasText: 'Submitted' }).first();
  const ref = (await row.locator('.bold').first().textContent()) ?? '';
  expect(ref).toMatch(/^(CEN|AER)-.*\d{4}$/);

  // ── The portal walks its side.
  const portal = await context.newPage();
  await portal.goto('http://localhost:4176/');
  await portal.getByLabel('Email').fill('vesna@beautypro.mk');
  await portal.getByLabel('Password').fill('velnes-demo');
  await portal.getByRole('button', { name: 'Sign in' }).click();
  await expect(portal.getByText('Connected salons')).toBeVisible();
  await portal.getByRole('button', { name: 'Orders' }).click();
  const prow = portal.locator('tr', { hasText: ref });
  await prow.getByRole('button', { name: 'Accept' }).click();
  await prow.getByRole('button', { name: 'Start processing' }).click();
  await prow.getByPlaceholder('Tracking number').fill('MK-PARCEL-91000');
  await prow.getByRole('button', { name: 'Ship' }).click();
  await expect(portal.getByText('Shipped — the salon receives and counts')).toBeVisible();

  // ── Back at the salon: receive with a shortage. Reload first —
  // the orders list is cached and does not know about the shipment.
  await page.reload();
  await expect(page.getByText(/customer number MK-4821/)).toBeVisible();
  await page.getByRole('button', { name: 'Deliveries' }).click();
  await page
    .locator('.rowcard', { hasText: ref })
    .getByRole('button', { name: 'Receive' })
    .click();
  await expect(page.getByText('Count what actually arrived')).toBeVisible();
  await expect(page.getByText('incl. 4 free')).toBeVisible(); // the promotion's units
  await page.getByLabel(/Received Thera-Band/).fill('20');
  await page.getByLabel(/Damaged Thera-Band/).fill('2');
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(page.getByText(new RegExp(`${ref} partially received`))).toBeVisible();
});
