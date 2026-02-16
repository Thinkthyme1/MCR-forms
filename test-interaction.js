const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('Opening rabbit branch...');
  await page.goto('https://thinkthyme1.github.io/MCR-forms/');
  await page.waitForTimeout(5000);
  
  // Get page title and content
  const title = await page.title();
  console.log('Page title:', title);
  
  // Get the HTML content
  const html = await page.content();
  console.log('Page has', html.length, 'characters');
  
  // Check what overlays are visible
  const pinOverlay = await page.locator('#pinOverlay').isVisible().catch(() => false);
  const loginOverlay = await page.locator('#loginOverlay').isVisible().catch(() => false);
  const lockOverlay = await page.locator('#lockOverlay').isVisible().catch(() => false);
  
  console.log('pinOverlay visible:', pinOverlay);
  console.log('loginOverlay visible:', loginOverlay);
  console.log('lockOverlay visible:', lockOverlay);
  
  // Take a screenshot
  await page.screenshot({ path: 'page-state.png' });
  console.log('Screenshot saved to page-state.png');
  
  console.log('Browser staying open for 60 seconds so you can see it...');
  await page.waitForTimeout(60000);
  
  await browser.close();
})();
