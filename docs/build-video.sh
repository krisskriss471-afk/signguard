#!/bin/bash
# Assemble the 4-minute-limit demo video from real captures + narration.
set -e
cd "$(dirname "$0")"
FF=~/video-factory/scripts/ffmpeg
OUT=demo.mp4

# pad UI captures (1280x639) to 1280x720
for f in shot-drainer shot-nft shot-router shot-transfer; do
  $FF -y -v error -i $f.png -vf "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0b0e14" ${f}_720.png
done

cat > concat.txt <<EOF
file 'slide-title.png'
duration 5
file 'shot-drainer_720.png'
duration 22
file 'shot-nft_720.png'
duration 12
file 'shot-router_720.png'
duration 10
file 'shot-transfer_720.png'
duration 8
file 'slide-x402.png'
duration 18
file 'slide-evidence.png'
duration 14
file 'slide-title.png'
duration 4
EOF

$FF -y -v error -f concat -safe 0 -i concat.txt -i narration.mp3 \
  -vf "scale=1280:720,fps=30,format=yuv420p" -c:v libx264 -preset medium -crf 20 \
  -c:a aac -b:a 160k -shortest $OUT

$FF -v error -i $OUT -f null - && echo "OK $OUT $(du -h $OUT | cut -f1)"
