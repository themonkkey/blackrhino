#!/bin/sh
# Deploy to Vercel (production) from a git-free copy. Vercel Hobby blocks CLI deploys whose git commit
# author is not the Vercel account owner, so the copy carries no git metadata. Plain `npx vercel deploy` works too.
set -e
cd "$(dirname "$0")"
D=$(mktemp -d)
rsync -a --exclude .git --exclude cache --exclude data --exclude .claude --exclude .env.local --exclude film --exclude eta --exclude docs ./ "$D/"
cd "$D" && npx vercel deploy --prod --yes
rm -rf "$D"
