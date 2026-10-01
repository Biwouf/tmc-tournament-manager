import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../services/tenup-worker/node_modules/playwright/index.mjs';
import { readTenupPool } from '../services/tenup-worker/read-pool.mjs';

test('pool extraction waits for delayed options and every card of the next round', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      await readFile(
        new URL('./fixtures/tenup-pool.html', import.meta.url),
        'utf8'
      )
    );
    await page.evaluate(() => {
      const button = document.querySelector(
        'button[aria-label="Sélectionner une journée"]'
      );
      const cards = [
        ...document.querySelectorAll('main a[href*="/rencontre/"]'),
      ];
      const parent = cards[0].parentElement;
      setTimeout(
        () =>
          button.addEventListener('click', () => {
            setTimeout(() => {
              const list = document.createElement('ul');
              list.setAttribute('role', 'listbox');
              for (let n = 1; n <= 2; n++) {
                const option = document.createElement('li');
                option.setAttribute('role', 'option');
                option.textContent = `Journée ${n}`;
                option.onclick = () => {
                  button.querySelector('span').textContent = `Journée ${n}`;
                  list.remove();
                  if (n === 2) {
                    cards.forEach((a) => a.remove());
                    cards.forEach((a, i) =>
                      setTimeout(
                        () => {
                          const copy = a.cloneNode(true);
                          copy.setAttribute(
                            'href',
                            copy
                              .getAttribute('href')
                              .replace(/\d+$/, (x) => String(Number(x) + 100))
                          );
                          parent.appendChild(copy);
                        },
                        200 * (i + 1)
                      )
                    );
                  }
                };
                list.appendChild(option);
              }
              document.body.appendChild(list);
            }, 150);
          }),
        1200
      );
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape')
          document.querySelector('[role=listbox]')?.remove();
      });
    });
    const pool = await readTenupPool(page);
    assert.equal(pool.rounds.length, 2);
    assert.deepEqual(
      pool.rounds.map((r) => r.matches.length),
      [3, 3]
    );
    assert.notEqual(
      pool.rounds[0].matches[0].url,
      pool.rounds[1].matches[0].url
    );
  } finally {
    await browser.close();
  }
});
