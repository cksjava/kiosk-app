sudo tee /usr/local/bin/cd-stop.sh << "EOF"
#!/bin/bash
# Stop any existing CD playback started by our script
pkill -f "mpv.*cdda://" 2>/dev/null || true
EOF
sudo chmod +x /usr/local/bin/cd-stop.sh
