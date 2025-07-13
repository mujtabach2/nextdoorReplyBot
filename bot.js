const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OpenAI = require('openai');
require('dotenv').config();

const TEST_MODE = true; // Toggle to false for live replies
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const REPLIED_POSTS_FILE = 'replied_posts.json';
const OUTPUT_FILE = 'output.json';
const KEYWORDS = ['kitchen', 'contractor', 'renovation', 'basement']; 
const MAX_REPLIES_PER_SESSION = 5; // Limit replies to avoid detection
const NEIGHBORHOOD_NAME = "Parkview"; 
const MAX_HOURS_OLD = 24; // Only reply to posts less than 24 hours old

// Random delay to mimic human behavior
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function loadRepliedPostHashes() {
  if (!fs.existsSync(REPLIED_POSTS_FILE)) return new Set();
  const data = JSON.parse(fs.readFileSync(REPLIED_POSTS_FILE));
  return new Set(data);
}

function saveRepliedPostHashes(set) {
  fs.writeFileSync(REPLIED_POSTS_FILE, JSON.stringify([...set], null, 2));
}

function hashPost(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function isRecentPost(timestamp) {
  const timeMatch = timestamp.match(/(\d+)\s*(hr|hrs|hour|hours|d|day|days)\s*ago/i);
  if (!timeMatch) return false;
  const value = parseInt(timeMatch[1]);
  const unit = timeMatch[2].toLowerCase();
  const hours = unit.startsWith('h') ? value : value * 24;
  return hours <= MAX_HOURS_OLD;
}

async function generateReply(postText) {
  const prompt = `
You are a friendly neighbor responding on Nextdoor in the ${NEIGHBORHOOD_NAME} community. Craft a unique, helpful reply (max 2 sentences) that references the post's specific request for home renovation or contractor services and avoids generic phrases. Only reply if the post explicitly asks for recommendations or help with home renovation or contractor services (e.g., kitchen or basement projects) and is not promotional or unrelated.
Post: "${postText}"
Return: { "replyWarranted": Boolean, "reply": String }
  `;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      temperature: 0.7,
    });
    return JSON.parse(response.choices[0].message.content.trim());
  } catch (error) {
    console.error("Error parsing GPT response:", error);
    return { replyWarranted: false, reply: "" };
  }
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${Math.floor(Math.random() * 20) + 100}.0.0.0 Safari/537.36`,
    viewport: { width: 1280 + Math.floor(Math.random() * 100), height: 720 + Math.floor(Math.random() * 100) },
  });
  const cookiesPath = path.resolve(__dirname, 'cookies.json');
  if (!fs.existsSync(cookiesPath)) throw new Error('cookies.json missing — run login.js first');
  const cookies = JSON.parse(fs.readFileSync(cookiesPath));
  await context.addCookies(cookies);

  const repliedPostHashes = loadRepliedPostHashes();
  const output = [];
  let replyCount = 0;

  const page = await context.newPage();
  await page.goto('https://nextdoor.com/news_feed/');

  // Check for warnings
  const warning = await page.$('text=/warning|automated|restricted/i');
  if (warning) {
    console.log("Warning detected, stopping bot.");
    await browser.close();
    return;
  }

  const MAX_SCROLLS = 2; // Limit scrolls to load fresh posts
  let scrollCount = 0;

  while (scrollCount <= MAX_SCROLLS && replyCount < MAX_REPLIES_PER_SESSION) {
    await page.waitForSelector('div.js-media-post.post-next-feed-v2');
    const posts = await page.$$('div.js-media-post.post-next-feed-v2');

    for (const post of posts) {
      if (replyCount >= MAX_REPLIES_PER_SESSION) break;

      // Extract timestamp
      const timestampElement = await post.$('div[data-testid="post-timestamp"]');
      const timestamp = timestampElement ? await timestampElement.textContent() : null;
      if (!timestamp || !isRecentPost(timestamp)) {
        console.log(`[SKIPPED] Post too old or invalid timestamp: ${timestamp || 'No timestamp'}`);
        continue;
      }

      // Extract post text
      const textElement = await post.$('div[data-testid="post-body"] span[data-testid="styled-text"]');
      const text = textElement ? await textElement.textContent() : null;
      if (!text) continue;

      // Skip if already replied
      const hash = hashPost(text);
      if (repliedPostHashes.has(hash)) continue;

      // Check for keywords
      const isMatch = KEYWORDS.some(keyword => text.toLowerCase().includes(keyword));
      if (!isMatch) continue;

      // Simulate human behavior
      await page.mouse.move(randomDelay(100, 500), randomDelay(100, 500));

      // Generate reply
      const gptResponse = await generateReply(text);
      if (!gptResponse.replyWarranted) {
        console.log("[SKIPPED] Post not warranting reply:", text.trim());
        continue;
      }

      const reply = gptResponse.reply;
      if (TEST_MODE) {
        console.log("[TEST MODE] Would reply with:", reply);
        output.push({ post: text.trim(), reply, timestamp });
      } else {
        const replyBtn = await post.$('div[data-testid="post-reply-button"]');
        if (replyBtn) {
          await replyBtn.click();
          await page.waitForTimeout(randomDelay(500, 2000));
          await page.keyboard.type(reply);
          await page.waitForTimeout(randomDelay(200, 500));
          await page.keyboard.press('Enter');
          await page.waitForTimeout(randomDelay(1000, 5000));
          console.log("[LIVE MODE] Replied:", reply);
          replyCount++;
        }
      }

      repliedPostHashes.add(hash);
    }

    // Scroll to load more posts
    const initialPostCount = (await page.$$('div.js-media-post.post-next-feed-v2')).length;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(randomDelay(2000, 5000));
    const newPostCount = (await page.$$('div.js-media-post.post-next-feed-v2')).length;
    if (newPostCount <= initialPostCount) break; // No new posts
    scrollCount++;
  }

  if (TEST_MODE) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  }

  saveRepliedPostHashes(repliedPostHashes);
  await browser.close();
})();