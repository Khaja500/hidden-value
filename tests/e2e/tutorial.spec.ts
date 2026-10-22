import { expect, test } from '@playwright/test';

test('the tutorial runs end to end and opens a review', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./#/tutorial');
  await expect(page.getByRole('heading', { name: 'The asset' })).toBeVisible();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Next →' }).click();
  await expect(page.getByRole('heading', { name: 'The Advisor' })).toBeVisible();
  await page.getByTestId('start-tutorial').click();

  // Advisor is always on, and the first tip explains the first decision.
  await expect(page.getByTestId('advice')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('King');
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: /Buy 1/ }).click();
  await expect(page.getByTestId('verdict')).toContainText('trade');

  for (let i = 0; i < 31; i++) {
    const tip = page.getByRole('button', { name: 'Got it' });
    if (await tip.isVisible()) await tip.click();
    await page.getByRole('button', { name: /^Pass/ }).click();
  }
  await expect(page.getByTestId('settlement')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Review');
  await page.getByRole('link', { name: 'Review this game' }).click();
  await expect(page.getByRole('heading', { name: /You (made|lost|broke even)/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await expect(page.getByText('the market maker’s brain')).toBeVisible();
  await page.getByRole('button', { name: 'Next →' }).click();
  await expect(page.getByText(/Round 1, step 2/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('daily challenge is ranked: no Advisor, and the score lands on the leaderboard', async ({ page }) => {
  await page.goto('./#/daily');
  await page.getByTestId('start-daily').click();
  await expect(page.getByRole('button', { name: /Ask the Advisor/ })).toHaveCount(0);
  for (let i = 0; i < 32; i++) await page.keyboard.press('Space');
  await expect(page.getByTestId('settlement')).toBeVisible();
  await page.goto('./#/');
  await page.goto('./#/daily');
  await expect(page.getByText('First attempt (ranked)')).toBeVisible();
});
