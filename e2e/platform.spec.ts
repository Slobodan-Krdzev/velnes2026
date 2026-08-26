import { expect, test, type Page } from '@playwright/test';

/**
 * The whole platform loop, across three apps against one API:
 * a stranger registers a salon → Revelapps HQ verifies and activates
 * → the new owner signs into their own tenant world; and the second
 * loop: an owner submits a new location → HQ approves (compound)
 * → the owner activates it behind the readiness gate.
 */

const runId = Date.now().toString(36);
const ownerEmail = `petra-${runId}@studionova.mk`;

async function hqSignIn(page: Page) {
  await page.goto('http://localhost:4177/');
  await page.getByLabel('Email').fill('damjan@revelapps.com');
  await page.getByLabel('Password').fill('velnes-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Signed in as Damjan Kostov · hq_onboard')).toBeVisible();
}

test('a stranger registers, HQ activates, the owner signs into their own world', async ({ page, context }) => {
  // ── The wizard, all eight steps.
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Petra Novak');
  await page.getByLabel('E-mail').fill(ownerEmail);
  await page.getByLabel('Password').fill('super-secret');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Salon name').fill(`Studio Nova ${runId}`);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Legal name').fill('Nova Health DOO');
  await page.getByLabel('Tax number').fill('MK4032011501234');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Street').fill('Partizanska');
  await page.getByLabel('City').fill('Bitola');
  await page.getByTestId('regmap').click({ position: { x: 120, y: 90 } });
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('Physiotherapy session').click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click(); // gallery
  await expect(page.getByText('Invite your team')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Almost there')).toBeVisible();

  // ── HQ takes it from the intake table.
  const hq = await context.newPage();
  await hqSignIn(hq);
  const row = hq.locator('tr', { hasText: `Studio Nova ${runId}` });
  await expect(row.getByText('Awaiting SMTP')).toBeVisible();
  await row.getByRole('button', { name: 'Verify & activate' }).click();
  await expect(hq.getByText(new RegExp(ownerEmail))).toBeVisible();

  // ── The owner signs straight in with the wizard's password.
  await page.goto('/login');
  await page.getByLabel('Email').fill(ownerEmail);
  await page.getByLabel('Password').fill('super-secret');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTitle('Petra Novak')).toBeVisible();
  // Their own world: the picked starter service, nobody else's data.
  await page.getByLabel('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Locations', exact: true }).click();
  await expect(page.getByText(`Studio Nova ${runId}`).first()).toBeVisible();
  await expect(page.getByText('APPROVED').first()).toBeVisible();
});

test('an owner submits a new location, HQ approves the compound, the owner activates', async ({ page, context }) => {
  // ── Maria creates a copy of Centar with a NEW legal entity.
  await page.goto('/login');
  await page.getByLabel('Email').fill('maria@velnes.mk');
  await page.getByLabel('Password').fill('velnes-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTitle('Maria Petrovska')).toBeVisible();
  await page.getByLabel('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Locations', exact: true }).click();
  await page.getByRole('button', { name: /Add location/ }).click();
  await page.getByText('Copy setup from an existing location').click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Location name').fill(`Debar Maalo ${runId}`);
  await page.getByLabel('Street and number').fill('Orce Nikolov 55');
  await page.getByLabel('City', { exact: true }).fill('Skopje');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('Create a new legal entity').click();
  await page.getByLabel('Legal name').fill(`Debar Fizio ${runId} DOOEL`);
  await page.getByLabel('Tax number').fill('MK4080009900112');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Never copied:', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit for verification' }).click();
  const submittedRow = page.locator('.rowcard', { hasText: `Debar Maalo ${runId}` });
  await expect(submittedRow.getByText('SUBMITTED')).toBeVisible();

  // ── HQ reviews the compound and approves both in one act.
  const hq = await context.newPage();
  await hqSignIn(hq);
  const row = hq.locator('tr', { hasText: `Debar Maalo ${runId}` });
  await expect(row.getByText('new — compound')).toBeVisible();
  await row.getByRole('button', { name: 'Review' }).click();
  await expect(hq.getByText('Compound review', { exact: false })).toBeVisible();
  await hq.getByRole('button', { name: 'Approve location + entity' }).click();
  await expect(hq.getByText('Approved — the owner can activate when ready')).toBeVisible();

  // ── Back in the workspace: the readiness gate opens, Maria activates.
  await page.reload();
  await page.getByRole('button', { name: 'Locations', exact: true }).click();
  const card = page.locator('.rowcard', { hasText: `Debar Maalo ${runId}` });
  await expect(card.getByText('APPROVED')).toBeVisible();
  await card.getByRole('button', { name: 'Activate location' }).click();
  await expect(card.getByText('Active', { exact: true })).toBeVisible();
});
