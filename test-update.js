const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Navigate to the local file
  const filePath = 'file://' + path.resolve(__dirname, 'index.html');
  console.log('Opening:', filePath);
  
  await page.goto(filePath);
  
  // Wait a bit to see what happens
  await page.waitForTimeout(3000);
  
  console.log('Page title:', await page.title());
  console.log('Page loaded. Check the browser window...');
  
  // Keep the browser open
  await page.waitForTimeout(60000);
  
  await browser.close();
})();
