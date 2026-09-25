# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: platform.spec.ts >> a stranger registers, HQ activates, the owner signs into their own world
- Location: e2e/platform.spec.ts:24:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('tr').filter({ hasText: 'Studio Nova mugt4d41' }).getByText('Awaiting SMTP')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('tr').filter({ hasText: 'Studio Nova mugt4d41' }).getByText('Awaiting SMTP')

```

```yaml
- complementary:
  - navigation:
    - button "Customers"
    - button "Categories"
    - button "Suppliers"
    - button "Support tickets"
    - button "HQ team"
    - button "Search lab"
    - button "Platform log"
  - navigation:
    - button "Back to the salon workspace"
- banner:
  - heading "Revelapps HQ" [level=1]
  - button "Velnes news"
  - button "DK"
- main:
  - text: Businesses 4 accounts Signed in as Damjan Kostov · Onboarding Specialist
  - button "Add"
  - heading "New registrations" [level=2]
  - text: 2 awaiting verification
  - table:
    - rowgroup:
      - row "Salon Owner City Legal entity E-mail check":
        - columnheader "Salon"
        - columnheader "Owner"
        - columnheader "City"
        - columnheader "Legal entity"
        - columnheader "E-mail check"
        - columnheader
    - rowgroup:
      - row "Studio Nova mugt4d41 Assessment Petra Novak petra-mugt4d41@studionova.mk Bitola Nova Health DOO MK4032011501234 Not verified Verify & activate Request changes Decline":
        - cell "Studio Nova mugt4d41 Assessment"
        - cell "Petra Novak petra-mugt4d41@studionova.mk"
        - cell "Bitola"
        - cell "Nova Health DOO MK4032011501234"
        - cell "Not verified"
        - cell "Verify & activate Request changes Decline":
          - button "Verify & activate"
          - button "Request changes"
          - button "Decline"
      - row "Studio Nova mugt46yl Assessment Petra Novak petra-mugt46yl@studionova.mk Bitola Nova Health DOO MK4032011501234 Not verified Verify & activate Request changes Decline":
        - cell "Studio Nova mugt46yl Assessment"
        - cell "Petra Novak petra-mugt46yl@studionova.mk"
        - cell "Bitola"
        - cell "Nova Health DOO MK4032011501234"
        - cell "Not verified"
        - cell "Verify & activate Request changes Decline":
          - button "Verify & activate"
          - button "Request changes"
          - button "Decline"
  - text: Businesses 4 2 live Onboarding 2 Not finished yet Open tickets 2 Across all accounts Monthly revenue MKD 327 Subscriptions only
  - table:
    - rowgroup:
      - row "Business Owner Plan Locations Onboarding Last support access Status":
        - columnheader "Business"
        - columnheader "Owner"
        - columnheader "Plan"
        - columnheader "Locations"
        - columnheader "Onboarding"
        - columnheader "Last support access"
        - columnheader "Status"
        - columnheader
    - rowgroup:
      - row "Velnes Fizio Centar Skopje · since 2026-02-14 Maria Petrovska maria@velnes.mk Business 2 6 of 6 steps Never Live Open":
        - cell "Velnes Fizio Centar Skopje · since 2026-02-14"
        - cell "Maria Petrovska maria@velnes.mk"
        - cell "Business"
        - cell "2"
        - cell "6 of 6 steps"
        - cell "Never"
        - cell "Live"
        - cell "Open":
          - button "Open"
      - row "Vita Fizio Bitola · since 2026-07-28 Stefan Ristov stefan@vitafizio.mk Starter 1 3 of 6 steps Never Onboarding Open":
        - cell "Vita Fizio Bitola · since 2026-07-28"
        - cell "Stefan Ristov stefan@vitafizio.mk"
        - cell "Starter"
        - cell "1"
        - cell "3 of 6 steps"
        - cell "Never"
        - cell "Onboarding"
        - cell "Open":
          - button "Open"
      - row "Lumen Beauty Skopje · since 2026-05-02 Ana Gjorgieva ana@lumen.mk Business 2 5 of 6 steps Never Live Open":
        - cell "Lumen Beauty Skopje · since 2026-05-02"
        - cell "Ana Gjorgieva ana@lumen.mk"
        - cell "Business"
        - cell "2"
        - cell "5 of 6 steps"
        - cell "Never"
        - cell "Live"
        - cell "Open":
          - button "Open"
      - row "Spa Ohrid Ohrid · since 2026-08-04 Igor Petrov igor@spaohrid.mk Starter 1 1 of 6 steps Never Invited Open":
        - cell "Spa Ohrid Ohrid · since 2026-08-04"
        - cell "Igor Petrov igor@spaohrid.mk"
        - cell "Starter"
        - cell "1"
        - cell "1 of 6 steps"
        - cell "Never"
        - cell "Invited"
        - cell "Open":
          - button "Open"
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
  19  |   // The header names the role by its label now ("Onboarding
  20  |   // Specialist"), not its id; the name is what proves the sign-in.
  21  |   await expect(page.getByText(/Signed in as Damjan Kostov/)).toBeVisible();
  22  | }
  23  | 
  24  | test('a stranger registers, HQ activates, the owner signs into their own world', async ({ page, context }) => {
  25  |   // ── The wizard, all eight steps.
  26  |   await page.goto('/register');
  27  |   await page.getByLabel('Your name').fill('Petra Novak');
  28  |   await page.getByLabel('E-mail').fill(ownerEmail);
  29  |   // The wizard asks twice now; "Password" alone would match both.
  30  |   await page.getByLabel('Password', { exact: true }).fill('super-secret');
  31  |   await page.getByLabel('Confirm password').fill('super-secret');
  32  |   await page.getByRole('button', { name: 'Next' }).click();
  33  |   await page.getByLabel('Salon name').fill(`Studio Nova ${runId}`);
  34  |   await page.getByRole('button', { name: 'Next' }).click();
  35  |   await page.getByLabel('Legal name').fill('Nova Health DOO');
  36  |   await page.getByLabel('Tax number').fill('MK4032011501234');
  37  |   await page.getByRole('button', { name: 'Next' }).click();
  38  |   await page.getByLabel('Street').fill('Partizanska');
  39  |   await page.getByLabel('City').fill('Bitola');
  40  |   // The pin map is a real Leaflet map now, named for what it asks.
  41  |   await page
  42  |     .getByRole('application', { name: 'Drop the pin on your exact spot' })
  43  |     .click({ position: { x: 120, y: 90 } });
  44  |   await page.getByRole('button', { name: 'Next' }).click();
  45  |   // The catalog step is a form now: name a service, give it a
  46  |   // category, duration and price, add it — no starter list to tick.
  47  |   // Services come first on the step; the optional products form below
  48  |   // repeats "Category" and "Price (MKD)", so take the first of each.
  49  |   await page.getByLabel('Service name').fill('Physiotherapy session');
  50  |   await page.getByLabel('Category').first().selectOption({ label: 'Manual therapy' });
  51  |   await page.getByLabel('Duration (min)').fill('45');
  52  |   await page.getByLabel('Price (MKD)').first().fill('1800');
  53  |   await page.getByRole('button', { name: 'Add service' }).click();
  54  |   await expect(page.getByText('No services yet')).toBeHidden();
  55  |   await page.getByRole('button', { name: 'Next' }).click();
  56  |   await page.getByRole('button', { name: 'Next' }).click(); // gallery
  57  |   await expect(page.getByText('Invite your team')).toBeVisible();
  58  |   await page.getByRole('button', { name: 'Next' }).click();
  59  |   await page.getByRole('button', { name: 'Submit for review' }).click();
  60  |   await expect(page.getByText('Almost there')).toBeVisible();
  61  | 
  62  |   // ── HQ takes it from the intake table.
  63  |   const hq = await context.newPage();
  64  |   await hqSignIn(hq);
  65  |   const row = hq.locator('tr', { hasText: `Studio Nova ${runId}` });
> 66  |   await expect(row.getByText('Awaiting SMTP')).toBeVisible();
      |                                                ^ Error: expect(locator).toBeVisible() failed
  67  |   await row.getByRole('button', { name: 'Verify & activate' }).click();
  68  |   await expect(hq.getByText(new RegExp(ownerEmail))).toBeVisible();
  69  | 
  70  |   // ── The owner signs straight in with the wizard's password.
  71  |   await page.goto('/login');
  72  |   await page.getByLabel('Email').fill(ownerEmail);
  73  |   await page.getByLabel('Password').fill('super-secret');
  74  |   await page.getByRole('button', { name: 'Sign in' }).click();
  75  |   await expect(page.getByTitle('Petra Novak')).toBeVisible();
  76  |   // Their own world: the picked starter service, nobody else's data.
  77  |   await page.getByLabel('Settings', { exact: true }).click();
  78  |   await page.getByRole('button', { name: 'Locations', exact: true }).click();
  79  |   await expect(page.getByText(`Studio Nova ${runId}`).first()).toBeVisible();
  80  |   await expect(page.getByText('ACTIVE').first()).toBeVisible();
  81  | });
  82  | 
  83  | test('an owner submits a new location, HQ approves the compound, the owner activates', async ({ page, context }) => {
  84  |   // ── Maria creates a copy of Centar with a NEW legal entity.
  85  |   await page.goto('/login');
  86  |   await page.getByLabel('Email').fill('maria@velnes.mk');
  87  |   await page.getByLabel('Password').fill('velnes-demo');
  88  |   await page.getByRole('button', { name: 'Sign in' }).click();
  89  |   await expect(page.getByTitle('Maria Petrovska')).toBeVisible();
  90  |   await page.getByLabel('Settings', { exact: true }).click();
  91  |   await page.getByRole('button', { name: 'Locations', exact: true }).click();
  92  |   await page.getByRole('button', { name: /Add location/ }).click();
  93  |   await page.getByText('Copy setup from an existing location').click();
  94  |   await page.getByRole('button', { name: 'Next' }).click();
  95  |   await page.getByLabel('Location name').fill(`Debar Maalo ${runId}`);
  96  |   await page.getByLabel('Street and number').fill('Orce Nikolov 55');
  97  |   await page.getByLabel('City', { exact: true }).fill('Skopje');
  98  |   await page.getByRole('button', { name: 'Next' }).click();
  99  |   await page.getByText('Create a new legal entity').click();
  100 |   await page.getByLabel('Legal name').fill(`Debar Fizio ${runId} DOOEL`);
  101 |   await page.getByLabel('Tax number').fill('MK4080009900112');
  102 |   await page.getByRole('button', { name: 'Next' }).click();
  103 |   await expect(page.getByText('Never copied:', { exact: false })).toBeVisible();
  104 |   await page.getByRole('button', { name: 'Next' }).click();
  105 |   await page.getByRole('button', { name: 'Submit for verification' }).click();
  106 |   const submittedRow = page.locator('.rowcard', { hasText: `Debar Maalo ${runId}` });
  107 |   await expect(submittedRow.getByText('SUBMITTED')).toBeVisible();
  108 | 
  109 |   // ── HQ reviews the compound and approves both in one act.
  110 |   const hq = await context.newPage();
  111 |   await hqSignIn(hq);
  112 |   const row = hq.locator('tr', { hasText: `Debar Maalo ${runId}` });
  113 |   await expect(row.getByText('new — compound')).toBeVisible();
  114 |   await row.getByRole('button', { name: 'Review' }).click();
  115 |   await expect(hq.getByText('Compound review', { exact: false })).toBeVisible();
  116 |   await hq.getByRole('button', { name: 'Approve location + entity' }).click();
  117 |   await expect(hq.getByText('Approved — the owner can activate when ready')).toBeVisible();
  118 | 
  119 |   // ── Back in the workspace: the readiness gate opens, Maria activates.
  120 |   await page.reload();
  121 |   await page.getByRole('button', { name: 'Locations', exact: true }).click();
  122 |   const card = page.locator('.rowcard', { hasText: `Debar Maalo ${runId}` });
  123 |   await expect(card.getByText('APPROVED')).toBeVisible();
  124 |   await card.getByRole('button', { name: 'Activate location' }).click();
  125 |   await expect(card.getByText('Active', { exact: true })).toBeVisible();
  126 | });
  127 | 
```