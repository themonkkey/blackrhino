#!/bin/sh
# Render + encode BlackRhino background films. Needs: python3 -m http.server 8671 in film/, playwright, ffmpeg.
set -e
cd "$(dirname "$0")"
for s in ${@:-cruise tail night nose}; do
  rm -rf frames/$s; python3 render.py $s 1920 1080 24 8 140
  ffmpeg -loglevel error -y -framerate 24 -i frames/$s/%04d.jpg -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p -movflags +faststart -an ../public/video/$s.mp4
  ffmpeg -loglevel error -y -framerate 24 -i frames/$s/%04d.jpg -vf scale=960:-2 -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart -an ../public/video/$s-m.mp4
  python3 -c "from PIL import Image; Image.open('frames/$s/0000.jpg').resize((1280,720)).save('../public/video/$s.jpg',quality=78,optimize=True,progressive=True)"
done
echo all done
