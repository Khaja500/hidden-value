import { expect, test } from '@playwright/test';

test('placeholder page loads', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Hidden Value' })).toBeVisible();
});
