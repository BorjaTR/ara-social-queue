# Ara Social Queue

Automated Instagram publishing for @ara._journals.

## How it works

1. Cowork generates carousels and pushes PNGs + meta.json to `queue/`
2. GitHub Actions checks every 30 minutes for posts that are due
3. Due posts are published via the Instagram Graph API
4. Published posts are moved to `posted/`

## Adding secrets

Go to repo **Settings → Secrets and variables → Actions → New repository secret** and add:

- `INSTAGRAM_ACCOUNT_ID`
- `PAGE_ACCESS_TOKEN`
- `IMGBB_API_KEY`

## Manual publish

Trigger manually: **Actions tab → publish → Run workflow**

## Queue folder format

```
queue/2026-03-11_1200Z_instagram_topic-slug/
├── meta.json
├── 01.png
├── 02.png
├── 03.png
├── 04.png
├── 05.png
└── 06.png
```

### meta.json example

```json
{
  "platform": "instagram",
  "status": "approved",
  "scheduled": "2026-03-11T12:00:00Z",
  "caption": "...",
  "topic": "...",
  "pillar": 1,
  "hook": "...",
  "exercise": "The Exercise Name",
  "week": "2026-W11"
}
```

## Publishing workflow (for Cowork)

1. Export all carousels as PNGs at 1080×1350
2. Create queue folders locally with `meta.json` + PNGs
3. Clone or pull the repo:
   ```bash
   cd ~/Desktop
   git clone git@github.com:borjatarazona/ara-social-queue.git
   # or if already cloned:
   cd ara-social-queue && git pull
   ```
4. Copy queue folders into the repo's `queue/` directory:
   ```bash
   cp -r ~/Desktop/Cowork\ Socials/queue/instagram/* ~/Desktop/ara-social-queue/queue/
   ```
5. Commit and push:
   ```bash
   cd ~/Desktop/ara-social-queue
   git add queue/
   git commit -m "Week 11: 14 Instagram carousels scheduled"
   git push
   ```
6. GitHub Actions picks them up automatically. Posts go live at their scheduled times. Borja's Mac can be off.
7. After the week is over, pull the repo to sync the `posted/` folder locally:
   ```bash
   git pull
   ```

## Checking status

Go to [github.com/borjatarazona/ara-social-queue](https://github.com/borjatarazona/ara-social-queue) → **Actions** tab to see which posts were published and if any failed.

## Error handling

If a post fails, it stays in `queue/` with status `"approved"`. GitHub Actions will retry it on the next 30-minute cycle. If it fails 3 times, check the Actions log for the error message and tell Borja.
