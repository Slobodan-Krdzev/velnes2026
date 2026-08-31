import { expect, test, type Page } from '@playwright/test';

/** The critical journeys, end to end against the real stack. */

const nextWednesday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7 || 7) + 7); // 8–14 days out
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('maria@velnes.mk');
  await page.getByLabel('Password').fill('velnes-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTitle('Maria Petrovska')).toBeVisible();
}

test('login → flightdeck shows the day and the timing stack', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Timing suggestions').first()).toBeVisible();
  // The seeded relearn case: Ana's 60 → 50 suggestion is on the stack.
  await expect(page.getByText(/Velnes suggests/).first()).toBeVisible();
});

test('book an appointment from the calendar drawer', async ({ page }) => {
  await login(page);
  await page.getByLabel('Calendar', { exact: true }).click();
  await page.getByRole('button', { name: 'Add' }).click();
  // The prototype's lade: pick a customer, set the line, book from the top.
  const svc = page.getByLabel('Service 1');
  const val = await svc.locator('option', { hasText: 'Follow-up session' }).getAttribute('value');
  await svc.selectOption(val ?? '');
  await page.getByLabel('Employee 1').selectOption('any');
  await page.getByLabel(/Date/).fill(nextWednesday());
  await page.getByLabel('Time 1').selectOption('10:00');
  await page.locator('.panel').getByLabel(/Customer/).selectOption({ label: 'Katerina Stojanovska' });
  const book = page.getByRole('button', { name: 'Book appointment' });
  await expect(book).toBeEnabled();
  await book.click();
  // The drawer closes on success.
  await expect(book).toBeHidden();
});

test('sell at the till and see the invoice + audit trail', async ({ page }) => {
  await login(page);
  await page.getByLabel('Cash register').click();
  await page.getByRole('button', { name: 'Services', exact: true }).click();
  await page.getByRole('button', { name: /Rehab training/ }).click();
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  const toast = page.getByRole('status');
  await expect(toast).toContainText(/(CEN|AER)-2026-/);
  const invoiceNo = (await toast.textContent())?.match(/(?:CEN|AER)-2026-\d+/)?.[0] ?? '';

  await page.getByRole('button', { name: 'Invoices' }).click();
  await expect(page.getByText(invoiceNo)).toBeVisible();

  await page.getByLabel('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Audit log' }).click();
  await expect(page.getByText('Sale', { exact: true }).first()).toBeVisible();
});

test('the whole chrome speaks Macedonian and Albanian', async ({ page }) => {
  await login(page);
  await page.getByTitle('Maria Petrovska').click();
  await page.getByRole('button', { name: 'Македонски' }).click();
  await expect(page.getByLabel('Календар')).toBeVisible();
  await page.getByTitle('Maria Petrovska').click();
  await page.getByRole('button', { name: 'Shqip' }).click();
  await expect(page.getByLabel('Kalendari')).toBeVisible();
  // Back to English for the next run.
  await page.getByTitle('Maria Petrovska').click();
  await page.getByRole('button', { name: 'English' }).click();
});
