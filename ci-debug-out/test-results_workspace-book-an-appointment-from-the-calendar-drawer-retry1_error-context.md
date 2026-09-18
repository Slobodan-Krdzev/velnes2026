# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace.spec.ts >> book an appointment from the calendar drawer
- Location: e2e/workspace.spec.ts:26:5

# Error details

```
Error: locator.selectOption: Error: Element is not a <select> element
Call log:
  - waiting for locator('.panel').getByLabel(/Customer/)
    - locator resolved to <input value="" class="input" aria-label="Customer" placeholder="Search customers, or type a new name"/>
  - attempting select option action
    - waiting for element to be visible and enabled

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - complementary [ref=e3]:
    - generic [ref=e4]:
      - button "Flightdeck" [ref=e5] [cursor=pointer]
      - navigation [ref=e8]:
        - button "Calendar" [ref=e9] [cursor=pointer]
        - button "Cash register" [ref=e13] [cursor=pointer]
        - button "Catalog" [ref=e17] [cursor=pointer]
        - button "Suppliers" [ref=e21] [cursor=pointer]
        - button "Customers" [ref=e25] [cursor=pointer]
        - button "Marketing" [ref=e30] [cursor=pointer]
        - button "Reports" [ref=e34] [cursor=pointer]
    - navigation [ref=e38]:
      - button "Support" [ref=e39] [cursor=pointer]
      - button "Settings" [ref=e43] [cursor=pointer]
  - generic [ref=e47]:
    - banner [ref=e48]:
      - generic [ref=e49]:
        - heading "Calendar" [level=1] [ref=e50]
        - button "Booking All locations" [ref=e53] [cursor=pointer]:
          - generic [ref=e55]: Booking
          - generic [ref=e56]: All locations
      - generic [ref=e59]:
        - button "Search" [ref=e60] [cursor=pointer]
        - button "Velnes news" [ref=e65] [cursor=pointer]
        - button "MP" [ref=e70] [cursor=pointer]
    - main [ref=e71]:
      - generic [ref=e72]:
        - generic [ref=e73]:
          - button "Today" [ref=e74] [cursor=pointer]
          - generic [ref=e75]:
            - button "Previous" [ref=e76] [cursor=pointer]
            - button "Pick a date" [ref=e80] [cursor=pointer]: 18 Sep
            - button "Next" [ref=e81] [cursor=pointer]
          - button "Filters" [ref=e85] [cursor=pointer]
        - button "Add" [ref=e89] [cursor=pointer]
      - generic [ref=e92]:
        - generic [ref=e93]:
          - generic [ref=e94]: "18"
          - generic [ref=e96]: Ana Dimitrova
          - generic [ref=e99]: Elena Ristova
          - generic [ref=e102]: Maria Petrovska
        - generic [ref=e106]:
          - generic [ref=e107]:
            - generic [ref=e108]: 13:26
            - generic [ref=e109]: 08:00
            - generic [ref=e111]: 08:15
            - generic [ref=e113]: 08:30
            - generic [ref=e115]: 08:45
            - generic [ref=e117]: 09:00
            - generic [ref=e119]: 09:15
            - generic [ref=e121]: 09:30
            - generic [ref=e123]: 09:45
            - generic [ref=e125]: 10:00
            - generic [ref=e127]: 10:15
            - generic [ref=e129]: 10:30
            - generic [ref=e131]: 10:45
            - generic [ref=e133]: 11:00
            - generic [ref=e135]: 11:15
            - generic [ref=e137]: 11:30
            - generic [ref=e139]: 11:45
            - generic [ref=e141]: 12:00
            - generic [ref=e143]: 12:15
            - generic [ref=e145]: 12:30
            - generic [ref=e147]: 12:45
            - generic [ref=e149]: 13:00
            - generic [ref=e151]: 13:15
            - generic [ref=e153]: 13:30
            - generic [ref=e155]: 13:45
            - generic [ref=e157]: 14:00
            - generic [ref=e159]: 14:15
            - generic [ref=e161]: 14:30
            - generic [ref=e163]: 14:45
            - generic [ref=e165]: 15:00
            - generic [ref=e167]: 15:15
            - generic [ref=e169]: 15:30
            - generic [ref=e171]: 15:45
            - generic [ref=e173]: 16:00
            - generic [ref=e175]: 16:15
            - generic [ref=e177]: 16:30
            - generic [ref=e179]: 16:45
            - generic [ref=e181]: 17:00
            - generic [ref=e183]: 17:15
            - generic [ref=e185]: 17:30
            - generic [ref=e187]: 17:45
            - generic [ref=e189]: 18:00
            - generic [ref=e191]: 18:15
            - generic [ref=e193]: 18:30
            - generic [ref=e195]: 18:45
          - generic [ref=e197]:
            - button "New appointment 2026-09-18 08:00" [disabled] [ref=e198] [cursor=pointer]
            - button "New appointment 2026-09-18 08:15" [disabled] [ref=e199] [cursor=pointer]
            - button "New appointment 2026-09-18 08:30" [disabled] [ref=e200] [cursor=pointer]
            - button "New appointment 2026-09-18 08:45" [disabled] [ref=e201] [cursor=pointer]
            - button "New appointment 2026-09-18 09:00" [disabled] [ref=e202] [cursor=pointer]
            - button "New appointment 2026-09-18 09:15" [disabled] [ref=e203] [cursor=pointer]
            - button "New appointment 2026-09-18 09:30" [disabled] [ref=e204] [cursor=pointer]
            - button "New appointment 2026-09-18 09:45" [disabled] [ref=e205] [cursor=pointer]
            - button "New appointment 2026-09-18 10:00" [disabled] [ref=e206] [cursor=pointer]
            - button "New appointment 2026-09-18 10:15" [disabled] [ref=e207] [cursor=pointer]
            - button "New appointment 2026-09-18 10:30" [disabled] [ref=e208] [cursor=pointer]
            - button "New appointment 2026-09-18 10:45" [disabled] [ref=e209] [cursor=pointer]
            - button "New appointment 2026-09-18 11:00" [disabled] [ref=e210] [cursor=pointer]
            - button "New appointment 2026-09-18 11:15" [disabled] [ref=e211] [cursor=pointer]
            - button "New appointment 2026-09-18 11:30" [disabled] [ref=e212] [cursor=pointer]
            - button "New appointment 2026-09-18 11:45" [disabled] [ref=e213] [cursor=pointer]
            - button "New appointment 2026-09-18 12:00" [disabled] [ref=e214] [cursor=pointer]
            - button "New appointment 2026-09-18 12:15" [disabled] [ref=e215] [cursor=pointer]
            - button "New appointment 2026-09-18 12:30" [disabled] [ref=e216] [cursor=pointer]
            - button "New appointment 2026-09-18 12:45" [disabled] [ref=e217] [cursor=pointer]
            - button "New appointment 2026-09-18 13:00" [disabled] [ref=e218] [cursor=pointer]
            - button "New appointment 2026-09-18 13:15" [disabled] [ref=e219] [cursor=pointer]
            - button "New appointment 2026-09-18 13:30" [ref=e220] [cursor=pointer]
            - button "New appointment 2026-09-18 13:45" [ref=e221] [cursor=pointer]
            - button "New appointment 2026-09-18 14:00" [ref=e222] [cursor=pointer]
            - button "New appointment 2026-09-18 14:15" [ref=e223] [cursor=pointer]
            - button "New appointment 2026-09-18 14:30" [ref=e224] [cursor=pointer]
            - button "New appointment 2026-09-18 14:45" [ref=e225] [cursor=pointer]
            - button "New appointment 2026-09-18 15:00" [ref=e226] [cursor=pointer]
            - button "New appointment 2026-09-18 15:15" [ref=e227] [cursor=pointer]
            - button "New appointment 2026-09-18 15:30" [ref=e228] [cursor=pointer]
            - button "New appointment 2026-09-18 15:45" [ref=e229] [cursor=pointer]
            - button "New appointment 2026-09-18 16:00" [ref=e230] [cursor=pointer]
            - button "New appointment 2026-09-18 16:15" [ref=e231] [cursor=pointer]
            - button "New appointment 2026-09-18 16:30" [ref=e232] [cursor=pointer]
            - button "New appointment 2026-09-18 16:45" [ref=e233] [cursor=pointer]
            - button "New appointment 2026-09-18 17:00" [ref=e234] [cursor=pointer]
            - button "New appointment 2026-09-18 17:15" [ref=e235] [cursor=pointer]
            - button "New appointment 2026-09-18 17:30" [ref=e236] [cursor=pointer]
            - button "New appointment 2026-09-18 17:45" [ref=e237] [cursor=pointer]
            - button "New appointment 2026-09-18 18:00" [ref=e238] [cursor=pointer]
            - button "New appointment 2026-09-18 18:15" [ref=e239] [cursor=pointer]
            - button "New appointment 2026-09-18 18:30" [ref=e240] [cursor=pointer]
            - button "New appointment 2026-09-18 18:45" [ref=e241] [cursor=pointer]
          - generic [ref=e242]:
            - button "New appointment 2026-09-18 08:00" [disabled] [ref=e243] [cursor=pointer]
            - button "New appointment 2026-09-18 08:15" [disabled] [ref=e244] [cursor=pointer]
            - button "New appointment 2026-09-18 08:30" [disabled] [ref=e245] [cursor=pointer]
            - button "New appointment 2026-09-18 08:45" [disabled] [ref=e246] [cursor=pointer]
            - button "New appointment 2026-09-18 09:00" [disabled] [ref=e247] [cursor=pointer]
            - button "New appointment 2026-09-18 09:15" [disabled] [ref=e248] [cursor=pointer]
            - button "New appointment 2026-09-18 09:30" [disabled] [ref=e249] [cursor=pointer]
            - button "New appointment 2026-09-18 09:45" [disabled] [ref=e250] [cursor=pointer]
            - button "New appointment 2026-09-18 10:00" [disabled] [ref=e251] [cursor=pointer]
            - button "New appointment 2026-09-18 10:15" [disabled] [ref=e252] [cursor=pointer]
            - button "New appointment 2026-09-18 10:30" [disabled] [ref=e253] [cursor=pointer]
            - button "New appointment 2026-09-18 10:45" [disabled] [ref=e254] [cursor=pointer]
            - button "New appointment 2026-09-18 11:00" [disabled] [ref=e255] [cursor=pointer]
            - button "New appointment 2026-09-18 11:15" [disabled] [ref=e256] [cursor=pointer]
            - button "New appointment 2026-09-18 11:30" [disabled] [ref=e257] [cursor=pointer]
            - button "New appointment 2026-09-18 11:45" [disabled] [ref=e258] [cursor=pointer]
            - button "New appointment 2026-09-18 12:00" [disabled] [ref=e259] [cursor=pointer]
            - button "New appointment 2026-09-18 12:15" [disabled] [ref=e260] [cursor=pointer]
            - button "New appointment 2026-09-18 12:30" [disabled] [ref=e261] [cursor=pointer]
            - button "New appointment 2026-09-18 12:45" [disabled] [ref=e262] [cursor=pointer]
            - button "New appointment 2026-09-18 13:00" [disabled] [ref=e263] [cursor=pointer]
            - button "New appointment 2026-09-18 13:15" [disabled] [ref=e264] [cursor=pointer]
            - button "New appointment 2026-09-18 13:30" [ref=e265] [cursor=pointer]
            - button "New appointment 2026-09-18 13:45" [ref=e266] [cursor=pointer]
            - button "New appointment 2026-09-18 14:00" [ref=e267] [cursor=pointer]
            - button "New appointment 2026-09-18 14:15" [ref=e268] [cursor=pointer]
            - button "New appointment 2026-09-18 14:30" [ref=e269] [cursor=pointer]
            - button "New appointment 2026-09-18 14:45" [ref=e270] [cursor=pointer]
            - button "New appointment 2026-09-18 15:00" [ref=e271] [cursor=pointer]
            - button "New appointment 2026-09-18 15:15" [ref=e272] [cursor=pointer]
            - button "New appointment 2026-09-18 15:30" [ref=e273] [cursor=pointer]
            - button "New appointment 2026-09-18 15:45" [ref=e274] [cursor=pointer]
            - button "New appointment 2026-09-18 16:00" [ref=e275] [cursor=pointer]
            - button "New appointment 2026-09-18 16:15" [ref=e276] [cursor=pointer]
            - button "New appointment 2026-09-18 16:30" [ref=e277] [cursor=pointer]
            - button "New appointment 2026-09-18 16:45" [ref=e278] [cursor=pointer]
            - button "New appointment 2026-09-18 17:00" [ref=e279] [cursor=pointer]
            - button "New appointment 2026-09-18 17:15" [ref=e280] [cursor=pointer]
            - button "New appointment 2026-09-18 17:30" [ref=e281] [cursor=pointer]
            - button "New appointment 2026-09-18 17:45" [ref=e282] [cursor=pointer]
            - button "New appointment 2026-09-18 18:00" [ref=e283] [cursor=pointer]
            - button "New appointment 2026-09-18 18:15" [ref=e284] [cursor=pointer]
            - button "New appointment 2026-09-18 18:30" [ref=e285] [cursor=pointer]
            - button "New appointment 2026-09-18 18:45" [ref=e286] [cursor=pointer]
          - generic [ref=e287]:
            - button "New appointment 2026-09-18 08:00" [disabled] [ref=e288] [cursor=pointer]
            - button "New appointment 2026-09-18 08:15" [disabled] [ref=e289] [cursor=pointer]
            - button "New appointment 2026-09-18 08:30" [disabled] [ref=e290] [cursor=pointer]
            - button "New appointment 2026-09-18 08:45" [disabled] [ref=e291] [cursor=pointer]
            - button "New appointment 2026-09-18 09:00" [disabled] [ref=e292] [cursor=pointer]
            - button "New appointment 2026-09-18 09:15" [disabled] [ref=e293] [cursor=pointer]
            - button "New appointment 2026-09-18 09:30" [disabled] [ref=e294] [cursor=pointer]
            - button "New appointment 2026-09-18 09:45" [disabled] [ref=e295] [cursor=pointer]
            - button "New appointment 2026-09-18 10:00" [disabled] [ref=e296] [cursor=pointer]
            - button "New appointment 2026-09-18 10:15" [disabled] [ref=e297] [cursor=pointer]
            - button "New appointment 2026-09-18 10:30" [disabled] [ref=e298] [cursor=pointer]
            - button "New appointment 2026-09-18 10:45" [disabled] [ref=e299] [cursor=pointer]
            - button "New appointment 2026-09-18 11:00" [disabled] [ref=e300] [cursor=pointer]
            - button "New appointment 2026-09-18 11:15" [disabled] [ref=e301] [cursor=pointer]
            - button "New appointment 2026-09-18 11:30" [disabled] [ref=e302] [cursor=pointer]
            - button "New appointment 2026-09-18 11:45" [disabled] [ref=e303] [cursor=pointer]
            - button "New appointment 2026-09-18 12:00" [disabled] [ref=e304] [cursor=pointer]
            - button "New appointment 2026-09-18 12:15" [disabled] [ref=e305] [cursor=pointer]
            - button "New appointment 2026-09-18 12:30" [disabled] [ref=e306] [cursor=pointer]
            - button "New appointment 2026-09-18 12:45" [disabled] [ref=e307] [cursor=pointer]
            - button "New appointment 2026-09-18 13:00" [disabled] [ref=e308] [cursor=pointer]
            - button "New appointment 2026-09-18 13:15" [disabled] [ref=e309] [cursor=pointer]
            - button "New appointment 2026-09-18 13:30" [ref=e310] [cursor=pointer]
            - button "New appointment 2026-09-18 13:45" [ref=e311] [cursor=pointer]
            - button "New appointment 2026-09-18 14:00" [ref=e312] [cursor=pointer]
            - button "New appointment 2026-09-18 14:15" [ref=e313] [cursor=pointer]
            - button "New appointment 2026-09-18 14:30" [ref=e314] [cursor=pointer]
            - button "New appointment 2026-09-18 14:45" [ref=e315] [cursor=pointer]
            - button "New appointment 2026-09-18 15:00" [ref=e316] [cursor=pointer]
            - button "New appointment 2026-09-18 15:15" [ref=e317] [cursor=pointer]
            - button "New appointment 2026-09-18 15:30" [ref=e318] [cursor=pointer]
            - button "New appointment 2026-09-18 15:45" [ref=e319] [cursor=pointer]
            - button "New appointment 2026-09-18 16:00" [ref=e320] [cursor=pointer]
            - button "New appointment 2026-09-18 16:15" [ref=e321] [cursor=pointer]
            - button "New appointment 2026-09-18 16:30" [ref=e322] [cursor=pointer]
            - button "New appointment 2026-09-18 16:45" [ref=e323] [cursor=pointer]
            - button "New appointment 2026-09-18 17:00" [ref=e324] [cursor=pointer]
            - button "New appointment 2026-09-18 17:15" [ref=e325] [cursor=pointer]
            - button "New appointment 2026-09-18 17:30" [ref=e326] [cursor=pointer]
            - button "New appointment 2026-09-18 17:45" [ref=e327] [cursor=pointer]
            - button "New appointment 2026-09-18 18:00" [ref=e328] [cursor=pointer]
            - button "New appointment 2026-09-18 18:15" [ref=e329] [cursor=pointer]
            - button "New appointment 2026-09-18 18:30" [ref=e330] [cursor=pointer]
            - button "New appointment 2026-09-18 18:45" [ref=e331] [cursor=pointer]
      - dialog [ref=e333]:
        - generic [ref=e334]:
          - generic [ref=e335]:
            - generic [ref=e336]: Unsaved changes
            - generic [ref=e338]:
              - button "Book appointment" [disabled]
              - button "Close" [ref=e339] [cursor=pointer]
          - generic [ref=e343]:
            - heading [level=2] [ref=e344]:
              - text: New appointment
              - button "Rename" [ref=e345] [cursor=pointer]
            - paragraph [ref=e348]: Pick a customer, then add every service.
        - generic [ref=e349]:
          - generic [ref=e350]:
            - generic [ref=e351] [cursor=pointer]:
              - checkbox "Group appointment Several customers in the same slot" [ref=e352]
              - generic [ref=e353]:
                - generic [ref=e354]: Group appointment
                - generic [ref=e355]: Several customers in the same slot
            - generic [ref=e356] [cursor=pointer]:
              - checkbox "Blocked time Keeps the time free of bookings" [ref=e357]
              - generic [ref=e358]:
                - generic [ref=e359]: Blocked time
                - generic [ref=e360]: Keeps the time free of bookings
          - generic [ref=e361]:
            - generic [ref=e362]: Location*
            - combobox "Location" [ref=e363] [cursor=pointer]:
              - option "Aerodrom · Skopje" [selected]
              - option "Centar · Skopje"
              - option "Debar Maalo mu6zs3v7 · Skopje"
            - generic [ref=e364]: The appointment lands on this location’s calendar, catalog and prices.
          - generic [ref=e365]:
            - generic [ref=e366]: Customer*
            - textbox "Customer" [ref=e368]:
              - /placeholder: Search customers, or type a new name
          - generic [ref=e369]:
            - generic [ref=e370]: Date*
            - button "Date" [ref=e372] [cursor=pointer]: Sep 30, 2026
            - generic [ref=e373]: Any date, this week or months ahead — the calendar follows
          - generic [ref=e374]:
            - generic [ref=e375]: Services
            - generic [ref=e376]:
              - combobox "Service 1" [ref=e377] [cursor=pointer]:
                - option "Physiotherapy session · 45 min"
                - option "Manual therapy, spine · from MKD 1,900"
                - option "Follow-up session · 30 min" [selected]
                - option "Rehab training · 60 min"
                - option "Medical taping · 30 min"
                - option "Sports injury assessment · from MKD 1,400"
                - option "Posture screening · 30 min"
                - option "Sports massage · from MKD 1,900"
              - combobox "Employee 1" [ref=e378] [cursor=pointer]:
                - option "No preference" [selected]
                - option "Ana Dimitrova"
                - option "Maria Petrovska"
              - generic [ref=e379]:
                - combobox "Time 1" [ref=e380] [cursor=pointer]:
                  - option "08:00"
                  - option "08:15"
                  - option "08:30"
                  - option "08:45"
                  - option "09:00"
                  - option "09:15"
                  - option "09:30"
                  - option "09:45"
                  - option "10:00" [selected]
                  - option "10:15"
                  - option "10:30"
                  - option "10:45"
                  - option "11:00"
                  - option "11:15"
                  - option "11:30"
                  - option "11:45"
                  - option "12:00"
                  - option "12:15"
                  - option "12:30"
                  - option "12:45"
                  - option "13:00"
                  - option "13:15"
                  - option "13:30"
                  - option "13:45"
                  - option "14:00"
                  - option "14:15"
                  - option "14:30"
                  - option "14:45"
                  - option "15:00"
                  - option "15:15"
                  - option "15:30"
                  - option "15:45"
                  - option "16:00"
                  - option "16:15"
                  - option "16:30"
                  - option "16:45"
                  - option "17:00"
                  - option "17:15"
                  - option "17:30"
                  - option "17:45"
                  - option "18:00"
                  - option "18:15"
                  - option "18:30"
                  - option "18:45"
                - button "Remove service" [disabled]
            - button "Add service" [ref=e381] [cursor=pointer]
          - generic [ref=e384]:
            - generic [ref=e385]: Note for the team
            - textbox "Note for the team" [ref=e386]:
              - /placeholder: Anything the therapist should know before the patient arrives
          - button "Send a confirmation to the customer" [ref=e387] [cursor=pointer]
        - generic [ref=e393]:
          - generic [ref=e394]: Total
          - generic [ref=e395]: MKD 1,200 · 30 min
  - button "Open the assistant" [ref=e396] [cursor=pointer]
```

# Test source

```ts
  1  | import { expect, test, type Page } from '@playwright/test';
  2  | 
  3  | /** The critical journeys, end to end against the real stack. */
  4  | 
  5  | const nextWednesday = () => {
  6  |   const d = new Date();
  7  |   d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7 || 7) + 7); // 8–14 days out
  8  |   return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  9  | };
  10 | 
  11 | async function login(page: Page) {
  12 |   await page.goto('/login');
  13 |   await page.getByLabel('Email').fill('maria@velnes.mk');
  14 |   await page.getByLabel('Password').fill('velnes-demo');
  15 |   await page.getByRole('button', { name: 'Sign in' }).click();
  16 |   await expect(page.getByTitle('Maria Petrovska')).toBeVisible();
  17 | }
  18 | 
  19 | test('login → flightdeck shows the day and the timing stack', async ({ page }) => {
  20 |   await login(page);
  21 |   await expect(page.getByText('Timing suggestions').first()).toBeVisible();
  22 |   // The seeded relearn case: Ana's 60 → 50 suggestion is on the stack.
  23 |   await expect(page.getByText(/Velnes suggests/).first()).toBeVisible();
  24 | });
  25 | 
  26 | test('book an appointment from the calendar drawer', async ({ page }) => {
  27 |   await login(page);
  28 |   await page.getByLabel('Calendar', { exact: true }).click();
  29 |   await page.getByRole('button', { name: 'Add' }).click();
  30 |   // The prototype's lade: pick a customer, set the line, book from the top.
  31 |   const svc = page.getByLabel('Service 1');
  32 |   const val = await svc.locator('option', { hasText: 'Follow-up session' }).getAttribute('value');
  33 |   await svc.selectOption(val ?? '');
  34 |   await page.getByLabel('Employee 1').selectOption('any');
  35 |   // The date opens our own calendar now, never the browser's picker.
  36 |   const target = nextWednesday();
  37 |   await page.locator('.panel').getByLabel('Date', { exact: true }).click();
  38 |   const dlg = page.locator('.menu-cal');
  39 |   const wantMonth = new Date(`${target}T12:00:00`).toLocaleDateString('en', { month: 'long' });
  40 |   for (let i = 0; i < 2; i++) {
  41 |     if ((await dlg.locator('.calpick-title').textContent())?.includes(wantMonth)) break;
  42 |     await dlg.getByLabel('Next month').click();
  43 |   }
  44 |   await dlg
  45 |     .locator('.calpick-day:not(.out)')
  46 |     .filter({ hasText: new RegExp(`^${Number(target.slice(8))}$`) })
  47 |     .click();
  48 |   await page.getByLabel('Time 1').selectOption('10:00');
> 49 |   await page.locator('.panel').getByLabel(/Customer/).selectOption({ label: 'Katerina Stojanovska' });
     |                                                       ^ Error: locator.selectOption: Error: Element is not a <select> element
  50 |   const book = page.getByRole('button', { name: 'Book appointment' });
  51 |   await expect(book).toBeEnabled();
  52 |   await book.click();
  53 |   // The drawer closes on success.
  54 |   await expect(book).toBeHidden();
  55 | });
  56 | 
  57 | test('sell at the till and see the invoice + audit trail', async ({ page }) => {
  58 |   await login(page);
  59 |   await page.getByLabel('Cash register').click();
  60 |   await page.getByRole('button', { name: 'Services', exact: true }).click();
  61 |   await page.getByRole('button', { name: /Rehab training/ }).click();
  62 |   await page.getByRole('button', { name: 'Cash', exact: true }).click();
  63 |   const toast = page.getByRole('status');
  64 |   await expect(toast).toContainText(/(CEN|AER)-2026-/);
  65 |   const invoiceNo = (await toast.textContent())?.match(/(?:CEN|AER)-2026-\d+/)?.[0] ?? '';
  66 | 
  67 |   await page.getByRole('button', { name: 'Invoices' }).click();
  68 |   await expect(page.getByText(invoiceNo)).toBeVisible();
  69 | 
  70 |   await page.getByLabel('Settings', { exact: true }).click();
  71 |   await page.getByRole('button', { name: 'Audit log' }).click();
  72 |   await expect(page.getByText('Sale', { exact: true }).first()).toBeVisible();
  73 | });
  74 | 
  75 | test('the whole chrome speaks Macedonian and Albanian', async ({ page }) => {
  76 |   await login(page);
  77 |   await page.getByTitle('Maria Petrovska').click();
  78 |   await page.getByRole('button', { name: 'Македонски' }).click();
  79 |   await expect(page.getByLabel('Календар')).toBeVisible();
  80 |   await page.getByTitle('Maria Petrovska').click();
  81 |   await page.getByRole('button', { name: 'Shqip' }).click();
  82 |   await expect(page.getByLabel('Kalendari')).toBeVisible();
  83 |   // Back to English for the next run.
  84 |   await page.getByTitle('Maria Petrovska').click();
  85 |   await page.getByRole('button', { name: 'English' }).click();
  86 | });
  87 | 
```