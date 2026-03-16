#!/usr/bin/env node

/**
 * check-and-publish.js
 *
 * Scans queue/ for folders with meta.json where:
 *   - status === "approved"
 *   - scheduled time is in the past or within the next 15 minutes
 *
 * For each due post, runs publish-instagram.js, then moves the folder to posted/.
 * After all publishes, commits and pushes if anything changed.
 *
 * Usage: node scripts/check-and-publish.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const QUEUE_DIR = path.resolve(__dirname, "..", "queue");
const POSTED_DIR = path.resolve(__dirname, "..", "posted");
const PUBLISH_SCRIPT = path.resolve(__dirname, "publish-instagram.js");

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

function main() {
  // Ensure posted/ exists
  if (!fs.existsSync(POSTED_DIR)) {
    fs.mkdirSync(POSTED_DIR, { recursive: true });
  }

  // Read all folders in queue/
  if (!fs.existsSync(QUEUE_DIR)) {
    console.log("No queue/ directory found. Nothing to do.");
    return;
  }

  const entries = fs.readdirSync(QUEUE_DIR, { withFileTypes: true });
  const folders = entries.filter(
    (e) => e.isDirectory() && e.name !== ".gitkeep"
  );

  if (folders.length === 0) {
    console.log("No folders in queue/. Nothing to do.");
    return;
  }

  const now = new Date();
  let publishedCount = 0;
  const publishedNames = [];

  for (const folder of folders) {
    const folderPath = path.join(QUEUE_DIR, folder.name);
    const metaPath = path.join(folderPath, "meta.json");

    // Skip folders without meta.json
    if (!fs.existsSync(metaPath)) {
      console.log(`Skipping ${folder.name}: no meta.json`);
      continue;
    }

    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    } catch (err) {
      console.log(`Skipping ${folder.name}: invalid meta.json`);
      continue;
    }

    // Skip if not approved
    if (meta.status !== "approved") {
      console.log(`Skipping ${folder.name}: status is "${meta.status}"`);
      continue;
    }

    // Skip if no scheduled field
    if (!meta.scheduled) {
      console.log(`Skipping ${folder.name}: no scheduled field`);
      continue;
    }

    // Check if scheduled time is due
    const scheduledTime = new Date(meta.scheduled);
    if (isNaN(scheduledTime.getTime())) {
      console.log(
        `⚠ Skipping ${folder.name}: invalid scheduled date "${meta.scheduled}"`
      );
      continue;
    }
    const timeDiff = scheduledTime.getTime() - now.getTime();

    if (timeDiff > FIFTEEN_MINUTES_MS) {
      console.log(
        `Skipping ${folder.name}: scheduled for ${meta.scheduled} (not due yet)`
      );
      continue;
    }

    // This post is due — publish it
    console.log(`\nPublishing ${folder.name}...`);
    console.log(`  Scheduled: ${meta.scheduled}`);

    try {
      execSync(`node "${PUBLISH_SCRIPT}" "${folderPath}"`, {
        stdio: "inherit",
        env: process.env,
      });

      // Move folder from queue/ to posted/
      const destPath = path.join(POSTED_DIR, folder.name);
      fs.renameSync(folderPath, destPath);
      console.log(`  Moved to posted/${folder.name}`);

      publishedCount++;
      publishedNames.push(folder.name);
    } catch (err) {
      console.error(`  Failed to publish ${folder.name}: ${err.message}`);
      // Leave the folder in queue/ so it gets retried next cycle
    }
  }

  // Commit and push if any posts were published
  if (publishedCount > 0) {
    console.log(`\n${publishedCount} carousel(s) published. Committing...`);

    try {
      execSync("git add .", { stdio: "inherit", cwd: path.resolve(__dirname, "..") });
      const message =
        publishedCount === 1
          ? `Published 1 carousel [skip ci]`
          : `Published ${publishedCount} carousels [skip ci]`;
      execSync(`git commit -m "${message}"`, {
        stdio: "inherit",
        cwd: path.resolve(__dirname, ".."),
      });
      execSync("git push", {
        stdio: "inherit",
        cwd: path.resolve(__dirname, ".."),
      });
      console.log("Changes committed and pushed.");
    } catch (err) {
      console.error(`Git commit/push failed: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log("\nNo posts are due. Nothing to publish.");
  }
}

main();
