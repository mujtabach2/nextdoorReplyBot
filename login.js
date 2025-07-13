const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Navigate to Nextdoor login page
  await page.goto('https://nextdoor.com/login/');

  // Manually log in (or automate with credentials)
  console.log('Please log in to Nextdoor manually in the browser.');
  console.log('Press Enter in the terminal after logging in to save cookies...');

  // Wait for user to press Enter
  process.stdin.once('data', async () => {
    // Save cookies
    const cookies = await context.cookies();
    fs.writeFileSync(path.resolve(__dirname, 'cookies.json'), JSON.stringify(cookies, null, 2));
    console.log('Cookies saved to cookies.json');
    await browser.close();
    process.exit();
  });
})();