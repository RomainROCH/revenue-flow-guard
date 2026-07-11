import { test as base, type Page, type Locator } from '@playwright/test';

export { expect } from '@playwright/test';

export class LoginPage {
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly errorMessage: Locator;

  constructor(public readonly page: Page) {
    this.usernameInput = page.getByLabel('Username');
    this.passwordInput = page.getByLabel('Password');
    this.signInButton = page.getByRole('button', { name: 'Sign in' });
    this.errorMessage = page.getByText('Invalid credentials');
  }
}

export class DashboardPage {
  readonly productCards: Locator;
  readonly cartBadge: Locator;

  constructor(public readonly page: Page) {
    this.productCards = page.getByRole('article');
    this.cartBadge = page.locator('#cart-badge');
  }
}

export class CheckoutPage {
  readonly nameInput: Locator;
  readonly addressInput: Locator;
  readonly cardInput: Locator;
  readonly placeOrderButton: Locator;
  readonly confirmationMessage: Locator;
  readonly orderId: Locator;
  readonly errorMessage: Locator;

  constructor(public readonly page: Page) {
    this.nameInput = page.getByLabel('Full Name');
    this.addressInput = page.getByLabel('Address');
    this.cardInput = page.getByLabel('Card Number');
    this.placeOrderButton = page.getByRole('button', { name: 'Place Order' });
    this.confirmationMessage = page.getByText(/order confirmed/i);
    this.orderId = page.locator('#order-id');
    this.errorMessage = page.locator('#checkout-error');
  }
}

type Fixtures = {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  checkoutPage: CheckoutPage;
};

export const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  checkoutPage: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },
});
