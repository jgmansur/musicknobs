import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', err => console.log('ERROR:', err.message));

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  
  await page.click('#refresh-btn');
  await new Promise(r => setTimeout(r, 100));
  
  const modalStyle = await page.$eval('#modal-api', el => el.style.display);
  console.log('Login modal display:', modalStyle);
  
  await browser.close();
})();
