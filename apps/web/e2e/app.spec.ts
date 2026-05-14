import { expect, test } from '@playwright/test'

test('captures and promotes an idea locally', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /dump idea/i }).click()
  await page.getByLabel(/what should not be lost/i).fill('E2E local-first idea')
  await page.getByRole('button', { name: /save locally/i }).click()
  await expect(page.locator('.idea-row strong').filter({ hasText: 'E2E local-first idea' })).toBeVisible()

  await page.getByRole('button', { name: /promote/i }).click()
  await page.getByPlaceholder(/why now/i).fill('It proves E2E')
  await page.getByLabel(/first concrete step/i).fill('Run the smoke test')
  await page.getByLabel(/done looks like/i).fill('The app keeps working')
  await page.getByRole('button', { name: /create project/i }).click()
  await expect(page.getByText('Commitment records')).toBeVisible()
})
