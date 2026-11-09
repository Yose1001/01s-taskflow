import { expect, test } from '@playwright/test'
import {
  createProjectViaApi,
  createTaskViaApi,
  loginViaUi,
  newUser,
  openProject,
  submitLogin,
} from './helpers'

const html = (page: import('@playwright/test').Page) => page.locator('html')

test.describe('language and theme', () => {
  test('a visitor can switch language and theme, and the choice is remembered on this device', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()

    await page.getByRole('button', { name: 'Switch language to ไทย' }).click()
    await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible()
    await expect(html(page)).toHaveAttribute('lang', 'th')

    await page.getByRole('button', { name: 'เปลี่ยนเป็นธีมมืด' }).click()
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible()
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')
  })

  test('only two themes exist (light and dark)', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible()
    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible()
    await page.getByRole('button', { name: 'Switch to light theme' }).click()
    await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible()
  })

  test("a signed-in person's language and theme follow them to another device", async ({ page, request, context }) => {
    const { person } = await newUser(request, 'Alice')
    await loginViaUi(page, person)

    await page.getByRole('button', { name: 'Switch language to ไทย' }).click()
    await page.getByRole('button', { name: 'เปลี่ยนเป็นธีมมืด' }).click()
    await expect(page.getByRole('heading', { level: 1, name: `สวัสดี ${person.email}` })).toBeVisible()
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')

    // "Another device": a brand-new browser profile with nothing saved.
    const other = await context.browser()!.newContext()
    const fresh = await other.newPage()
    await fresh.goto('http://localhost:5174/login')
    await expect(fresh.getByRole('heading', { name: 'Log in' })).toBeVisible() // default English, light
    await submitLogin(fresh, person)
    await expect(fresh.getByRole('heading', { level: 1, name: `สวัสดี ${person.email}` })).toBeVisible()
    await expect(fresh.locator('html')).toHaveAttribute('data-theme', 'dark')
    await other.close()
  })

  test('the board works in Thai, with Thai dates', async ({ page, request }) => {
    const { person, token } = await newUser(request, 'Bea')
    const projectId = await createProjectViaApi(request, token, 'ร้านกาแฟ')
    await createTaskViaApi(request, token, projectId, { title: 'ออกแบบโลโก้', dueDate: '2099-12-01' })
    await loginViaUi(page, person)
    await page.getByRole('button', { name: 'Switch language to ไทย' }).click()
    await openProject(page, 'ร้านกาแฟ')
    await expect(page.getByRole('region', { name: 'รอทำ 1 งาน' })).toBeVisible()
    await expect(page.getByText('1 ธ.ค. 2642')).toBeVisible() // Buddhist-era year (2099 + 543)
  })
})
