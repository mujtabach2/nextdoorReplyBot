const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://nextdoor.com/login/');
  console.log('Log in manually. Press Enter after login.');

  process.stdin.once('data', async () => {
    const cookies = await context.cookies();
    fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
    await browser.close();
    process.exit();
  });
})();
