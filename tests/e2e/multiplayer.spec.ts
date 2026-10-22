import { expect, test, type Page } from '@playwright/test';

/** Sets up a table from the multiplayer page. */
async function setUp(page: Page, names: string[], table: string) {
  await page.goto('./#/multiplayer');
  await expect(
    page.getByRole('heading', { name: /Trade against the market maker, and each other/ }),
  ).toBeVisible();
  await page.getByTestId(`players-${names.length}`).click();
  for (let i = 0; i < names.length; i++) await page.getByLabel(`Name of player ${i + 1}`).fill(names[i]);
  await page.getByTestId(`table-${table}`).click();
  await page.getByTestId('party-start').click();
  await expect(page.getByTestId('party')).toBeVisible();
}

/** Plays one turn: hand-off, reveal, then the action. Returns whose turn it was. */
async function playTurn(page: Page, action: 'buy' | 'sell' | 'pass' | 'key-pass'): Promise<string> {
  const handoff = page.getByTestId('handoff');
  await expect(handoff).toBeVisible();
  // Nothing private is on screen during a hand-off: every visible card face is a public reveal.
  await expect(page.locator('[data-role="private"]')).toHaveCount(0);
  const name = (await handoff.locator('.handoff__name').textContent()) ?? '';
  if (action === 'key-pass') await page.keyboard.press('Enter');
  else await page.getByTestId('show-turn').click();
  const turn = page.getByTestId('turn');
  await expect(turn).toContainText(`${name}’s turn`);
  await expect(turn.locator('[data-role="private"]')).toHaveCount(1);
  if (action === 'buy') await turn.getByRole('button', { name: /Buy 1/ }).click();
  else if (action === 'sell') await turn.getByRole('button', { name: /Sell 1/ }).click();
  else if (action === 'key-pass') await page.keyboard.press('Space');
  else await turn.getByRole('button', { name: /^Pass/ }).click();
  return name;
}

test('two players play a full game on one screen, with hand-offs between turns', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setUp(page, ['Ada', 'Ben'], 'medium');

  // Step 1: Ada acts first, then Ben; at step 2 Ben goes first.
  expect(await playTurn(page, 'buy')).toBe('Ada');
  await expect(page.locator('.feed__item--you').first()).toContainText('Ada bought 1');
  await expect(page.getByTestId('seat-0')).toContainText('+1');

  // Ben asks the Advisor before selling.
  await page.getByTestId('show-turn').click();
  await expect(page.getByTestId('turn')).toContainText('Ben’s turn');
  await page.getByRole('button', { name: /Ask the Advisor/ }).click();
  await expect(page.getByTestId('advice')).toBeVisible();
  // Hiding the card mid-turn goes back to the hand-off screen for the same player.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('handoff')).toContainText('Ben');
  await page.getByTestId('show-turn').click();
  await page
    .getByTestId('turn')
    .getByRole('button', { name: /Sell 1/ })
    .click();
  await expect(page.locator('.feed__item--you').first()).toContainText('Ben sold 1');

  expect(await playTurn(page, 'pass')).toBe('Ben');
  expect(await playTurn(page, 'key-pass')).toBe('Ada');

  // The remaining 30 steps × 2 players.
  for (let i = 0; i < 60; i++) await playTurn(page, i % 2 ? 'pass' : 'key-pass');

  const results = page.getByTestId('party-results');
  await expect(results).toBeVisible();
  await expect(results).toContainText('V =');
  await expect(results.getByRole('row')).toHaveCount(3);
  await expect(page.getByTestId('standing-0')).toBeVisible();
  // Every card is face up after settlement, labelled with its holder.
  await expect(page.locator('.party__cards [data-card]')).toHaveCount(5);
  await expect(page.locator('.party__cards')).toContainText('Ada’s');
  // One hint was used, by Ben.
  await expect(page.getByTestId('seat-1')).toContainText('1 hint');

  await page.getByTestId('rematch').click();
  await expect(page.getByTestId('handoff')).toBeVisible();
  expect(errors).toEqual([]);
});

test("with three players, a player's card is revealed in round 4", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setUp(page, ['Ada', 'Ben', 'Cy'], 'hard');
  for (let i = 0; i < 32 * 3; i++) await playTurn(page, i % 3 === 0 ? 'key-pass' : 'pass');
  await expect(page.getByTestId('party-results')).toBeVisible();
  // Round 4's reveal was one of the players' cards, and the feed says whose.
  await expect(page.locator('.feed__item--reveal').first()).toContainText(/(Ada|Ben|Cy)’s card/);
  await expect(page.locator('.party__cards')).toContainText(/revealed R4/);
});

test('four players play a full Expert game; two players’ cards go public', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setUp(page, ['Ada', 'Ben', 'Cy', 'Di'], 'expert');
  for (let i = 0; i < 32 * 4; i++) await playTurn(page, i % 9 === 0 ? 'buy' : i % 2 ? 'pass' : 'key-pass');
  await expect(page.getByTestId('party-results')).toBeVisible();
  await expect(page.getByTestId('party-results').getByRole('row')).toHaveCount(5);
  await expect(page.locator('.party__cards')).toContainText(/revealed R3/);
  await expect(page.locator('.party__cards')).toContainText(/revealed R4/);
  expect(errors).toEqual([]);
});
