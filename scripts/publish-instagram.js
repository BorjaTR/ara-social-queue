#!/usr/bin/env node

/**
 * publish-instagram.js
 *
 * Publishes a carousel post to Instagram via the Graph API.
 *
 * Usage: node scripts/publish-instagram.js queue/FOLDER_NAME
 *
 * Expects environment variables:
 *   INSTAGRAM_ACCOUNT_ID  — Instagram Business Account ID
 *   PAGE_ACCESS_TOKEN     — Facebook Page Access Token with instagram_basic, instagram_content_publish
 *   GITHUB_REPO           — GitHub repo in "owner/repo" format (e.g., "BorjaTR/ara-social-queue")
 *
 * The folder must contain:
 *   meta.json  — with at least { "caption": "..." }
 *   *.png      — carousel images, sorted alphabetically (01.png, 02.png, ...)
 *
 * Images are served directly from the public GitHub repo via raw.githubusercontent.com.
 */

const fs = require("fs");
const path = require("path");

const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || "BorjaTR/ara-social-queue";

const GRAPH_API = "https://graph.facebook.com/v21.0";

async function main() {
  const folderPath = process.argv[2];
  if (!folderPath) {
    console.error("Usage: node scripts/publish-instagram.js queue/FOLDER_NAME");
    process.exit(1);
  }

  if (!INSTAGRAM_ACCOUNT_ID || !PAGE_ACCESS_TOKEN) {
    console.error(
      "Missing required environment variables: INSTAGRAM_ACCOUNT_ID, PAGE_ACCESS_TOKEN"
    );
    process.exit(1);
  }

  const absPath = path.resolve(folderPath);

  // Read meta.json
  const metaPath = path.join(absPath, "meta.json");
  if (!fs.existsSync(metaPath)) {
    console.error(`meta.json not found in ${absPath}`);
    process.exit(1);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const caption = meta.caption || "";

  // Find PNG files, sorted alphabetically
  const pngFiles = fs
    .readdirSync(absPath)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort();

  if (pngFiles.length === 0) {
    console.error(`No PNG files found in ${absPath}`);
    process.exit(1);
  }

  console.log(
    `Publishing carousel: ${path.basename(absPath)} (${pngFiles.length} images)`
  );

  // Step 1: Build public URLs from GitHub raw content
  const folderName = path.basename(absPath);
  // Determine if folder is in queue/ or posted/ relative to repo root
  const repoRelPath = `queue/${folderName}`;
  const imageUrls = pngFiles.map(
    (png) =>
      `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${repoRelPath}/${png}`
  );

  console.log(`  Using ${imageUrls.length} GitHub raw URLs`);
  imageUrls.forEach((url) => console.log(`    ${url}`));

  // Step 1b: Verify all image URLs are accessible before sending to Instagram
  console.log("  Verifying image URLs are accessible...");
  for (const url of imageUrls) {
    let accessible = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok) {
        accessible = true;
        break;
      }
      console.log(
        `  ${path.basename(url)} not ready (HTTP ${res.status}), retrying in 5s... (${attempt}/10)`
      );
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (!accessible) {
      console.error(`  Image not accessible after 10 attempts: ${url}`);
      process.exit(1);
    }
  }
  console.log("  All images accessible.");

  // Step 2: Create individual media containers for each image (with retry)
  const containerIds = [];
  for (let i = 0; i < imageUrls.length; i++) {
    let created = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(
        `  Creating container ${i + 1}/${imageUrls.length}${
          attempt > 1 ? ` (attempt ${attempt})` : ""
        }...`
      );
      const params = new URLSearchParams({
        image_url: imageUrls[i],
        is_carousel_item: "true",
        access_token: PAGE_ACCESS_TOKEN,
      });

      const res = await fetch(
        `${GRAPH_API}/${INSTAGRAM_ACCOUNT_ID}/media?${params}`,
        { method: "POST" }
      );

      if (!res.ok) {
        const text = await res.text();
        if (attempt < 3) {
          console.log(`  Container creation failed — retrying in 10s...`);
          console.log(`  Error: ${text}`);
          await new Promise((r) => setTimeout(r, 10000));
          continue;
        }
        console.error(`  Failed to create container: ${text}`);
        process.exit(1);
      }

      const data = await res.json();
      containerIds.push(data.id);
      console.log(`  Container created: ${data.id}`);
      created = true;
      break;
    }
    if (!created) {
      console.error(`  Failed to create container after 3 attempts`);
      process.exit(1);
    }

    // Small delay between containers to avoid rate limits
    if (i < imageUrls.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Step 3: Create the carousel container
  console.log("  Creating carousel container...");
  const carouselParams = new URLSearchParams({
    media_type: "CAROUSEL",
    caption: caption,
    children: containerIds.join(","),
    access_token: PAGE_ACCESS_TOKEN,
  });

  const carouselRes = await fetch(
    `${GRAPH_API}/${INSTAGRAM_ACCOUNT_ID}/media?${carouselParams}`,
    { method: "POST" }
  );

  if (!carouselRes.ok) {
    const text = await carouselRes.text();
    console.error(`  Failed to create carousel container: ${text}`);
    process.exit(1);
  }

  const carouselData = await carouselRes.json();
  const carouselId = carouselData.id;
  console.log(`  Carousel container created: ${carouselId}`);

  // Step 4: Wait for the carousel to be ready, then publish
  console.log("  Waiting for media to be ready...");
  await waitForMediaReady(carouselId);

  console.log("  Publishing carousel...");
  const publishParams = new URLSearchParams({
    creation_id: carouselId,
    access_token: PAGE_ACCESS_TOKEN,
  });

  const publishRes = await fetch(
    `${GRAPH_API}/${INSTAGRAM_ACCOUNT_ID}/media_publish?${publishParams}`,
    { method: "POST" }
  );

  if (!publishRes.ok) {
    const text = await publishRes.text();
    console.error(`  Failed to publish carousel: ${text}`);
    process.exit(1);
  }

  const publishData = await publishRes.json();
  console.log(`  Published! Post ID: ${publishData.id}`);

  // Update meta.json with publish info
  meta.status = "published";
  meta.published_at = new Date().toISOString();
  meta.instagram_post_id = publishData.id;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  console.log("  meta.json updated.");
}

async function waitForMediaReady(containerId, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const params = new URLSearchParams({
      fields: "status_code",
      access_token: PAGE_ACCESS_TOKEN,
    });

    const res = await fetch(`${GRAPH_API}/${containerId}?${params}`);
    const data = await res.json();

    if (data.status_code === "FINISHED") {
      return;
    }

    if (data.status_code === "ERROR") {
      console.error(`  Media processing failed: ${JSON.stringify(data)}`);
      process.exit(1);
    }

    // Wait 2 seconds before checking again
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.error("  Timed out waiting for media to be ready");
  process.exit(1);
}

main().catch((err) => {
  console.error("Publish failed:", err);
  process.exit(1);
});
