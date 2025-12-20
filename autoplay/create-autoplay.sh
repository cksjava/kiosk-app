sudo tee /usr/local/bin/cd-autoplay.sh << "EOF"
#!/bin/bash
exec >> /tmp/cd-autoplay.log 2>&1

echo "=== AUTOPLAY $(date) ==="

# Stop any previous run
pkill -f "mpv.*cdda://" 2>/dev/null || true

sleep 2

/usr/bin/mpv cdda:// \
  --no-video \
  --audio-device=alsa/plughw:CARD=IQaudIODAC,DEV=0 \
  --volume=80
EOF
