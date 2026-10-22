import { expect, test } from '@playwright/test';

test('research page renders every section from the simulation files', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./#/research');
  for (const h of [
    'Are the beliefs calibrated?',
    'More informed traders: who survives?',
    'Risk aversion: profit against inventory risk',
    'Where each market maker’s P&L comes from',
    'Are the explanations faithful?',
    'Does following the Advisor make money?',
  ]) {
    await expect(page.getByRole('heading', { name: h })).toBeVisible();
  }
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await expect(page.getByText('No results in public/research')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('sandbox runs a simulation in the worker', async ({ page }) => {
  await page.goto('./#/sandbox');
  await page.getByLabel('Games').fill('10');
  await page.getByTestId('run-sandbox').click();
  await expect(page.getByText('Market maker P&L per game').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('section:has(h2:text("Your runs")) tbody tr')).toHaveCount(1);
});
