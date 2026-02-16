const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Opening the app...');
  await page.goto('https://thinkthyme1.github.io/MCR-forms/');
  
  // Wait for page to load
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  console.log('Page title:', await page.title());
  
  // Try to find and click the PIN input
  console.log('Looking for PIN input...');
  const pinInput = await page.locator('input[type="text"]').first();
  
  if (await pinInput.isVisible()) {
    console.log('Found PIN input, clicking and entering text...');
    await pinInput.click();
    await pinInput.fill('1234');
    console.log('Entered PIN: 1234');
    
    // Look for continue/submit button
    const continueBtn = await page.locator('button:has-text("Continue")').or(page.locator('button:has-text("Set PIN")')).first();
    if (await continueBtn.isVisible()) {
      console.log('Found button, clicking...');
      await continueBtn.click();
      await page.waitForTimeout(2000);
      console.log('Clicked button');
    }
  }

  console.log('\nKeeping browser open for 120 seconds for you to interact...');
  await page.waitForTimeout(120000);

  await browser.close();
})();
