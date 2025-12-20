sudo tee /usr/local/bin/cd-autoplay.sh << "EOF"
#!/bin/bash

LOG="/tmp/cd-autoplay.log"

echo "CD event triggered at $(date)" >> $LOG

# Kill any existing mpv playback
pkill -f "mpv cdda://" 2>/dev/null

# Small delay to let the drive settle
sleep 2

# Play audio CD
/usr/bin/mpv \
  cdda:// \
  --no-video \
  --gapless-audio=yes \
  --audio-device=alsa/plughw:CARD=IQaudIODAC,DEV=0 \
  --volume=80 \
  >> $LOG 2>&1
EOF
