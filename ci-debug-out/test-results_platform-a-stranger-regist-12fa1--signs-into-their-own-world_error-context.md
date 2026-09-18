# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: platform.spec.ts >> a stranger registers, HQ activates, the owner signs into their own world
- Location: e2e/platform.spec.ts:22:5

# Error details

```
Error: locator.fill: Error: strict mode violation: getByLabel('Password') resolved to 2 elements:
    1) <input value="" class="input" type="password"/> aka getByRole('textbox', { name: 'Password', exact: true })
    2) <input value="" class="input" type="password"/> aka getByRole('textbox', { name: 'Confirm password' })

Call log:
  - waiting for getByLabel('Password')

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - generic [ref=e5]:
    - heading "Create your salon" [level=1] [ref=e6]
    - button "I have an account" [ref=e7] [cursor=pointer]
  - generic [ref=e8]:
    - button "1 · Account" [ref=e9] [cursor=pointer]
    - button "2 · Salon" [disabled] [ref=e10] [cursor=pointer]
    - button "3 · Company & legal" [disabled] [ref=e11] [cursor=pointer]
    - button "4 · Location" [disabled] [ref=e12] [cursor=pointer]
    - button "5 · Catalog" [disabled] [ref=e13] [cursor=pointer]
    - button "6 · Gallery" [disabled] [ref=e14] [cursor=pointer]
    - button "7 · Team & hours" [disabled] [ref=e15] [cursor=pointer]
    - button "8 · Review" [disabled] [ref=e16] [cursor=pointer]
  - generic [ref=e17]:
    - generic [ref=e18]:
      - generic [ref=e19]:
        - generic [ref=e20]:
          - generic [ref=e21]: Your name
          - textbox "Your name" [ref=e22]: Petra Novak
        - generic [ref=e23]:
          - generic [ref=e24]: E-mail
          - textbox "E-mail" [active] [ref=e25]:
            - /placeholder: you@salon.mk
            - text: petra-mu6zs0ik@studionova.mk
        - generic [ref=e26]:
          - generic [ref=e27]: Password
          - textbox "Password" [ref=e28]
        - generic [ref=e29]:
          - generic [ref=e30]: Confirm password
          - textbox "Confirm password" [ref=e31]
      - generic [ref=e32]: The verification e-mail goes to this address once the mail service is connected.
    - generic [ref=e33]:
      - button "Back" [disabled]
      - button "Next" [ref=e34] [cursor=pointer]
```

# Test source

```ts
  1   | import { expect, test, type Page } from '@playwright/test';
  2   | 
  3   | /**
  4   |  * The whole platform loop, across three apps against one API:
  5   |  * a stranger registers a salon → Revelapps HQ verifies and activates
  6   |  * → the new owner signs into their own tenant world; and the second
  7   |  * loop: an owner submits a new location → HQ approves (compound)
  8   |  * → the owner activates it behind the readiness gate.
  9   |  */
  10  | 
  11  | const runId = Date.now().toString(36);
  12  | const ownerEmail = `petra-${runId}@studionova.mk`;
  13  | 
  14  | async function hqSignIn(page: Page) {
  15  |   await page.goto('http://localhost:4177/');
  16  |   await page.getByLabel('Email').fill('damjan@revelapps.com');
  17  |   await page.getByLabel('Password').fill('velnes-demo');
  18  |   await page.getByRole('button', { name: 'Sign in' }).click();
  19  |   await expect(page.getByText('Signed in as Damjan Kostov · hq_onboard')).toBeVisible();
  20  | }
  21  | 
  22  | test('a stranger registers, HQ activates, the owner signs into their own world', async ({ page, context }) => {
  23  |   // ── The wizard, all eight steps.
  24  |   await page.goto('/register');
  25  |   await page.getByLabel('Your name').fill('Petra Novak');
  26  |   await page.getByLabel('E-mail').fill(ownerEmail);
> 27  |   await page.getByLabel('Password').fill('super-secret');
      |                                     ^ Error: locator.fill: Error: strict mode violation: getByLabel('Password') resolved to 2 elements:
  28  |   await page.getByRole('button', { name: 'Next' }).click();
  29  |   await page.getByLabel('Salon name').fill(`Studio Nova ${runId}`);
  30  |   await page.getByRole('button', { name: 'Next' }).click();
  31  |   await page.getByLabel('Legal name').fill('Nova Health DOO');
  32  |   await page.getByLabel('Tax number').fill('MK4032011501234');
  33  |   await page.getByRole('button', { name: 'Next' }).click();
  34  |   await page.getByLabel('Street').fill('Partizanska');
  35  |   await page.getByLabel('City').fill('Bitola');
  36  |   await page.getByTestId('regmap').click({ position: { x: 120, y: 90 } });
  37  |   await page.getByRole('button', { name: 'Next' }).click();
  38  |   await page.getByText('Physiotherapy session').click();
  39  |   await page.getByRole('button', { name: 'Next' }).click();
  40  |   await page.getByRole('button', { name: 'Next' }).click(); // gallery
  41  |   await expect(page.getByText('Invite your team')).toBeVisible();
  42  |   await page.getByRole('button', { name: 'Next' }).click();
  43  |   await page.getByRole('button', { name: 'Submit for review' }).click();
  44  |   await expect(page.getByText('Almost there')).toBeVisible();
  45  | 
  46  |   // ── HQ takes it from the intake table.
  47  |   const hq = await context.newPage();
  48  |   await hqSignIn(hq);
  49  |   const row = hq.locator('tr', { hasText: `Studio Nova ${runId}` });
  50  |   await expect(row.getByText('Awaiting SMTP')).toBeVisible();
  51  |   await row.getByRole('button', { name: 'Verify & activate' }).click();
  52  |   await expect(hq.getByText(new RegExp(ownerEmail))).toBeVisible();
  53  | 
  54  |   // ── The owner signs straight in with the wizard's password.
  55  |   await page.goto('/login');
  56  |   await page.getByLabel('Email').fill(ownerEmail);
  57  |   await page.getByLabel('Password').fill('super-secret');
  58  |   await page.getByRole('button', { name: 'Sign in' }).click();
  59  |   await expect(page.getByTitle('Petra Novak')).toBeVisible();
  60  |   // Their own world: the picked starter service, nobody else's data.
  61  |   await page.getByLabel('Settings', { exact: true }).click();
  62  |   await page.getByRole('button', { name: 'Locations', exact: true }).click();
  63  |   await expect(page.getByText(`Studio Nova ${runId}`).first()).toBeVisible();
  64  |   await expect(page.getByText('APPROVED').first()).toBeVisible();
  65  | });
  66  | 
  67  | test('an owner submits a new location, HQ approves the compound, the owner activates', async ({ page, context }) => {
  68  |   // ── Maria creates a copy of Centar with a NEW legal entity.
  69  |   await page.goto('/login');
  70  |   await page.getByLabel('Email').fill('maria@velnes.mk');
  71  |   await page.getByLabel('Password').fill('velnes-demo');
  72  |   await page.getByRole('button', { name: 'Sign in' }).click();
  73  |   await expect(page.getByTitle('Maria Petrovska')).toBeVisible();
  74  |   await page.getByLabel('Settings', { exact: true }).click();
  75  |   await page.getByRole('button', { name: 'Locations', exact: true }).click();
  76  |   await page.getByRole('button', { name: /Add location/ }).click();
  77  |   await page.getByText('Copy setup from an existing location').click();
  78  |   await page.getByRole('button', { name: 'Next' }).click();
  79  |   await page.getByLabel('Location name').fill(`Debar Maalo ${runId}`);
  80  |   await page.getByLabel('Street and number').fill('Orce Nikolov 55');
  81  |   await page.getByLabel('City', { exact: true }).fill('Skopje');
  82  |   await page.getByRole('button', { name: 'Next' }).click();
  83  |   await page.getByText('Create a new legal entity').click();
  84  |   await page.getByLabel('Legal name').fill(`Debar Fizio ${runId} DOOEL`);
  85  |   await page.getByLabel('Tax number').fill('MK4080009900112');
  86  |   await page.getByRole('button', { name: 'Next' }).click();
  87  |   await expect(page.getByText('Never copied:', { exact: false })).toBeVisible();
  88  |   await page.getByRole('button', { name: 'Next' }).click();
  89  |   await page.getByRole('button', { name: 'Submit for verification' }).click();
  90  |   const submittedRow = page.locator('.rowcard', { hasText: `Debar Maalo ${runId}` });
  91  |   await expect(submittedRow.getByText('SUBMITTED')).toBeVisible();
  92  | 
  93  |   // ── HQ reviews the compound and approves both in one act.
  94  |   const hq = await context.newPage();
  95  |   await hqSignIn(hq);
  96  |   const row = hq.locator('tr', { hasText: `Debar Maalo ${runId}` });
  97  |   await expect(row.getByText('new — compound')).toBeVisible();
  98  |   await row.getByRole('button', { name: 'Review' }).click();
  99  |   await expect(hq.getByText('Compound review', { exact: false })).toBeVisible();
  100 |   await hq.getByRole('button', { name: 'Approve location + entity' }).click();
  101 |   await expect(hq.getByText('Approved — the owner can activate when ready')).toBeVisible();
  102 | 
  103 |   // ── Back in the workspace: the readiness gate opens, Maria activates.
  104 |   await page.reload();
  105 |   await page.getByRole('button', { name: 'Locations', exact: true }).click();
  106 |   const card = page.locator('.rowcard', { hasText: `Debar Maalo ${runId}` });
  107 |   await expect(card.getByText('APPROVED')).toBeVisible();
  108 |   await card.getByRole('button', { name: 'Activate location' }).click();
  109 |   await expect(card.getByText('Active', { exact: true })).toBeVisible();
  110 | });
  111 | 
```