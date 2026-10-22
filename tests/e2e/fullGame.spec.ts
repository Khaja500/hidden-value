import { expect, test } from '@playwright/test';

test('plays a full game from the picker to settlement', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('./#/play');
  await expect(page.getByRole('heading', { name: 'Choose your table' })).toBeVisible();
  await page.getByTestId('start-medium').click();
  await expect(page.getByTestId('game')).toBeVisible();

  // Ask the Advisor once, then trade a little and pass the rest of the game.
  await page.getByRole('button', { name: /Ask the Advisor/ }).click();
  await expect(page.getByTestId('advice')).toBeVisible();

  const buy = page.getByRole('button', { name: /Buy 1/ });
  await buy.click();
  await expect(page.getByTestId('verdict')).not.toBeEmpty();
  await expect(page.locator('.feed__item--you').first()).toContainText('You bought 1');

  const sell = page.getByRole('button', { name: /Sell 1/ });
  await sell.click();
  // Space after a mouse click must pass, not repeat the click on the focused button.
  await page.keyboard.press('Space');
  await expect(page.locator('.feed__item--you').first()).toContainText('You passed');

  // 29 more steps: alternate the keyboard shortcut and the button.
  for (let i = 0; i < 29; i++) {
    if (i % 2 === 0) await page.keyboard.press('Space');
    else await page.getByRole('button', { name: /^Pass/ }).click();
  }

  const settlement = page.getByTestId('settlement');
  await expect(settlement).toBeVisible();
  await expect(settlement).toContainText('V =');
  await expect(page.locator('[data-card]')).toHaveCount(5);
  await expect(settlement.getByRole('link', { name: 'Review this game' })).toBeVisible();
  // The skill score is computed by replaying the deal in a Web Worker.
  await expect(settlement).not.toContainText('replaying…', { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('timed mode passes automatically when the countdown runs out', async ({ page }) => {
  await page.goto('./#/play');
  await page.getByLabel(/Timed/).check();
  await page.getByLabel('Seconds per step').fill('3');
  await page.getByTestId('start-easy').click();
  await expect(page.locator('.countdown')).toBeVisible();
  await expect(page.locator('.feed__item--you').first()).toContainText('You passed', { timeout: 8_000 });
});
