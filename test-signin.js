const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Going to MCR Forms...');
  await page.goto('https://thinkthyme1.github.io/MCR-forms/');
  await page.waitForTimeout(2000);

  // Check if we're on the set PIN screen
  const setPinHeading = await page.locator('h2:has-text("Set Session PIN")');
  if (await setPinHeading.isVisible()) {
    console.log('On Set PIN screen...');
    
    // Enter PIN
    await page.fill('#sessionPinInput', '1234');
    console.log('Entered PIN: 1234');
    await page.waitForTimeout(500);
    
    // Click Start
    await page.click('button:has-text("Start Session")');
    console.log('Clicked Start Session');
    await page.waitForTimeout(2000);
    
    // Confirm PIN screen
    const confirmHeading = await page.locator('h2:has-text("Confirm Your PIN")');
    if (await confirmHeading.isVisible()) {
      console.log('On Confirm PIN screen...');
      await page.fill('#confirmPinInput', '1234');
      console.log('Confirmed PIN: 1234');
      await page.waitForTimeout(500);
      
      await page.click('button:has-text("Confirm")');
      console.log('Clicked Confirm');
      await page.waitForTimeout(2000);
    }
  }

  console.log('✅ PIN creation complete! Ready for instructions...');
  console.log('Keeping browser open for 120 seconds...');
  await page.waitForTimeout(120000);

  await browser.close();
})();
